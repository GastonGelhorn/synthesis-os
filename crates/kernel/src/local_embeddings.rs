//! Local Embeddings Engine using ONNX Runtime + multilingual-e5-small.
//!
//! Replaces OpenAI `text-embedding-ada-002` API calls with a local model
//! that runs in ~2-5ms on CPU. This eliminates the 2-5 second network latency
//! per embedding request that was the primary bottleneck in agent startup.
//!
//! The model produces 384-dimensional vectors, which matches the existing
//! LanceDB memory_store table schema and is natively compatible with tool_rag.
//!
//! multilingual-e5-small supports 100+ languages including Spanish and English,
//! replacing all-MiniLM-L6-v2 which was English-only and caused Tool RAG
//! to return irrelevant tools for Spanish queries.

use once_cell::sync::OnceCell;
use ort::session::Session;
use ort::value::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokenizers::Tokenizer;

/// Global singleton for the local embedding engine.
static EMBEDDER: OnceCell<Arc<LocalEmbedder>> = OnceCell::new();

/// Output dimensionality of multilingual-e5-small (same as all-MiniLM-L6-v2).
pub const EMBEDDING_DIM: usize = 384;

/// Maximum token length for the model.
const MAX_TOKENS: usize = 512;

/// E5 models require a task prefix for queries vs passages.
/// "query: " for search queries, "passage: " for documents/tool descriptions.
const QUERY_PREFIX: &str = "query: ";
const PASSAGE_PREFIX: &str = "passage: ";

/// The local embedding engine wrapping ONNX Runtime + HuggingFace tokenizer.
/// Session::run requires &mut self in ort 2.0.0-rc.11, so we use a Mutex.
pub struct LocalEmbedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    /// Whether the ONNX model accepts token_type_ids (BERT-based: yes, XLM-R: no)
    has_token_type_ids: bool,
}

impl LocalEmbedder {
    fn load(model_dir: &PathBuf) -> Result<Self, String> {
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        if !model_path.exists() {
            return Err(format!(
                "ONNX model not found at {:?}. It will be auto-downloaded on next start.",
                model_path
            ));
        }
        if !tokenizer_path.exists() {
            return Err(format!(
                "Tokenizer not found at {:?}. It will be auto-downloaded on next start.",
                tokenizer_path
            ));
        }

        let session = Session::builder()
            .map_err(|e| format!("ONNX session builder error: {}", e))?
            .with_intra_threads(2)
            .map_err(|e| format!("ONNX intra threads error: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("Failed to load ONNX model: {}", e))?;

        // Detect if model accepts token_type_ids (BERT-based: yes, XLM-RoBERTa: no).
        // multilingual-e5-small is XLM-RoBERTa-based and typically only needs input_ids + attention_mask.
        let has_token_type_ids = session
            .inputs()
            .iter()
            .any(|input| input.name() == "token_type_ids");
        println!(
            "[LocalEmbeddings] Model inputs: [{}], has_token_type_ids: {}",
            session
                .inputs()
                .iter()
                .map(|i| i.name())
                .collect::<Vec<_>>()
                .join(", "),
            has_token_type_ids
        );

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        println!(
            "[LocalEmbeddings] Loaded multilingual-e5-small (ONNX) from {:?}",
            model_dir
        );

        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
            has_token_type_ids,
        })
    }

