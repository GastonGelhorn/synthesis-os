//! Tool RAG: Semantic tool retrieval using LanceDB vector search.
//!
//! Instead of hardcoded agent→tool mappings, we embed all tool descriptions
//! into a LanceDB table and retrieve the top-K most relevant tools for each query.
//! This eliminates the Manager routing step and lets a single agent dynamically
//! select which tools it needs.
//!
//! v3: Uses multilingual-e5-small (via ONNX Runtime) for proper Spanish/English
//! support. Tool descriptions are embedded as "passages" at boot, queries as "queries"
//! at runtime. The E5 asymmetric embedding approach significantly improves retrieval
//! accuracy for non-English queries.

use crate::local_embeddings;
use arrow::array::{Array, FixedSizeListBuilder, Float32Builder, RecordBatch, StringBuilder};
use arrow::datatypes::{DataType, Field, Schema};
use futures_util::StreamExt;
use lancedb::{Connection, Table};
use std::collections::HashSet;
use std::sync::Arc;

/// Default number of tools to retrieve per query.
pub const DEFAULT_TOP_K: usize = 12;

/// Tools that are ALWAYS included regardless of RAG results.
/// Memory tools (core_memory_append, core_memory_replace, remember) are no longer
/// registered — fact storage is automatic via extract_and_store_facts().
const ALWAYS_INCLUDE_TOOLS: &[&str] = &["notify", "web_search", "read_page"];

/// Manages the tool_definitions LanceDB table for semantic tool retrieval.
pub struct ToolRag {
    table: Table,
    /// All registered tool names (for fallback when RAG is disabled)
    all_tool_names: Vec<String>,
}

