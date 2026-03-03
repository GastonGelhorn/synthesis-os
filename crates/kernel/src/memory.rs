use crate::local_embeddings;
use arrow::array::{
    Array, FixedSizeListBuilder, Float32Builder, Int64Builder, RecordBatch, StringBuilder,
};
use arrow::datatypes::{DataType, Field, Schema};
use futures_util::StreamExt;
use lancedb::{Connection, Table};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// Re-export types that callers still need (MemoryCategory, MemoryEntry, etc.)
pub use crate::memory_ext::{
    MemoryCategory, MemoryEntry, MemoryQuery, MemoryResponse, MemoryUpdate,
};

/// ═══════════════════════════════════════════════════════════════════════
/// Memory Manager v3 — Atomic Facts in LanceDB
/// ═══════════════════════════════════════════════════════════════════════
///
/// Architecture:
/// - **LanceDB** is the SINGLE source of truth for all memories.
/// - Each memory is an **atomic fact** with its own embedding vector.
/// - No more metadata.json — no more blob appends — no more dual storage.
/// - RAM cache for hot-path exact key lookups only.
///
/// LanceDB Schema (table: "memory_v3"):
///   id        : Utf8     — UUID of the entry
///   agent_id  : Utf8     — which agent owns this ("user", "agent_1", etc.)
///   key       : Utf8     — structured key ("user_profile:pet:buster", "core:persona")
///   content   : Utf8     — the actual fact text
///   category  : Utf8     — "user_fact", "preference", "os_insight", "pattern", "conversation"
///   created_at: Int64    — unix timestamp
///   updated_at: Int64    — unix timestamp
///   vector    : Float32[384] — local embedding (all-MiniLM-L6-v2)
///
/// Why this is better:
/// 1. "what's my dog's name" → vector search finds the Buster fact directly (not a 50-line blob)
/// 2. "Abbi cumplió 6" → updates just the daughter fact, doesn't append to a blob
/// 3. No metadata.json that grows unbounded and rewrites on every persist()
/// 4. LanceDB handles indexing, compression, and disk I/O efficiently
pub struct MemoryManager {
    ram_cache: Arc<Mutex<MemoryRamCache>>,
    storage: Arc<tokio::sync::Mutex<StorageManager>>,
    #[allow(dead_code)]
    app_handle: tauri::AppHandle,
}

impl MemoryManager {
    /// Asynchronously initialize the MemoryManager and connect to LanceDB.
    pub async fn new(app_dir: PathBuf, app_handle: tauri::AppHandle) -> Self {
        Self::new_with_config(app_dir, app_handle, true, 80, 500).await
    }