    /// Embed a single text string into a 384-dimensional vector.
    /// Use `is_query=true` for user queries (search), `is_query=false` for passages (tool descriptions, memories).
    pub fn embed(&self, text: &str, is_query: bool) -> Result<Vec<f32>, String> {
        let prefixed = if is_query {
            format!("{}{}", QUERY_PREFIX, text)
        } else {
            format!("{}{}", PASSAGE_PREFIX, text)
        };
        let results = self.embed_batch_raw(&[prefixed])?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| "Empty batch result".to_string())
    }

    /// Embed multiple texts in a single forward pass.
    /// All texts should already have the appropriate prefix (query:/passage:).
    pub fn embed_batch_prefixed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        self.embed_batch_raw(texts)
    }

    /// Embed multiple passages (tool descriptions, memories) in a single forward pass.
    /// Automatically adds "passage: " prefix.
    pub fn embed_passages(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let prefixed: Vec<String> = texts
            .iter()
            .map(|t| format!("{}{}", PASSAGE_PREFIX, t))
            .collect();
        self.embed_batch_raw(&prefixed)
    }

    /// Embed multiple queries in a single forward pass.
    /// Automatically adds "query: " prefix.
    pub fn embed_queries(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let prefixed: Vec<String> = texts
            .iter()
            .map(|t| format!("{}{}", QUERY_PREFIX, t))
            .collect();
        self.embed_batch_raw(&prefixed)
    }

    /// Raw batch embedding — texts must already include any prefixes.
    fn embed_batch_raw(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("Tokenization error: {}", e))?;

        let batch_size = encodings.len();
        let seq_len = encodings
            .iter()
            .map(|e| e.get_ids().len().min(MAX_TOKENS))
            .max()
            .unwrap_or(0);

        if seq_len == 0 {
            return Ok(vec![vec![0.0f32; EMBEDDING_DIM]; batch_size]);
        }

        // Build padded flat vectors for each input
        let mut input_ids_vec = vec![0i64; batch_size * seq_len];
        let mut attention_mask_vec = vec![0i64; batch_size * seq_len];

        for (i, encoding) in encodings.iter().enumerate() {
            let ids = encoding.get_ids();
            let mask = encoding.get_attention_mask();
            let len = ids.len().min(MAX_TOKENS).min(seq_len);

            for j in 0..len {
                input_ids_vec[i * seq_len + j] = ids[j] as i64;
                attention_mask_vec[i * seq_len + j] = mask[j] as i64;
            }
        }

        // Create ort::Value tensors using (shape, Vec<T>) tuple API
        let shape = vec![batch_size as i64, seq_len as i64];
        let ids_value =
            Value::from_array((shape.as_slice(), input_ids_vec.clone().into_boxed_slice()))
                .map_err(|e| format!("input_ids tensor error: {}", e))?;

        let mask_value = Value::from_array((
            shape.as_slice(),
            attention_mask_vec.clone().into_boxed_slice(),
        ))
        .map_err(|e| format!("attention_mask tensor error: {}", e))?;

        // Run ONNX inference and copy embeddings out while session lock is held.
        // SessionOutputs borrows from Session, so we must extract data before dropping the guard.
        let embeddings_owned: Vec<f32> = {
            let mut session_guard = self
                .session
                .lock()
                .map_err(|e| format!("Session lock error: {}", e))?;

            // XLM-RoBERTa (multilingual-e5-small) only needs input_ids + attention_mask.
            // BERT-based models additionally need token_type_ids.
            let outputs = if self.has_token_type_ids {
                let token_type_ids_vec = vec![0i64; batch_size * seq_len]; // Always zeros for XLM-R
                let type_value =
                    Value::from_array((shape.as_slice(), token_type_ids_vec.into_boxed_slice()))
                        .map_err(|e| format!("token_type_ids tensor error: {}", e))?;
                session_guard
                    .run(ort::inputs![ids_value, mask_value, type_value])
                    .map_err(|e| format!("ONNX inference error: {}", e))?
            } else {
                session_guard
                    .run(ort::inputs![ids_value, mask_value])
                    .map_err(|e| format!("ONNX inference error: {}", e))?
            };

            let (_out_shape, embeddings_flat) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Failed to extract embeddings tensor: {}", e))?;

            // Copy into owned Vec so we can release the session lock
            embeddings_flat.to_vec()
        }; // session_guard + outputs dropped here

        // Mean pooling with attention mask (manual indexing into flat slice)
        let mut results = Vec::with_capacity(batch_size);

        for i in 0..batch_size {
            let mut pooled = vec![0.0f32; EMBEDDING_DIM];
            let mut count = 0.0f32;

            for j in 0..seq_len {
                let mask_val = attention_mask_vec[i * seq_len + j] as f32;
                if mask_val > 0.0 {
                    let offset = (i * seq_len + j) * EMBEDDING_DIM;
                    for k in 0..EMBEDDING_DIM {
                        pooled[k] += embeddings_owned[offset + k] * mask_val;
                    }
                    count += mask_val;
                }
            }

            if count > 0.0 {
                for v in pooled.iter_mut() {
                    *v /= count;
                }
            }

            // L2 normalization
            let norm: f32 = pooled.iter().map(|v| v * v).sum::<f32>().sqrt();
            if norm > 0.0 {
                for v in pooled.iter_mut() {
                    *v /= norm;
                }
            }

            results.push(pooled);
        }

        Ok(results)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

pub fn init(app_dir: &PathBuf) -> Result<(), String> {
    // Try new multilingual model first, fall back to old model if available
    let model_dir = app_dir.join("models").join("multilingual-e5-small");
    let old_model_dir = app_dir.join("models").join("all-MiniLM-L6-v2");

    let model_path = model_dir.join("model.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");

    if !model_path.exists() || !tokenizer_path.exists() {
        println!("[LocalEmbeddings] multilingual-e5-small not found. Auto-downloading...");
        download_model(&model_dir)?;

        // Clean up old model if new one downloaded successfully
        if old_model_dir.exists() {
            println!("[LocalEmbeddings] Removing old all-MiniLM-L6-v2 model...");
            let _ = std::fs::remove_dir_all(&old_model_dir);
        }
    }

    let embedder = LocalEmbedder::load(&model_dir)?;
    EMBEDDER
        .set(Arc::new(embedder))
        .map_err(|_| "LocalEmbedder already initialized".to_string())?;
    println!("[LocalEmbeddings] Global engine initialized successfully (multilingual-e5-small).");
    Ok(())
}

