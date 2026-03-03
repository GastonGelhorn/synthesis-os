use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Category of a memory entry for intelligent classification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    /// Personal info about the user (name, pets, job, location, family)
    UserFact,
    /// How the user prefers to interact (language, tone, topics)
    Preference,
    /// What the OS has learned about serving this user  
    OsInsight,
    /// Behavioral patterns across sessions
    Pattern,
    /// Archived conversation turns (context paging)
    Conversation,
    /// Legacy / unclassified entries
    Uncategorized,
}

impl Default for MemoryCategory {
    fn default() -> Self {
        MemoryCategory::Uncategorized
    }
}

impl std::fmt::Display for MemoryCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryCategory::UserFact => write!(f, "user_fact"),
            MemoryCategory::Preference => write!(f, "preference"),
            MemoryCategory::OsInsight => write!(f, "os_insight"),
            MemoryCategory::Pattern => write!(f, "pattern"),
            MemoryCategory::Conversation => write!(f, "conversation"),
            MemoryCategory::Uncategorized => write!(f, "uncategorized"),
        }
    }
}

impl MemoryCategory {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().trim() {
            "user_fact" | "userfact" | "fact" => MemoryCategory::UserFact,
            "preference" | "pref" => MemoryCategory::Preference,
            "os_insight" | "osinsight" | "insight" => MemoryCategory::OsInsight,
            "pattern" => MemoryCategory::Pattern,
            "conversation" | "context_paging" | "archive" => MemoryCategory::Conversation,
            _ => MemoryCategory::Uncategorized,
        }
    }
}

/// A memory entry with full metadata for agentic operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub agent_id: String,
    pub key: String,
    pub content: String,
    pub tags: Vec<String>,
    pub keywords: Vec<String>,
    pub context: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub access_count: u64,
    pub similarity_score: Option<f32>,
    #[serde(default)]
    pub category: MemoryCategory,
}

impl MemoryEntry {
    pub fn new(agent_id: String, key: String, content: String, context: String) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            id: Uuid::new_v4().to_string(),
            agent_id,
            key,
            content,
            tags: Vec::new(),
            keywords: Vec::new(),
            context,
            created_at: now,
            updated_at: now,
            access_count: 0,
            similarity_score: None,
            category: MemoryCategory::Uncategorized,
        }
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_keywords(mut self, keywords: Vec<String>) -> Self {
        self.keywords = keywords;
        self
    }

    pub fn with_category(mut self, category: MemoryCategory) -> Self {
        self.category = category;
        self
    }
}

/// Query parameters for searching memories
#[derive(Debug, Clone)]
pub struct MemoryQuery {
    pub agent_id: Option<String>,
    pub query: Option<String>,
    pub tags: Option<Vec<String>>,
    pub keywords: Option<Vec<String>>,
    pub limit: usize,
    pub offset: usize,
    pub min_similarity: f32,
}

impl Default for MemoryQuery {
    fn default() -> Self {
        Self {
            agent_id: None,
            query: None,
            tags: None,
            keywords: None,
            limit: 10,
            offset: 0,
            min_similarity: 0.0,
        }
    }
}

/// Response from memory operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryResponse {
    pub entries: Vec<MemoryEntry>,
    pub total: usize,
    pub query_time_ms: u64,
}

impl MemoryResponse {
    pub fn new(entries: Vec<MemoryEntry>, total: usize, query_time_ms: u64) -> Self {
        Self {
            entries,
            total,
            query_time_ms,
        }
    }
}

/// Updates for partial modification of memory entries
#[derive(Debug, Clone, Default)]
pub struct MemoryUpdate {
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub keywords: Option<Vec<String>>,
    pub context: Option<String>,
}

impl MemoryUpdate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_content(mut self, content: String) -> Self {
        self.content = Some(content);
        self
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    pub fn with_keywords(mut self, keywords: Vec<String>) -> Self {
        self.keywords = Some(keywords);
        self
    }

    pub fn with_context(mut self, context: String) -> Self {
        self.context = Some(context);
        self
    }
}

/// Extended memory manager providing CRUD + agentic capabilities
/// Wraps and extends the base MemoryManager patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendedMemoryManager {
    entries: HashMap<String, HashMap<String, MemoryEntry>>, // agent_id -> id -> entry
    access_log: Vec<(String, u64)>,                         // (entry_id, access_time)
    pub max_entries_per_agent: usize,
}