impl ToolRag {
    /// Initialize the Tool RAG table. Call after all tools are registered.
    /// Embeds each tool's `"{name}: {description}"` into a 384-dim vector using local model.
    ///
    /// This no longer requires an OpenAI client — embeddings are computed locally.
    pub async fn init(conn: &Connection, tool_defs: &[serde_json::Value]) -> Result<Self, String> {
        println!(
            "[ToolRAG] Initializing with {} tool definitions (local embeddings)...",
            tool_defs.len()
        );

        let dim = local_embeddings::EMBEDDING_DIM as i32;

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("description", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
                true,
            ),
        ]));

        // Drop and recreate table to ensure it's in sync with current tools
        let _ = conn.drop_table("tool_definitions").await;
        let table = conn
            .create_empty_table("tool_definitions", schema.clone())
            .execute()
            .await
            .map_err(|e| format!("Failed to create tool_definitions table: {}", e))?;

        let mut all_tool_names = Vec::new();

        // Collect texts to embed
        let mut texts_to_embed: Vec<String> = Vec::new();
        let mut tool_entries: Vec<(String, String, String)> = Vec::new(); // (id, name, description)

        for def in tool_defs {
            let name = match def
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
            {
                Some(n) => n,
                None => continue,
            };
            let desc = def
                .get("function")
                .and_then(|f| f.get("description"))
                .and_then(|d| d.as_str())
                .unwrap_or("");

            let embed_text = format!("{}: {}", name, desc);
            texts_to_embed.push(embed_text);
            tool_entries.push((name.to_string(), name.to_string(), desc.to_string()));
            all_tool_names.push(name.to_string());
        }

        if texts_to_embed.is_empty() {
            println!("[ToolRAG] No tools to embed.");
            return Ok(Self {
                table,
                all_tool_names,
            });
        }

        // Embed ALL tools in a single local batch call (~10-20ms total for ~50 tools)
        let start = std::time::Instant::now();
        let all_embeddings = local_embeddings::embed_batch(&texts_to_embed)?;
        let embed_ms = start.elapsed().as_millis();
        println!(
            "[ToolRAG] Batch-embedded {} tools locally in {}ms",
            all_embeddings.len(),
            embed_ms
        );

        // Insert all tool embeddings into the table
        for (i, (id, name, desc)) in tool_entries.iter().enumerate() {
            if i >= all_embeddings.len() {
                break;
            }

            let mut id_builder = StringBuilder::new();
            let mut name_builder = StringBuilder::new();
            let mut desc_builder = StringBuilder::new();
            let item_builder = Float32Builder::new();
            let mut vec_builder = FixedSizeListBuilder::new(item_builder, dim);

            id_builder.append_value(id);
            name_builder.append_value(name);
            desc_builder.append_value(desc);

            let vec_values = vec_builder.values();
            for &v in &all_embeddings[i] {
                vec_values.append_value(v);
            }
            vec_builder.append(true);

            let batch = RecordBatch::try_new(
                schema.clone(),
                vec![
                    Arc::new(id_builder.finish()),
                    Arc::new(name_builder.finish()),
                    Arc::new(desc_builder.finish()),
                    Arc::new(vec_builder.finish()),
                ],
            )
            .map_err(|e| format!("RecordBatch error: {}", e))?;

            let batches =
                arrow::record_batch::RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
            table
                .add(Box::new(batches))
                .execute()
                .await
                .map_err(|e| format!("Failed to insert tool embedding: {}", e))?;
        }

        println!(
            "[ToolRAG] Successfully embedded {} tools (local, {}ms).",
            all_embeddings.len(),
            embed_ms
        );
        Ok(Self {
            table,
            all_tool_names,
        })
    }

    /// Retrieve the top-K most relevant tool names for a given query.
    /// Always includes ALWAYS_INCLUDE_TOOLS regardless of similarity.
    ///
    /// Uses local embeddings — no network calls, ~2-5ms total.
    ///
    /// Distance threshold: if the BEST match has L2 distance > MAX_RELEVANT_DISTANCE,
    /// it means the query has no strong tool match (e.g. Spanish query vs English descriptions,
    /// or a pure knowledge question). In that case, returns ALL tools so the LLM can decide.
    pub async fn retrieve(&self, query: &str, top_k: usize) -> Result<Vec<String>, String> {
        /// L2 distance threshold for "relevant" matches.
        /// For L2-normalized vectors: distance < 0.8 ≈ cosine similarity > 0.68 (moderate relevance).
        /// If ALL results are above this, the query has no good tool match.
        const MAX_RELEVANT_DISTANCE: f32 = 0.8;

        // 1. Embed the query locally (~2ms)
        let query_vec = local_embeddings::embed(query)?;

        // 2. Vector search against tool_definitions
        use lancedb::query::{ExecutableQuery, QueryBase};

        let mut results = self
            .table
            .query()
            .nearest_to(&*query_vec)
            .map_err(|e| format!("Query build error: {}", e))?
            .limit(top_k)
            .execute()
            .await
            .map_err(|e| format!("Query execution error: {}", e))?;

        let mut tool_names: Vec<String> = Vec::new();
        let mut best_distance: f32 = f32::MAX;

        while let Some(Ok(batch)) = results.next().await {
            let name_col = batch.column_by_name("name");
            let dist_col = batch.column_by_name("_distance");

            if let Some(name_array) =
                name_col.and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>())
            {
                let dist_array =
                    dist_col.and_then(|c| c.as_any().downcast_ref::<arrow::array::Float32Array>());

                for i in 0..name_array.len() {
                    if name_array.is_null(i) {
                        continue;
                    }
                    let name = name_array.value(i).to_string();
                    let dist = dist_array
                        .and_then(|d| if d.is_null(i) { None } else { Some(d.value(i)) })
                        .unwrap_or(f32::MAX);

                    if dist < best_distance {
                        best_distance = dist;
                    }

                    // Only include tools that are reasonably relevant
                    if dist <= MAX_RELEVANT_DISTANCE {
                        tool_names.push(name);
                    }
                }
            }
        }

        // If no tools passed the threshold, the query has no strong tool match.
        // Return ALL tools so the LLM can decide (it will likely give a direct answer).
        if tool_names.is_empty() {
            println!(
                "[ToolRAG] No tools below distance threshold ({:.2}) for '{}' (best={:.3}). Using all {} tools.",
                MAX_RELEVANT_DISTANCE,
                &query[..query.len().min(60)],
                best_distance,
                self.all_tool_names.len()
            );
            return Ok(self.all_tool_names.clone());
        }

        // Always include base tools
        let mut result_set: HashSet<String> = tool_names.into_iter().collect();
        for &tool in ALWAYS_INCLUDE_TOOLS {
            if self.all_tool_names.contains(&tool.to_string()) {
                result_set.insert(tool.to_string());
            }
        }

        let final_tools: Vec<String> = result_set.into_iter().collect();
        println!(
            "[ToolRAG] Retrieved {} tools for query '{}' (best_dist={:.3}): [{}]",
            final_tools.len(),
            &query[..query.len().min(60)],
            best_distance,
            final_tools.join(", ")
        );
        Ok(final_tools)
    }

    /// Get all tool names (fallback when RAG is disabled).
    pub fn all_tools(&self) -> &[String] {
        &self.all_tool_names
    }
}