/// Returns true if the embedding engine is initialized and ready.
pub fn is_available() -> bool {
    EMBEDDER.get().is_some()
}

/// Download model.onnx and tokenizer.json from HuggingFace.
/// Tries quantized model first (~118MB), falls back to fp32 (~450MB).
fn download_model(model_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(model_dir)
        .map_err(|e| format!("Failed to create model dir {:?}: {}", model_dir, e))?;

    let model_path = model_dir.join("model.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");

    if !model_path.exists() {
        // Try quantized model first (smaller download), then fall back to fp32
        let model_urls = &[
            // Xenova's ONNX-optimized repo (community standard for ONNX deployment)
            ("https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx", "quantized ~118MB"),
            // Official repo quantized
            ("https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx", "quantized ~118MB"),
            // Official repo fp32 (larger but guaranteed to exist)
            ("https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model.onnx", "fp32 ~450MB"),
        ];

        let mut downloaded = false;
        for (url, desc) in model_urls {
            println!(
                "[LocalEmbeddings] Trying to download multilingual-e5-small ({})...",
                desc
            );
            match download_file(url, &model_path) {
                Ok(()) => {
                    // Verify the file is not empty/corrupt
                    if let Ok(meta) = std::fs::metadata(&model_path) {
                        if meta.len() > 1_000_000 {
                            // At least 1MB
                            println!("[LocalEmbeddings] model.onnx downloaded ({}).", desc);
                            downloaded = true;
                            break;
                        } else {
                            println!(
                                "[LocalEmbeddings] Download too small ({}B), trying next...",
                                meta.len()
                            );
                            let _ = std::fs::remove_file(&model_path);
                        }
                    }
                }
                Err(e) => {
                    println!("[LocalEmbeddings] Failed to download from {}: {}", url, e);
                    let _ = std::fs::remove_file(&model_path); // Clean up partial download
                }
            }
        }
        if !downloaded {
            return Err(
                "Failed to download multilingual-e5-small ONNX model from all sources.".to_string(),
            );
        }
    }

    if !tokenizer_path.exists() {
        // Tokenizer is the same across repos
        let tokenizer_urls = &[
            "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json",
            "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/tokenizer.json",
        ];

        let mut downloaded = false;
        for url in tokenizer_urls {
            println!("[LocalEmbeddings] Downloading tokenizer.json...");
            match download_file(url, &tokenizer_path) {
                Ok(()) => {
                    if let Ok(meta) = std::fs::metadata(&tokenizer_path) {
                        if meta.len() > 1000 {
                            // At least 1KB
                            println!("[LocalEmbeddings] tokenizer.json downloaded.");
                            downloaded = true;
                            break;
                        }
                    }
                    let _ = std::fs::remove_file(&tokenizer_path);
                }
                Err(e) => {
                    println!("[LocalEmbeddings] Failed: {}", e);
                    let _ = std::fs::remove_file(&tokenizer_path);
                }
            }
        }
        if !downloaded {
            return Err("Failed to download tokenizer.json from all sources.".to_string());
        }
    }

    Ok(())
}

/// Download a file from a URL using a blocking HTTP request.
fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    // Use std::process::Command to call curl (available on macOS)
    let output = std::process::Command::new("curl")
        .args(["-L", "-f", "-s", "-o"])
        .arg(dest.to_str().unwrap_or_default())
        .arg(url)
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed for {}: {}", url, stderr));
    }

    Ok(())
}

pub fn get() -> Option<Arc<LocalEmbedder>> {
    EMBEDDER.get().cloned()
}

/// Embed a query (user search text). Adds "query: " prefix for E5 models.
pub fn embed(text: &str) -> Result<Vec<f32>, String> {
    get()
        .ok_or_else(|| "Local embedding engine not initialized".to_string())?
        .embed(text, true)
}

/// Embed a passage (tool description, memory content). Adds "passage: " prefix.
pub fn embed_passage(text: &str) -> Result<Vec<f32>, String> {
    get()
        .ok_or_else(|| "Local embedding engine not initialized".to_string())?
        .embed(text, false)
}

/// Embed multiple passages (tool descriptions, memories) in a single forward pass.
pub fn embed_passages(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    get()
        .ok_or_else(|| "Local embedding engine not initialized".to_string())?
        .embed_passages(texts)
}

/// Embed multiple queries in a single forward pass.
pub fn embed_queries(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    get()
        .ok_or_else(|| "Local embedding engine not initialized".to_string())?
        .embed_queries(texts)
}

/// Legacy API: embed_batch for backward compatibility.
/// Treats all texts as passages (tool descriptions/memories).
pub fn embed_batch(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    embed_passages(texts)
}