    /// Initialize with explicit configuration from kernel settings.
    /// Note: auto_tagging, compaction_threshold, and max_memories_per_agent are kept
    /// in the signature for backwards compatibility but are no longer used.
    /// LanceDB handles storage limits natively.
    pub async fn new_with_config(
        app_dir: PathBuf,
        app_handle: tauri::AppHandle,
        _auto_tagging: bool,
        _compaction_threshold: u8,
        _max_memories_per_agent: u32,
    ) -> Self {
        let db_path = app_dir.join("lancedb");

        // Connect to local embedded LanceDB
        let conn = lancedb::connect(db_path.to_str().unwrap())
            .execute()
            .await
            .expect("Failed to connect to LanceDB");
        let storage = StorageManager::init(conn).await;

        Self {
            ram_cache: Arc::new(Mutex::new(MemoryRamCache::new())),
            storage: Arc::new(tokio::sync::Mutex::new(storage)),
            app_handle,
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // READ operations
    // ═══════════════════════════════════════════════════════════════════

    /// Read a memory by key.
    ///
    /// For `core:` keys (e.g., "core:user_profile", "core:persona"), this aggregates
    /// all atomic facts of the corresponding category into a single string.
    /// For other keys, does exact key lookup then semantic search fallback.
    pub async fn read(&self, agent_id: &str, key: &str) -> Option<String> {
        // Special handling for core memory blocks — aggregate atomic facts
        if key.starts_with("core:") {
            let block = key.trim_start_matches("core:");
            let profile = match block {
                "user_profile" => self.get_user_profile(agent_id).await,
                "persona" => self.get_persona(agent_id).await,
                _ => {
                    // Generic core block: get by category
                    let category = block_to_category(key);
                    let facts = self.get_facts_by_category(agent_id, &category).await;
                    facts
                        .iter()
                        .map(|f| format!("- {}", f.content))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            };
            return if profile.is_empty() {
                None
            } else {
                Some(profile)
            };
        }

        // 1. RAM cache (hot path)
        if let Ok(cache) = self.ram_cache.lock() {
            if let Some(val) = cache.get(&format!("{}:{}", agent_id, key)) {
                return Some(val);
            }
        }

        // 2. Exact key lookup in LanceDB
        let store = self.storage.lock().await;
        if let Some(content) = store.get_by_key(agent_id, key).await {
            if let Ok(mut cache) = self.ram_cache.lock() {
                cache.set(format!("{}:{}", agent_id, key), content.clone());
            }
            return Some(content);
        }

        // 3. Semantic search as fallback
        let query_vec = match local_embeddings::embed(key) {
            Ok(vec) => vec,
            Err(e) => {
                println!("[MemoryManager] Local embedding failed for read: {}", e);
                return None;
            }
        };

        store
            .search_semantic(&query_vec, Some(agent_id), None, 1)
            .await
            .first()
            .map(|fact| fact.content.clone())
    }

    /// Semantic search across all memories for an agent.
    /// Returns top-K most relevant facts.
    pub async fn search_semantic(
        &self,
        agent_id: &str,
        query: &str,
        limit: usize,
    ) -> Vec<MemoryFact> {
        let query_vec = match local_embeddings::embed(query) {
            Ok(vec) => vec,
            Err(e) => {
                println!("[MemoryManager] Local embedding failed for search: {}", e);
                return vec![];
            }
        };

        let store = self.storage.lock().await;
        store
            .search_semantic(&query_vec, Some(agent_id), None, limit)
            .await
    }

    /// Get all facts for an agent with a specific category.
    /// E.g., get all UserFact entries to build the user profile context.
    pub async fn get_facts_by_category(&self, agent_id: &str, category: &str) -> Vec<MemoryFact> {
        let store = self.storage.lock().await;
        store.get_by_category(agent_id, category).await
    }

    /// Get all facts matching a key prefix (e.g., "user_profile:" returns all user profile facts).
    pub async fn get_facts_by_key_prefix(&self, agent_id: &str, prefix: &str) -> Vec<MemoryFact> {
        let store = self.storage.lock().await;
        store.get_by_key_prefix(agent_id, prefix).await
    }

    /// Build the full user profile context string from atomic facts.
    /// Replaces the old monolithic `core:user_profile` blob.
    pub async fn get_user_profile(&self, agent_id: &str) -> String {
        let facts = self.get_facts_by_category(agent_id, "user_fact").await;
        if facts.is_empty() {
            return String::new();
        }
        facts
            .iter()
            .map(|f| format!("- {}", f.content))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Build the full persona context string from atomic facts.
    pub async fn get_persona(&self, agent_id: &str) -> String {
        let facts = self.get_facts_by_category(agent_id, "os_insight").await;
        if facts.is_empty() {
            return String::new();
        }
        facts
            .iter()
            .map(|f| format!("- {}", f.content))
            .collect::<Vec<_>>()
            .join("\n")
    }

    // ═══════════════════════════════════════════════════════════════════
    // WRITE operations — all produce atomic facts
    // ═══════════════════════════════════════════════════════════════════

    /// Write (upsert) a single atomic fact.
    /// If a fact with the same key already exists, it is REPLACED.
    pub async fn write(&self, agent_id: &str, key: &str, value: &str) -> Result<(), String> {
        let embedding = local_embeddings::embed_passage(value)?;
        let now = now_unix();

        let store = self.storage.lock().await;
        store
            .upsert_fact(
                &MemoryFact {
                    id: Uuid::new_v4().to_string(),
                    agent_id: agent_id.to_string(),
                    key: key.to_string(),
                    content: value.to_string(),
                    category: "uncategorized".to_string(),
                    created_at: now,
                    updated_at: now,
                    distance: None,
                },
                &embedding,
            )
            .await?;

        // Update RAM cache
        if let Ok(mut cache) = self.ram_cache.lock() {
            cache.set(format!("{}:{}", agent_id, key), value.to_string());
        }

        Ok(())
    }

    /// Store an atomic fact with explicit category (the primary write path).
    /// This is the NEW way to store user facts — each fact gets its own entry + embedding.
    ///
    /// Deduplication: searches for semantically similar existing facts (>0.85 similarity).
    /// If found, updates the existing fact instead of creating a duplicate.
    pub async fn store_fact(
        &self,
        agent_id: &str,
        key: &str,
        content: &str,
        category: &str,
    ) -> Result<String, String> {
        let embedding = local_embeddings::embed_passage(content).map_err(|e| {
            println!(
                "[MemoryManager] embed_passage FAILED: {} | content: '{}'",
                e,
                &content[..content.len().min(60)]
            );
            e
        })?;
        let now = now_unix();

        let store = self.storage.lock().await;

        // Dedup: check if a very similar fact already exists for this agent+category.
        // For L2-normalized vectors: distance < 0.5 ≈ cosine similarity > 0.75
        // Lowered from 0.3 (0.85) to catch paraphrased duplicates like
        // "prefers english" vs "wants answers in english"
        const DEDUP_DISTANCE_THRESHOLD: f32 = 0.5;
        let similar = store
            .search_semantic(&embedding, Some(agent_id), Some(category), 1)
            .await;
        if let Some(existing) = similar.first() {
            let dist = existing.distance.unwrap_or(f32::MAX);
            if dist < DEDUP_DISTANCE_THRESHOLD {
                println!(
                    "[MemoryManager] Found similar fact (dist={:.3}) '{}', updating in-place.",
                    dist, &existing.key
                );
                let updated = MemoryFact {
                    id: existing.id.clone(),
                    agent_id: agent_id.to_string(),
                    key: key.to_string(),
                    content: content.to_string(),
                    category: category.to_string(),
                    created_at: existing.created_at,
                    updated_at: now,
                    distance: None,
                };
                store.upsert_fact(&updated, &embedding).await?;
                return Ok(existing.id.clone());
            }
        }

        // No similar fact found — create new
        let id = Uuid::new_v4().to_string();
        let fact = MemoryFact {
            id: id.clone(),
            agent_id: agent_id.to_string(),
            key: key.to_string(),
            content: content.to_string(),
            category: category.to_string(),
            created_at: now,
            updated_at: now,
            distance: None,
        };
        store.upsert_fact(&fact, &embedding).await?;

        // Update RAM cache
        if let Ok(mut cache) = self.ram_cache.lock() {
            cache.set(format!("{}:{}", agent_id, key), content.to_string());
        }

        println!(
            "[MemoryManager] Stored atomic fact: key='{}', category='{}', id='{}'",
            key,
            category,
            &id[..8]
        );
        Ok(id)
    }

    /// Evolve memory — store as a new atomic fact with auto-dedup.
    /// Replaces the old write_agentic pipeline.
    pub async fn evolve(&self, agent_id: &str, content: &str) -> Result<(), String> {
        // Generate a key from the first 60 chars of content
        let key = format!("evolved:{}", &content.chars().take(60).collect::<String>());
        self.store_fact(agent_id, &key, content, "uncategorized")
            .await?;
        Ok(())
    }

    /// Full agentic memory write — now just delegates to store_fact.
    /// Kept for backwards compatibility with existing callers.
    pub async fn write_agentic(
        &self,
        agent_id: &str,
        content: &str,
        context: &str,
    ) -> Result<String, String> {
        let key = format!("agentic:{}", &content.chars().take(60).collect::<String>());
        let category = context_to_category(context);
        self.store_fact(agent_id, &key, content, &category).await
    }

    /// Full agentic write with explicit category.
    pub async fn write_agentic_categorized(
        &self,
        agent_id: &str,
        content: &str,
        _context: &str,
        category: MemoryCategory,
    ) -> Result<String, String> {
        let key = format!("agentic:{}", &content.chars().take(60).collect::<String>());
        self.store_fact(agent_id, &key, content, &category.to_string())
            .await
    }

    // ═══════════════════════════════════════════════════════════════════
    // APPEND — now creates atomic facts instead of concatenating blobs
    // ═══════════════════════════════════════════════════════════════════

    /// Append a fact to a memory block (e.g., "core:user_profile").
    /// In v4, supports canonical keys passed from extract_and_store_facts.
    ///
    /// If the block contains a canonical key (e.g. "core:user_profile:user.name"),
    /// it's used directly for upsert dedup. Otherwise, falls back to derive_fact_key.
    pub async fn append_memory(
        &self,
        agent_id: &str,
        block: &str,
        content: &str,
    ) -> Result<String, String> {
        // Check if the block contains a canonical key (format: "core:category:canonical.key")
        // e.g. "core:user_profile:user.name" or "core:preferences:pref.language"
        let parts: Vec<&str> = block.splitn(3, ':').collect();
        let (key, category) = if parts.len() == 3 && parts[2].contains('.') {
            // Canonical key passed: use it directly
            // key = "core:user_profile:user.name", category from the block prefix
            (
                block.to_string(),
                block_to_category(&format!("{}:{}", parts[0], parts[1])),
            )
        } else {
            // Legacy path: derive key from content slug
            (derive_fact_key(block, content), block_to_category(block))
        };
        self.store_fact(agent_id, &key, content, &category).await
    }

    /// Upsert a core memory block by key.
    /// In v3, this creates/updates an atomic fact.
    pub async fn upsert_memory(
        &self,
        agent_id: &str,
        key: &str,
        content: &str,
        _context: &str,
    ) -> Result<String, String> {
        let category = if key.starts_with("core:persona") {
            "os_insight"
        } else if key.starts_with("core:user_profile") {
            "user_fact"
        } else {
            "uncategorized"
        };
        self.store_fact(agent_id, key, content, category).await
    }

    // ═══════════════════════════════════════════════════════════════════
    // UPDATE / DELETE
    // ═══════════════════════════════════════════════════════════════════

    /// Update an existing memory entry by its ID.
    pub async fn update_memory_entry(
        &self,
        agent_id: &str,
        entry_id: &str,
        content: Option<&str>,
        _tags: Option<Vec<String>>,
        _context: Option<&str>,
    ) -> Result<(), String> {
        if let Some(new_content) = content {
            let embedding = local_embeddings::embed_passage(new_content)?;
            let store = self.storage.lock().await;
            store
                .update_content(agent_id, entry_id, new_content, &embedding)
                .await?;
        }
        Ok(())
    }

    /// Delete a memory entry by ID.
    pub async fn delete_memory_entry(&self, agent_id: &str, entry_id: &str) -> Result<(), String> {
        let store = self.storage.lock().await;
        store.delete_by_id(agent_id, entry_id).await
    }

    /// Delete all memory entries, optionally filtered by agent_id. None = delete all agents.
    pub async fn delete_all_memories(&self, agent_id: Option<&str>) -> Result<(), String> {
        let store = self.storage.lock().await;
        store.delete_all(agent_id).await
    }

    // ═══════════════════════════════════════════════════════════════════
    // SEARCH / STATS (backwards compat)
    // ═══════════════════════════════════════════════════════════════════

    /// Search memories using text query + optional filters.
    /// Replaces the old ExtendedMemoryManager search.
    pub async fn search_extended(&self, query: MemoryQuery) -> Result<MemoryResponse, String> {
        let start = std::time::Instant::now();
        let agent_filter = query.agent_id.as_deref();
        let limit = query.limit;

        let facts = if let Some(q) = &query.query {
            let query_vec = local_embeddings::embed(q)?;
            let store = self.storage.lock().await;
            store
                .search_semantic(&query_vec, agent_filter, None, limit)
                .await
        } else {
            let store = self.storage.lock().await;
            if let Some(aid) = agent_filter {
                store.get_recent(aid, limit).await
            } else {
                // No agent filter, no query → return ALL recent facts (Settings UI browser)
                store.get_all_recent(limit).await
            }
        };

        let entries: Vec<MemoryEntry> = facts.iter().map(|f| f.to_memory_entry()).collect();
        let total = entries.len();
        Ok(MemoryResponse::new(
            entries,
            total,
            start.elapsed().as_millis() as u64,
        ))
    }

    /// Get agent memory statistics.
    pub async fn get_agent_stats(
        &self,
        agent_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, String> {
        let store = self.storage.lock().await;
        store.get_stats(agent_id).await
    }

    /// Archive conversation turns (bulk write for context paging).
    pub async fn archive_conversation_turns(
        &self,
        agent_id: &str,
        turns: Vec<(String, String)>,
    ) -> Result<(), String> {
        let timestamp = now_unix();
        for (role, content) in turns {
            let key = format!("conversation:{}:{}", timestamp, role);
            let fact_content = format!("[{}] {}", role, content);
            self.store_fact(agent_id, &key, &fact_content, "conversation")
                .await?;
        }
        Ok(())
    }

    /// Primary entry point for agents to store memories.
    pub async fn store(
        &self,
        agent_id: &str,
        content: &str,
        context: &str,
    ) -> Result<String, String> {
        self.write_agentic(agent_id, content, context).await
    }

    /// Update memory configuration at runtime.
    /// In v3, most config is no longer needed since LanceDB handles storage.
    pub fn update_config(
        &mut self,
        _auto_tagging: bool,
        _compaction_threshold: u8,
        _max_per_agent: u32,
    ) {
        println!("[MemoryManager] Config update noted (v3: LanceDB manages storage natively).");
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MemoryFact — the atomic unit of memory in v3
// ═══════════════════════════════════════════════════════════════════════

/// A single atomic fact stored in LanceDB.
#[derive(Debug, Clone)]
pub struct MemoryFact {
    pub id: String,
    pub agent_id: String,
    pub key: String,
    pub content: String,
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// L2 distance from the query vector (only populated by search_semantic).
    /// For normalized vectors: distance < 0.3 means cosine similarity > 0.85.
    pub distance: Option<f32>,
}

impl MemoryFact {
    /// Convert to the legacy MemoryEntry type for backwards compatibility.
    pub fn to_memory_entry(&self) -> MemoryEntry {
        MemoryEntry {
            id: self.id.clone(),
            agent_id: self.agent_id.clone(),
            key: self.key.clone(),
            content: self.content.clone(),
            tags: vec![self.category.clone()],
            keywords: vec![],
            context: self.category.clone(),
            created_at: self.created_at as u64,
            updated_at: self.updated_at as u64,
            access_count: 0,
            similarity_score: None,
            category: MemoryCategory::from_str_loose(&self.category),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// RAM Cache (unchanged — fast exact key lookups)
// ═══════════════════════════════════════════════════════════════════════

struct MemoryRamCache {
    store: HashMap<String, String>,
}

impl MemoryRamCache {
    fn new() -> Self {
        Self {
            store: HashMap::new(),
        }
    }
    fn get(&self, key: &str) -> Option<String> {
        self.store.get(key).cloned()
    }
    fn set(&mut self, key: String, value: String) {
        self.store.insert(key, value);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// StorageManager v3 — LanceDB with enriched schema
// ═══════════════════════════════════════════════════════════════════════

struct StorageManager {
    table: Table,
    #[allow(dead_code)]
    conn: Connection, // Kept for potential future operations (create index, etc.)
}

impl StorageManager {
    async fn init(conn: Connection) -> Self {
        let dim = local_embeddings::EMBEDDING_DIM as i32;
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("agent_id", DataType::Utf8, false),
            Field::new("key", DataType::Utf8, false),
            Field::new("content", DataType::Utf8, false),
            Field::new("category", DataType::Utf8, false),
            Field::new("created_at", DataType::Int64, false),
            Field::new("updated_at", DataType::Int64, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
                true,
            ),
        ]));

        // Drop old v2 table if it still exists (one-time migration cleanup)
        Self::drop_old_table(&conn).await;

        // Migration: v3 → v3.1 (multilingual-e5-small embeddings).
        // Old vectors from all-MiniLM-L6-v2 are incompatible with the new model.
        // Drop memory_v3 if a migration marker doesn't exist, then recreate.
        Self::migrate_embedding_model(&conn).await;

        // Use new table name "memory_v3" with enriched schema.
        let table = match conn.open_table("memory_v3").execute().await {
            Ok(t) => t,
            Err(lancedb::error::Error::TableNotFound { .. }) => {
                println!(
                    "[MemoryManager:v3] Creating new table 'memory_v3' with enriched schema..."
                );
                conn.create_empty_table("memory_v3", schema)
                    .execute()
                    .await
                    .expect("Failed to create memory_v3 table")
            }
            Err(e) => panic!("Failed to open memory_v3 table: {}", e),
        };

        Self { table, conn }
    }

    /// Insert or update a fact. Deletes existing row with same agent_id+key first, then inserts.
    async fn upsert_fact(&self, fact: &MemoryFact, vector: &[f32]) -> Result<(), String> {
        // Delete existing entry with same agent_id + key (if any)
        let filter = format!(
            "agent_id = '{}' AND key = '{}'",
            escape_sql(&fact.agent_id),
            escape_sql(&fact.key)
        );
        let _ = self.table.delete(&filter).await; // Ignore error if nothing to delete

        // Insert new row
        self.insert_fact(fact, vector).await
    }

    /// Insert a new fact row into LanceDB.
    async fn insert_fact(&self, fact: &MemoryFact, vector: &[f32]) -> Result<(), String> {
        let schema = self.table.schema().await.map_err(|e| e.to_string())?;
        let dim = local_embeddings::EMBEDDING_DIM as i32;

        let mut id_b = StringBuilder::new();
        let mut agent_b = StringBuilder::new();
        let mut key_b = StringBuilder::new();
        let mut content_b = StringBuilder::new();
        let mut cat_b = StringBuilder::new();
        let mut created_b = Int64Builder::new();
        let mut updated_b = Int64Builder::new();
        let mut vec_b = FixedSizeListBuilder::new(Float32Builder::new(), dim);

        id_b.append_value(&fact.id);
        agent_b.append_value(&fact.agent_id);
        key_b.append_value(&fact.key);
        content_b.append_value(&fact.content);
        cat_b.append_value(&fact.category);
        created_b.append_value(fact.created_at);
        updated_b.append_value(fact.updated_at);

        let vec_values = vec_b.values();
        for &v in vector {
            vec_values.append_value(v);
        }
        vec_b.append(true);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(id_b.finish()),
                Arc::new(agent_b.finish()),
                Arc::new(key_b.finish()),
                Arc::new(content_b.finish()),
                Arc::new(cat_b.finish()),
                Arc::new(created_b.finish()),
                Arc::new(updated_b.finish()),
                Arc::new(vec_b.finish()),
            ],
        )
        .map_err(|e| e.to_string())?;

        let batches = arrow::record_batch::RecordBatchIterator::new(vec![Ok(batch)], schema);
        self.table
            .add(Box::new(batches))
            .execute()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Get a single fact by exact agent_id + key.
    async fn get_by_key(&self, agent_id: &str, key: &str) -> Option<String> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let filter = format!(
            "agent_id = '{}' AND key = '{}'",
            escape_sql(agent_id),
            escape_sql(key)
        );
        let mut results = self
            .table
            .query()
            .only_if(filter)
            .limit(1)
            .execute()
            .await
            .ok()?;

        if let Some(Ok(batch)) = results.next().await {
            let content_col = batch.column_by_name("content")?;
            let arr = content_col
                .as_any()
                .downcast_ref::<arrow::array::StringArray>()?;
            if arr.len() > 0 {
                return Some(arr.value(0).to_string());
            }
        }
        None
    }

    /// Semantic vector search with optional agent_id and category filters.
    async fn search_semantic(
        &self,
        query_vec: &[f32],
        agent_id: Option<&str>,
        category: Option<&str>,
        limit: usize,
    ) -> Vec<MemoryFact> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        // Build SQL filter string
        let mut filters: Vec<String> = Vec::new();
        if let Some(aid) = agent_id {
            filters.push(format!("agent_id = '{}'", escape_sql(aid)));
        }
        if let Some(cat) = category {
            filters.push(format!("category = '{}'", escape_sql(cat)));
        }
        let filter_str = if filters.is_empty() {
            None
        } else {
            Some(filters.join(" AND "))
        };

        // Build and execute query — apply filter before or after nearest_to
        let base = self.table.query();
        let vector_query = match base.nearest_to(query_vec) {
            Ok(q) => q,
            Err(_) => return vec![],
        };

        // Apply filter if present, then limit and execute
        let mut results = if let Some(f) = filter_str {
            match vector_query.only_if(f).limit(limit).execute().await {
                Ok(r) => r,
                Err(_) => return vec![],
            }
        } else {
            match vector_query.limit(limit).execute().await {
                Ok(r) => r,
                Err(_) => return vec![],
            }
        };

        Self::collect_facts(&mut results).await
    }

    /// Get all facts for an agent with a specific category.
    async fn get_by_category(&self, agent_id: &str, category: &str) -> Vec<MemoryFact> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let filter = format!(
            "agent_id = '{}' AND category = '{}'",
            escape_sql(agent_id),
            escape_sql(category)
        );
        let mut results = match self
            .table
            .query()
            .only_if(filter)
            .limit(200) // reasonable upper bound
            .execute()
            .await
        {
            Ok(r) => r,
            Err(_) => return vec![],
        };

        Self::collect_facts(&mut results).await
    }

    /// Get all facts matching a key prefix.
    async fn get_by_key_prefix(&self, agent_id: &str, prefix: &str) -> Vec<MemoryFact> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let filter = format!(
            "agent_id = '{}' AND key LIKE '{}%'",
            escape_sql(agent_id),
            escape_sql(prefix)
        );
        let mut results = match self
            .table
            .query()
            .only_if(filter)
            .limit(200)
            .execute()
            .await
        {
            Ok(r) => r,
            Err(_) => return vec![],
        };

        Self::collect_facts(&mut results).await
    }

    /// Get recent facts for an agent, ordered by updated_at descending.
    async fn get_recent(&self, agent_id: &str, limit: usize) -> Vec<MemoryFact> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let filter = format!("agent_id = '{}'", escape_sql(agent_id));
        let mut results = match self
            .table
            .query()
            .only_if(filter)
            .limit(limit)
            .execute()
            .await
        {
            Ok(r) => r,
            Err(_) => return vec![],
        };

        Self::collect_facts(&mut results).await
    }

    /// Update the content (and re-embed) of an existing fact by its ID.
    async fn update_content(
        &self,
        agent_id: &str,
        entry_id: &str,
        new_content: &str,
        vector: &[f32],
    ) -> Result<(), String> {
        // Delete old row
        let filter = format!(
            "agent_id = '{}' AND id = '{}'",
            escape_sql(agent_id),
            escape_sql(entry_id)
        );
        let _ = self.table.delete(&filter).await;

        // Re-insert with updated content
        let now = now_unix();
        let fact = MemoryFact {
            id: entry_id.to_string(),
            agent_id: agent_id.to_string(),
            key: String::new(), // Will be populated from old data if needed
            content: new_content.to_string(),
            category: "uncategorized".to_string(),
            created_at: now,
            updated_at: now,
            distance: None,
        };
        self.insert_fact(&fact, vector).await
    }

    /// Delete a fact by its ID.
    async fn delete_by_id(&self, agent_id: &str, entry_id: &str) -> Result<(), String> {
        let filter = format!(
            "agent_id = '{}' AND id = '{}'",
            escape_sql(agent_id),
            escape_sql(entry_id)
        );
        self.table.delete(&filter).await.map_err(|e| e.to_string())
    }

    /// Delete all facts, optionally filtered by agent_id. None = delete all agents.
    async fn delete_all(&self, agent_id: Option<&str>) -> Result<(), String> {
        let filter = match agent_id {
            Some(aid) => format!("agent_id = '{}'", escape_sql(aid)),
            None => "1 = 1".to_string(),
        };
        self.table.delete(&filter).await.map_err(|e| e.to_string())
    }

    /// Get recent facts across ALL agents (no agent filter).
    /// Used by the Settings UI "Memories (long-term)" browser when no agent is selected.
    async fn get_all_recent(&self, limit: usize) -> Vec<MemoryFact> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let mut results = match self.table.query().limit(limit).execute().await {
            Ok(r) => r,
            Err(_) => return vec![],
        };

        Self::collect_facts(&mut results).await
    }

    /// Drop the old "memory_store" table if it exists (v2 → v3 migration cleanup).
    async fn drop_old_table(conn: &Connection) {
        match conn.drop_table("memory_store").await {
            Ok(_) => println!("[MemoryManager:v3] Dropped old 'memory_store' table."),
            Err(_) => {} // Table doesn't exist — that's fine
        }
    }

    /// Migration: Drop memory_v3 table if it was created with the old embedding model.
    /// Uses a marker table "memory_v3_e5" to track if migration has been done.
    /// Without this, old all-MiniLM-L6-v2 vectors would be searched with multilingual-e5-small
    /// queries, giving random/incorrect semantic similarity results.
    async fn migrate_embedding_model(conn: &Connection) {
        // Check if the migration marker exists
        match conn.open_table("memory_v3_e5").execute().await {
            Ok(_) => return, // Already migrated
            Err(_) => {}     // Marker doesn't exist — need to migrate
        }

        // Drop the old memory_v3 table (vectors are from the wrong model)
        match conn.drop_table("memory_v3").await {
            Ok(_) => println!("[MemoryManager:v3.1] Dropped old memory_v3 table (migrating to multilingual-e5-small embeddings)."),
            Err(_) => {} // Table doesn't exist — fresh install
        }

        // Create migration marker table
        use arrow::array::StringBuilder;
        use arrow::datatypes::{DataType, Field, Schema};
        let marker_schema = Arc::new(Schema::new(vec![Field::new(
            "model",
            DataType::Utf8,
            false,
        )]));
        let mut model_builder = StringBuilder::new();
        model_builder.append_value("multilingual-e5-small");
        let batch = RecordBatch::try_new(
            marker_schema.clone(),
            vec![Arc::new(model_builder.finish())],
        );
        if let Ok(batch) = batch {
            let batches =
                arrow::record_batch::RecordBatchIterator::new(vec![Ok(batch)], marker_schema);
            let _ = conn
                .create_table("memory_v3_e5", Box::new(batches))
                .execute()
                .await;
            println!("[MemoryManager:v3.1] Created migration marker 'memory_v3_e5'.");
        }
    }

    /// Get basic stats for an agent's memories.
    async fn get_stats(
        &self,
        agent_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, String> {
        use lancedb::query::{ExecutableQuery, QueryBase};

        let filter = format!("agent_id = '{}'", escape_sql(agent_id));
        let mut results = self
            .table
            .query()
            .only_if(filter)
            .limit(10000)
            .execute()
            .await
            .map_err(|e| e.to_string())?;

        let mut total: usize = 0;
        let mut categories: HashMap<String, usize> = HashMap::new();

        while let Some(Ok(batch)) = results.next().await {
            total += batch.num_rows();
            if let Some(cat_col) = batch.column_by_name("category") {
                if let Some(cat_arr) = cat_col.as_any().downcast_ref::<arrow::array::StringArray>()
                {
                    for i in 0..cat_arr.len() {
                        if !cat_arr.is_null(i) {
                            *categories.entry(cat_arr.value(i).to_string()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        let mut stats = HashMap::new();
        stats.insert("total_entries".to_string(), serde_json::json!(total));
        stats.insert("categories".to_string(), serde_json::json!(categories));
        Ok(stats)
    }

    /// Collect all MemoryFacts from a LanceDB result stream.
    async fn collect_facts(
        results: &mut (impl futures_util::Stream<Item = Result<RecordBatch, lancedb::error::Error>>
                  + Unpin),
    ) -> Vec<MemoryFact> {
        let mut facts = Vec::new();
        while let Some(Ok(batch)) = results.next().await {
            facts.extend(Self::extract_facts_from_batch(&batch));
        }
        facts
    }

    /// Extract MemoryFact structs from a RecordBatch.
    fn extract_facts_from_batch(batch: &RecordBatch) -> Vec<MemoryFact> {
        let id_col = batch.column_by_name("id").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::StringArray>()
                .map(|a| a.clone())
        });
        let agent_col = batch.column_by_name("agent_id").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::StringArray>()
                .map(|a| a.clone())
        });
        let key_col = batch.column_by_name("key").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::StringArray>()
                .map(|a| a.clone())
        });
        let content_col = batch.column_by_name("content").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::StringArray>()
                .map(|a| a.clone())
        });
        let cat_col = batch.column_by_name("category").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::StringArray>()
                .map(|a| a.clone())
        });
        let created_col = batch.column_by_name("created_at").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::Int64Array>()
                .map(|a| a.clone())
        });
        let updated_col = batch.column_by_name("updated_at").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::Int64Array>()
                .map(|a| a.clone())
        });
        // _distance is auto-added by LanceDB on vector search queries
        let dist_col = batch.column_by_name("_distance").and_then(|c| {
            c.as_any()
                .downcast_ref::<arrow::array::Float32Array>()
                .map(|a| a.clone())
        });

        let mut facts = Vec::new();
        for i in 0..batch.num_rows() {
            facts.push(MemoryFact {
                id: id_col
                    .as_ref()
                    .map(|a| a.value(i).to_string())
                    .unwrap_or_default(),
                agent_id: agent_col
                    .as_ref()
                    .map(|a| a.value(i).to_string())
                    .unwrap_or_default(),
                key: key_col
                    .as_ref()
                    .map(|a| a.value(i).to_string())
                    .unwrap_or_default(),
                content: content_col
                    .as_ref()
                    .map(|a| a.value(i).to_string())
                    .unwrap_or_default(),
                category: cat_col
                    .as_ref()
                    .map(|a| a.value(i).to_string())
                    .unwrap_or_default(),
                created_at: created_col.as_ref().map(|a| a.value(i)).unwrap_or(0),
                updated_at: updated_col.as_ref().map(|a| a.value(i)).unwrap_or(0),
                distance: dist_col.as_ref().map(|a| a.value(i)),
            });
        }
        facts
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Escape single quotes for SQL filter strings.
fn escape_sql(s: &str) -> String {
    s.replace('\'', "''")
}

/// Derive a structured key for an atomic fact based on block name and content.
/// E.g., block="core:user_profile", content="The dog's name is Buster" → "user_profile:the_dogs_name_is_buster"
fn derive_fact_key(block: &str, content: &str) -> String {
    let prefix = block.trim_start_matches("core:");
    let slug: String = content
        .to_lowercase()
        .chars()
        .take(50)
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    format!("{}:{}", prefix, slug)
}

/// Map block names (e.g., "core:user_profile") to category strings.
fn block_to_category(block: &str) -> String {
    match block.trim_start_matches("core:") {
        "user_profile" => "user_fact".to_string(),
        "persona" => "os_insight".to_string(),
        "preferences" => "preference".to_string(),
        other => other.to_string(),
    }
}

/// Map context strings to category strings.
fn context_to_category(context: &str) -> String {
    match context {
        "user_fact" | "fact" => "user_fact".to_string(),
        "preference" | "pref" => "preference".to_string(),
        "os_insight" | "insight" => "os_insight".to_string(),
        "pattern" => "pattern".to_string(),
        "conversation" | "context_paging" | "archive" => "conversation".to_string(),
        "evolve" => "uncategorized".to_string(),
        _ => "uncategorized".to_string(),
    }
}
