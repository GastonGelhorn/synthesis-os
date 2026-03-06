//! Semantic Intent Cache: learns tool usage patterns via LanceDB vector search.
//!
//! When a user query closely matches a previously successful tool execution,
//! the system can bypass the full Agent pipeline and use a micro-LLM call
//! (~50 tokens) to extract arguments, then execute the tool directly.

use crate::local_embeddings;
use arrow::array::{
    Array, FixedSizeListBuilder, Float32Builder, Int32Builder, Int64Builder, RecordBatch,
    StringBuilder,
};
use arrow::datatypes::{DataType, Field, Schema};
use futures_util::StreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::{Connection, Table};
use std::path::Path;
use std::sync::Arc;

const TABLE_NAME: &str = "intent_cache";

/// Open a LanceDB connection (re-exported so Tauri app doesn't need lancedb dep).
pub async fn connect_db(db_path: &Path) -> Result<Connection, String> {
    lancedb::connect(db_path.to_str().unwrap_or_default())
        .execute()
        .await
        .map_err(|e| format!("LanceDB connect error: {}", e))
}

/// Drop the intent_cache table (for the "Clear Cache" button).
pub async fn clear_table(db_path: &Path) -> Result<(), String> {
    let conn = connect_db(db_path).await?;
    let _ = conn.drop_table(TABLE_NAME).await;
    println!("[IntentCache] Cache cleared.");
    Ok(())
}

/// A cached intent match returned by `find_intent`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CachedIntent {
    pub tool_name: String,
    pub tool_schema: String,
    pub example_input: String,
    pub original_query: String,
    pub similarity: f32,
    pub success_count: i32,
}

/// Stats about the intent cache.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CacheStats {
    pub total_shortcuts: usize,
    pub total_executions: i64,
}

/// Manages the `intent_cache` LanceDB table.
pub struct IntentCache {
    table: Table,
}

fn build_schema() -> Arc<Schema> {
    let dim = local_embeddings::EMBEDDING_DIM as i32;
    Arc::new(Schema::new(vec![
        Field::new("query", DataType::Utf8, false),
        Field::new("tool_name", DataType::Utf8, false),
        Field::new("tool_schema", DataType::Utf8, true),
        Field::new("tool_input_example", DataType::Utf8, true),
        Field::new("success_count", DataType::Int32, false),
        Field::new("created_at", DataType::Int64, false),
        Field::new("updated_at", DataType::Int64, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dim,
            ),
            true,
        ),
    ]))
}

impl IntentCache {
    /// Open or create the intent_cache table.
    pub async fn init(conn: &Connection) -> Result<Self, String> {
        let schema = build_schema();

        let table = match conn.open_table(TABLE_NAME).execute().await {
            Ok(t) => t,
            Err(lancedb::error::Error::TableNotFound { .. }) => {
                conn.create_empty_table(TABLE_NAME, schema)
                    .execute()
                    .await
                    .map_err(|e| format!("Failed to create intent_cache table: {}", e))?
            }
            Err(e) => return Err(format!("Failed to open intent_cache: {}", e)),
        };

        println!("[IntentCache] Table ready.");
        Ok(Self { table })
    }

    /// Search for a cached intent that semantically matches the query.
    /// Returns `Some(CachedIntent)` if similarity >= threshold (cosine).
    pub async fn find_intent(
        &self,
        query: &str,
        threshold: f32,
    ) -> Result<Option<CachedIntent>, String> {
        let query_vec = local_embeddings::embed(query)?;

        let mut results = self
            .table
            .query()
            .nearest_to(&*query_vec)
            .map_err(|e| format!("Intent query build error: {}", e))?
            .limit(1)
            .execute()
            .await
            .map_err(|e| format!("Intent query error: {}", e))?;

        while let Some(Ok(batch)) = results.next().await {
            let dist_col = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Float32Array>());
            let tool_col = batch
                .column_by_name("tool_name")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let schema_col = batch
                .column_by_name("tool_schema")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let example_col = batch
                .column_by_name("tool_input_example")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let query_col = batch
                .column_by_name("query")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let count_col = batch
                .column_by_name("success_count")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int32Array>());