impl ExtendedMemoryManager {
    /// Create a new extended memory manager
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            access_log: Vec::new(),
            max_entries_per_agent: 10000,
        }
    }

    /// Save metadata to disk
    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Load metadata from disk
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::new());
        }
        let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }

    /// Add a new memory entry
    pub fn add(&mut self, entry: MemoryEntry) -> Result<String, String> {
        let agent_id = entry.agent_id.clone();
        let entry_id = entry.id.clone();

        let agent_entries = self
            .entries
            .entry(agent_id.clone())
            .or_insert_with(HashMap::new);

        if agent_entries.len() >= self.max_entries_per_agent {
            return Err(format!(
                "Agent {} has reached max memory entries ({})",
                agent_id, self.max_entries_per_agent
            ));
        }

        agent_entries.insert(entry_id.clone(), entry);
        Ok(entry_id)
    }

    /// Upsert a memory entry by key (used for Core Memory blocks)
    pub fn upsert_by_key(
        &mut self,
        agent_id: &str,
        key: &str,
        content: &str,
        context: &str,
    ) -> Result<String, String> {
        let agent_entries = self
            .entries
            .entry(agent_id.to_string())
            .or_insert_with(HashMap::new);

        // Find existing entry with this key
        let existing_id = agent_entries
            .values()
            .find(|e| e.key == key)
            .map(|e| e.id.clone());

        if let Some(id) = existing_id {
            let update = MemoryUpdate::new()
                .with_content(content.to_string())
                .with_context(context.to_string());
            self.update(agent_id, &id, update)?;
            Ok(id)
        } else {
            let entry = MemoryEntry::new(
                agent_id.to_string(),
                key.to_string(),
                content.to_string(),
                context.to_string(),
            );
            self.add(entry)?;
            Ok("new".to_string())
        }
    }

    /// Append content to an existing memory block by key (used for Core Memory tools)
    pub fn append_by_key(
        &mut self,
        agent_id: &str,
        key: &str,
        content: &str,
    ) -> Result<String, String> {
        let agent_entries = self
            .entries
            .entry(agent_id.to_string())
            .or_insert_with(HashMap::new);

        // Find existing entry with this key
        let existing_id = agent_entries
            .values()
            .find(|e| e.key == key)
            .map(|e| (e.id.clone(), e.content.clone()));

        if let Some((id, old_content)) = existing_id {
            let new_content = format!("{}\n{}", old_content, content);
            let update = MemoryUpdate::new().with_content(new_content);
            self.update(agent_id, &id, update)?;
            Ok(id)
        } else {
            // If no block exists, create it
            let entry = MemoryEntry::new(
                agent_id.to_string(),
                key.to_string(),
                content.to_string(),
                "core_memory".to_string(),
            );
            self.add(entry)
        }
    }

    /// Retrieve a memory entry by ID
    pub fn get(&mut self, agent_id: &str, id: &str) -> Result<MemoryEntry, String> {
        let agent_entries = match self.entries.get_mut(agent_id) {
            Some(e) => e,
            None => return Err(format!("Agent {} not found", agent_id)), // Keep strict for 'get' if ID is provided
        };

        let mut entry = agent_entries
            .get(id)
            .ok_or_else(|| format!("Memory entry {} not found", id))?
            .clone();

        // Log access and increment count
        entry.access_count += 1;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.access_log.push((id.to_string(), now));

        // Update entry in storage
        agent_entries.insert(id.to_string(), entry.clone());

        Ok(entry)
    }

    /// Update an existing memory entry
    pub fn update(
        &mut self,
        agent_id: &str,
        id: &str,
        updates: MemoryUpdate,
    ) -> Result<(), String> {
        let agent_entries = match self.entries.get_mut(agent_id) {
            Some(e) => e,
            None => return Err(format!("Agent {} not found", agent_id)),
        };

        let entry = agent_entries
            .get_mut(id)
            .ok_or_else(|| format!("Memory entry {} not found", id))?;

        if let Some(content) = updates.content {
            entry.content = content;
        }
        if let Some(tags) = updates.tags {
            entry.tags = tags;
        }
        if let Some(keywords) = updates.keywords {
            entry.keywords = keywords;
        }
        if let Some(context) = updates.context {
            entry.context = context;
        }

        entry.updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Ok(())
    }

    /// Remove (soft delete) a memory entry
    pub fn remove(&mut self, agent_id: &str, id: &str) -> Result<(), String> {
        let agent_entries = self
            .entries
            .get_mut(agent_id)
            .ok_or_else(|| format!("Agent {} not found", agent_id))?;

        agent_entries
            .remove(id)
            .ok_or_else(|| format!("Memory entry {} not found", id))?;

        Ok(())
    }

    /// List memory entries for an agent with pagination
    pub fn list(
        &self,
        agent_id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<MemoryResponse, String> {
        let agent_entries = match self.entries.get(agent_id) {
            Some(e) => e,
            None => return Ok(MemoryResponse::new(Vec::new(), 0, 0)),
        };

        let total = agent_entries.len();
        let mut entries: Vec<MemoryEntry> = agent_entries
            .values()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect();

        // Sort by updated_at descending (most recent first)
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(MemoryResponse::new(entries, total, 0))
    }

    /// Search memories using metadata and semantic matching
    pub fn search(&self, query: MemoryQuery) -> Result<MemoryResponse, String> {
        let start_time = std::time::Instant::now();

        let mut results: Vec<MemoryEntry> = Vec::new();

        // If agent_id is specified, search within that agent
        let agent_ids: Vec<&String> = match &query.agent_id {
            Some(id) => {
                if self.entries.contains_key(id) {
                    vec![id]
                } else {
                    // Return empty results instead of error if agent not found
                    return Ok(MemoryResponse::new(
                        Vec::new(),
                        0,
                        start_time.elapsed().as_millis() as u64,
                    ));
                }
            }
            None => self.entries.keys().collect(),
        };

        for agent_id in agent_ids {
            if let Some(agent_entries) = self.entries.get(agent_id) {
                for entry in agent_entries.values() {
                    let mut matches = true;

                    // Filter by query text (simple substring match)
                    if let Some(q) = &query.query {
                        let query_lower = q.to_lowercase();
                        if !entry.content.to_lowercase().contains(&query_lower)
                            && !entry.key.to_lowercase().contains(&query_lower)
                        {
                            matches = false;
                        }
                    }

                    // Filter by tags
                    if let Some(tags) = &query.tags {
                        let has_tag = tags.iter().any(|t| entry.tags.contains(t));
                        if !has_tag {
                            matches = false;
                        }
                    }

                    // Filter by keywords
                    if let Some(keywords) = &query.keywords {
                        let has_keyword = keywords.iter().any(|k| entry.keywords.contains(k));
                        if !has_keyword {
                            matches = false;
                        }
                    }

                    if matches {
                        results.push(entry.clone());
                    }
                }
            }
        }

        // Sort by access count descending, then by updated_at descending
        results.sort_by(|a, b| {
            if a.access_count != b.access_count {
                b.access_count.cmp(&a.access_count)
            } else {
                b.updated_at.cmp(&a.updated_at)
            }
        });

        // Apply pagination
        let total = results.len();
        let paginated: Vec<MemoryEntry> = results
            .into_iter()
            .skip(query.offset)
            .take(query.limit)
            .collect();

        let query_time_ms = start_time.elapsed().as_millis() as u64;
        Ok(MemoryResponse::new(paginated, total, query_time_ms))
    }

    /// Add memory using the agentic pipeline
    /// 1. Analyze content to extract keywords/tags
    /// 2. Search for similar existing memories
    /// 3. If similar found: merge/evolve existing memory
    /// 4. If new: create new entry with metadata
    pub fn add_agentic_memory(
        &mut self,
        agent_id: &str,
        content: &str,
        context: &str,
        category: MemoryCategory,
    ) -> Result<String, String> {
        // Step 1: Extract keywords (simplified - real impl would use LLM)
        let keywords = self.extract_keywords(content);
        let tags = self.extract_tags(content);

        // Step 2: Search for similar existing memories
        let search_query = MemoryQuery {
            agent_id: Some(agent_id.to_string()),
            query: Some(content.to_string()),
            tags: None,
            keywords: None,
            limit: 5,
            offset: 0,
            min_similarity: 0.7,
        };

        let similar_results = self.search(search_query)?;

        if !similar_results.entries.is_empty() {
            // Step 3: Merge with most similar existing memory
            let most_similar = &similar_results.entries[0];
            let merged_content = format!(
                "{}\n\n[Evolution at {}]\n{}",
                most_similar.content,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                content
            );

            let mut merged_keywords = most_similar.keywords.clone();
            merged_keywords.extend(keywords.clone());
            merged_keywords.sort();
            merged_keywords.dedup();

            let mut merged_tags = most_similar.tags.clone();
            merged_tags.extend(tags.clone());
            merged_tags.sort();
            merged_tags.dedup();

            let update = MemoryUpdate::new()
                .with_content(merged_content)
                .with_keywords(merged_keywords)
                .with_tags(merged_tags)
                .with_context(context.to_string());

            self.update(agent_id, &most_similar.id, update)?;

            // Upgrade category if the existing one was Uncategorized
            if most_similar.category == MemoryCategory::Uncategorized
                && category != MemoryCategory::Uncategorized
            {
                if let Some(agent_entries) = self.entries.get_mut(agent_id) {
                    if let Some(entry) = agent_entries.get_mut(&most_similar.id) {
                        entry.category = category;
                    }
                }
            }

            Ok(most_similar.id.clone())
        } else {
            // Step 4: Create new entry
            let entry = MemoryEntry::new(
                agent_id.to_string(),
                content.chars().take(100).collect(), // key = first 100 chars
                content.to_string(),
                context.to_string(),
            )
            .with_keywords(keywords)
            .with_tags(tags)
            .with_category(category);

            self.add(entry)
        }
    }

    /// Get all memories for an agent
    pub fn get_agent_memories(&self, agent_id: &str) -> Result<Vec<MemoryEntry>, String> {
        let agent_entries = match self.entries.get(agent_id) {
            Some(e) => e,
            None => return Ok(Vec::new()),
        };

        let mut entries: Vec<MemoryEntry> = agent_entries.values().cloned().collect();

        // Sort by updated_at descending
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(entries)
    }

    /// Compact agent memories by merging redundant entries
    /// Returns number of entries merged
    pub fn compact_agent_memories(&mut self, agent_id: &str) -> Result<usize, String> {
        // Phase 1: Identify merge candidates (read-only)
        let entries_vec: Vec<MemoryEntry> = {
            let agent_entries = match self.entries.get(agent_id) {
                Some(e) => e,
                None => return Ok(0), // Nothing to compact
            };
            agent_entries.values().cloned().collect()
        };

        let mut entries_to_merge: Vec<(String, String)> = Vec::new();

        for i in 0..entries_vec.len() {
            for j in (i + 1)..entries_vec.len() {
                let a = &entries_vec[i];
                let b = &entries_vec[j];

                let common_keywords = a.keywords.iter().filter(|k| b.keywords.contains(k)).count();

                if common_keywords > 0
                    && common_keywords as f32 / a.keywords.len().max(1) as f32 > 0.5
                {
                    entries_to_merge.push((a.id.clone(), b.id.clone()));
                }
            }
        }

        // Phase 2: Build merge operations (read from cloned data)
        let mut operations: Vec<(String, String, MemoryUpdate)> = Vec::new();
        for (keep_id, merge_id) in &entries_to_merge {
            let entries_map = entries_vec
                .iter()
                .map(|e| (e.id.clone(), e.clone()))
                .collect::<std::collections::HashMap<_, _>>();
            if let (Some(keep_entry), Some(merge_entry)) =
                (entries_map.get(keep_id), entries_map.get(merge_id))
            {
                let merged_content = format!(
                    "{}\n\n[Merged {}]\n{}",
                    keep_entry.content, merge_id, merge_entry.content
                );

                let mut merged_keywords = keep_entry.keywords.clone();
                merged_keywords.extend(merge_entry.keywords.clone());
                merged_keywords.sort();
                merged_keywords.dedup();

                let mut merged_tags = keep_entry.tags.clone();
                merged_tags.extend(merge_entry.tags.clone());
                merged_tags.sort();
                merged_tags.dedup();

                operations.push((
                    keep_id.clone(),
                    merge_id.clone(),
                    MemoryUpdate::new()
                        .with_content(merged_content)
                        .with_keywords(merged_keywords)
                        .with_tags(merged_tags),
                ));
            }
        }

        // Phase 3: Apply mutations (single mutable borrow at a time)
        let mut merged_count = 0;
        for (keep_id, merge_id, update) in operations {
            let _ = self.update(agent_id, &keep_id, update);
            if let Some(agent_entries) = self.entries.get_mut(agent_id) {
                agent_entries.remove(&merge_id);
            }
            merged_count += 1;
        }

        Ok(merged_count)
    }

    /// Extract keywords from content (simplified implementation)
    fn extract_keywords(&self, content: &str) -> Vec<String> {
        let words: Vec<&str> = content
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 3) // Only words longer than 3 chars
            .collect();

        // Count word frequency (simplified)
        let mut freq: HashMap<String, usize> = HashMap::new();
        for word in words {
            let lower = word.to_lowercase();
            *freq.entry(lower).or_insert(0) += 1;
        }

        // Get top 5 keywords by frequency
        let mut keywords: Vec<(String, usize)> = freq.into_iter().map(|(k, v)| (k, v)).collect();

        keywords.sort_by(|a, b| b.1.cmp(&a.1));

        keywords.into_iter().take(5).map(|(k, _)| k).collect()
    }

    /// Extract tags from content (simplified implementation)
    fn extract_tags(&self, content: &str) -> Vec<String> {
        let mut tags = Vec::new();
        let content_lower = content.to_lowercase();

        // Look for common patterns
        if content_lower.contains("error") || content_lower.contains("failed") {
            tags.push("error".to_string());
        }
        if content_lower.contains("success") || content_lower.contains("completed") {
            tags.push("success".to_string());
        }
        if content_lower.contains("warning") {
            tags.push("warning".to_string());
        }
        if content_lower.contains("todo") || content_lower.contains("task") {
            tags.push("task".to_string());
        }
        if content_lower.contains("note") || content_lower.contains("important") {
            tags.push("note".to_string());
        }

        tags
    }

    /// Get statistics for an agent's memories
    pub fn get_agent_stats(
        &self,
        agent_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, String> {
        let agent_entries = match self.entries.get(agent_id) {
            Some(e) => e,
            None => return Ok(HashMap::new()),
        };

        let total_entries = agent_entries.len();
        let total_accesses: u64 = agent_entries.values().map(|e| e.access_count).sum();
        let avg_accesses = if total_entries > 0 {
            total_accesses as f64 / total_entries as f64
        } else {
            0.0
        };

        let oldest_entry = agent_entries
            .values()
            .map(|e| e.created_at)
            .min()
            .unwrap_or(0);

        let newest_entry = agent_entries
            .values()
            .map(|e| e.created_at)
            .max()
            .unwrap_or(0);

        let mut stats = HashMap::new();
        stats.insert(
            "total_entries".to_string(),
            serde_json::json!(total_entries),
        );
        stats.insert(
            "total_accesses".to_string(),
            serde_json::json!(total_accesses),
        );
        stats.insert(
            "avg_accesses_per_entry".to_string(),
            serde_json::json!(avg_accesses),
        );
        stats.insert(
            "oldest_entry_at".to_string(),
            serde_json::json!(oldest_entry),
        );
        stats.insert(
            "newest_entry_at".to_string(),
            serde_json::json!(newest_entry),
        );

        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_get_memory() {
        let mut manager = ExtendedMemoryManager::new();
        let entry = MemoryEntry::new(
            "agent1".to_string(),
            "test_key".to_string(),
            "test content".to_string(),
            "test context".to_string(),
        );

        let id = manager.add(entry.clone()).expect("Failed to add entry");
        let retrieved = manager.get("agent1", &id).expect("Failed to get entry");

        assert_eq!(retrieved.content, "test content");
        assert_eq!(retrieved.agent_id, "agent1");
    }

    #[test]
    fn test_update_memory() {
        let mut manager = ExtendedMemoryManager::new();
        let entry = MemoryEntry::new(
            "agent1".to_string(),
            "test_key".to_string(),
            "original content".to_string(),
            "context".to_string(),
        );

        let id = manager.add(entry).expect("Failed to add entry");

        let update = MemoryUpdate::new().with_content("updated content".to_string());
        manager
            .update("agent1", &id, update)
            .expect("Failed to update");

        let retrieved = manager.get("agent1", &id).expect("Failed to get entry");
        assert_eq!(retrieved.content, "updated content");
    }

    #[test]
    fn test_search_by_tags() {
        let mut manager = ExtendedMemoryManager::new();

        let entry1 = MemoryEntry::new(
            "agent1".to_string(),
            "key1".to_string(),
            "content1".to_string(),
            "ctx".to_string(),
        )
        .with_tags(vec!["important".to_string()]);

        let entry2 = MemoryEntry::new(
            "agent1".to_string(),
            "key2".to_string(),
            "content2".to_string(),
            "ctx".to_string(),
        )
        .with_tags(vec!["note".to_string()]);

        manager.add(entry1).expect("Failed to add entry1");
        manager.add(entry2).expect("Failed to add entry2");

        let query = MemoryQuery {
            agent_id: Some("agent1".to_string()),
            tags: Some(vec!["important".to_string()]),
            ..Default::default()
        };

        let results = manager.search(query).expect("Search failed");
        assert_eq!(results.entries.len(), 1);
        assert_eq!(results.entries[0].tags[0], "important");
    }

    #[test]
    fn test_agentic_memory_new_entry() {
        let mut manager = ExtendedMemoryManager::new();

        let id = manager
            .add_agentic_memory("agent1", "New memory with important data", "test context")
            .expect("Failed to add agentic memory");

        let entry = manager.get("agent1", &id).expect("Failed to get entry");
        assert!(!entry.keywords.is_empty());
    }
}