            if let (Some(dist), Some(tool), Some(schema), Some(example), Some(qry)) =
                (dist_col, tool_col, schema_col, example_col, query_col)
            {
                if dist.len() == 0 || dist.is_null(0) {
                    continue;
                }

                let l2_dist = dist.value(0);
                // Convert L2 distance to cosine similarity for normalized vectors:
                // cosine_sim = 1 - (l2_dist² / 2)
                let cosine_sim = 1.0 - (l2_dist * l2_dist) / 2.0;

                if cosine_sim >= threshold {
                    let intent = CachedIntent {
                        tool_name: tool.value(0).to_string(),
                        tool_schema: schema.value(0).to_string(),
                        example_input: example.value(0).to_string(),
                        original_query: qry.value(0).to_string(),
                        similarity: cosine_sim,
                        success_count: count_col.map_or(0, |c| c.value(0)),
                    };

                    println!(
                        "[IntentCache] HIT: '{}' -> tool='{}' (sim={:.3}, count={})",
                        &query[..query.len().min(60)],
                        intent.tool_name,
                        cosine_sim,
                        intent.success_count,
                    );

                    return Ok(Some(intent));
                } else {
                    println!(
                        "[IntentCache] MISS: '{}' best_sim={:.3} < threshold={:.2}",
                        &query[..query.len().min(60)],
                        cosine_sim,
                        threshold,
                    );
                }
            }
        }

        Ok(None)
    }

    /// Learn a new intent from a successful tool execution.
    pub async fn learn_intent(
        &self,
        query: &str,
        tool_name: &str,
        tool_schema: &str,
        tool_input: &str,
    ) -> Result<(), String> {
        let query_vec = local_embeddings::embed(query)?;
        let now = chrono::Utc::now().timestamp_millis();
        let schema = build_schema();
        let dim = local_embeddings::EMBEDDING_DIM as i32;

        let mut query_builder = StringBuilder::new();
        let mut tool_builder = StringBuilder::new();
        let mut schema_builder = StringBuilder::new();
        let mut example_builder = StringBuilder::new();
        let mut count_builder = Int32Builder::new();
        let mut created_builder = Int64Builder::new();
        let mut updated_builder = Int64Builder::new();
        let float_builder = Float32Builder::new();
        let mut vec_builder = FixedSizeListBuilder::new(float_builder, dim);

        query_builder.append_value(query);
        tool_builder.append_value(tool_name);
        schema_builder.append_value(tool_schema);
        example_builder.append_value(tool_input);
        count_builder.append_value(1);
        created_builder.append_value(now);
        updated_builder.append_value(now);

        let vec_values = vec_builder.values();
        for &v in &query_vec {
            vec_values.append_value(v);
        }
        vec_builder.append(true);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(query_builder.finish()),
                Arc::new(tool_builder.finish()),
                Arc::new(schema_builder.finish()),
                Arc::new(example_builder.finish()),
                Arc::new(count_builder.finish()),
                Arc::new(created_builder.finish()),
                Arc::new(updated_builder.finish()),
                Arc::new(vec_builder.finish()),
            ],
        )
        .map_err(|e| format!("RecordBatch error: {}", e))?;

        let batches =
            arrow::record_batch::RecordBatchIterator::new(vec![Ok(batch)], schema);
        self.table
            .add(Box::new(batches))
            .execute()
            .await
            .map_err(|e| format!("Failed to insert intent: {}", e))?;

        println!(
            "[IntentCache] LEARNED: '{}' -> tool='{}'",
            &query[..query.len().min(60)],
            tool_name,
        );

        Ok(())
    }

    /// Get statistics about the cache.
    pub async fn get_stats(&self) -> Result<CacheStats, String> {
        let mut results = self
            .table
            .query()
            .execute()
            .await
            .map_err(|e| format!("Stats query error: {}", e))?;

        let mut total_shortcuts: usize = 0;
        let mut total_executions: i64 = 0;

        while let Some(Ok(batch)) = results.next().await {
            total_shortcuts += batch.num_rows();
            if let Some(count_col) = batch
                .column_by_name("success_count")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int32Array>())
            {
                for i in 0..count_col.len() {
                    if !count_col.is_null(i) {
                        total_executions += count_col.value(i) as i64;
                    }
                }
            }
        }

        Ok(CacheStats {
            total_shortcuts,
            total_executions,
        })
    }

    /// Wipe the entire intent cache.
    pub async fn clear(&self, conn: &Connection) -> Result<(), String> {
        let _ = conn.drop_table(TABLE_NAME).await;
        println!("[IntentCache] Cache cleared.");
        Ok(())
    }
}
