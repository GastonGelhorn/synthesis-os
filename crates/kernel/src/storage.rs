use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// File storage permission levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Permission {
    Read,
    Write,
    ReadWrite,
}

impl Permission {
    fn as_str(&self) -> &str {
        match self {
            Permission::Read => "read",
            Permission::Write => "write",
            Permission::ReadWrite => "readwrite",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "read" => Some(Permission::Read),
            "write" => Some(Permission::Write),
            "readwrite" => Some(Permission::ReadWrite),
            _ => None,
        }
    }
}

/// Information about a file or directory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: i64,
    pub modified: i64, // Unix timestamp in milliseconds
    pub version: i64,
}

/// Version metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: i64,
    pub created_at: i64, // Unix timestamp in milliseconds
    pub size: i64,
}

/// Dedicated file storage manager with versioning
pub struct StorageManager {
    db: Arc<Mutex<Connection>>,
    storage_dir: PathBuf,
    auto_versioning: bool,
    max_versions: u32,
}

impl StorageManager {
    /// Initialize a new StorageManager with default config (versioning ON, unlimited versions)
    pub fn new(app_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_config(app_dir, true, 0)
    }

    /// Initialize a new StorageManager with explicit config
    pub fn new_with_config(
        app_dir: PathBuf,
        auto_versioning: bool,
        max_versions: u32,
    ) -> Result<Self, String> {
        // Create storage directory
        let storage_dir = app_dir.join("storage");
        fs::create_dir_all(&storage_dir)
            .map_err(|e| format!("Failed to create storage directory: {}", e))?;

        // Create/open SQLite database
        let db_path = app_dir.join("storage.db");
        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

        // Initialize schema
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                path TEXT NOT NULL,
                is_dir INTEGER NOT NULL DEFAULT 0,
                current_version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(agent_id, path)
            );

            CREATE TABLE IF NOT EXISTS file_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                version INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (file_id) REFERENCES files(id),
                UNIQUE(file_id, version)
            );

            CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                agent_id TEXT NOT NULL,
                permission TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (file_id) REFERENCES files(id),
                UNIQUE(file_id, agent_id)
            );

            CREATE INDEX IF NOT EXISTS idx_files_agent_path ON files(agent_id, path);
            CREATE INDEX IF NOT EXISTS idx_versions_file ON file_versions(file_id);
            CREATE INDEX IF NOT EXISTS idx_perms_file ON permissions(file_id);
            ",
        )
        .map_err(|e| format!("Failed to initialize schema: {}", e))?;

        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            storage_dir,
            auto_versioning,
            max_versions,
        })
    }

    /// Mount an agent's storage namespace
    pub fn mount(&self, agent_id: &str, mount_point: &str) -> Result<(), String> {
        let agent_dir = self.storage_dir.join(agent_id).join(mount_point);
        fs::create_dir_all(&agent_dir)
            .map_err(|e| format!("Failed to create mount point: {}", e))?;
        Ok(())
    }

    /// Create a new file
    pub fn create_file(&self, agent_id: &str, path: &str, content: &str) -> Result<String, String> {
        let now = Utc::now().timestamp_millis();
        let content_hash = self.hash_content(content);
        let file_id = self.get_or_create_file_record(agent_id, path, false, now)?;

        // Store content
        self.store_content(&content_hash, content)?;

        // Record version
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;
        db.execute(
            "INSERT INTO file_versions (file_id, version, content_hash, size, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![file_id, 1, &content_hash, content.len() as i64, now],
        )
        .map_err(|e| format!("Failed to record version: {}", e))?;

        Ok(file_id.to_string())
    }

    /// Create a directory
    pub fn create_dir(&self, agent_id: &str, path: &str) -> Result<(), String> {
        let now = Utc::now().timestamp_millis();
        self.get_or_create_file_record(agent_id, path, true, now)?;

        let dir_path = self.storage_dir.join(agent_id).join(path);
        fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))?;

        Ok(())
    }

    /// Write content to a file.
    /// If auto_versioning is ON: creates a new version and prunes old ones beyond max_versions.
    /// If auto_versioning is OFF: overwrites the current version in-place.
    pub fn write(&self, agent_id: &str, path: &str, content: &str) -> Result<i64, String> {
        let now = Utc::now().timestamp_millis();
        let content_hash = self.hash_content(content);
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        // Get current file record
        let file_id: i64 = db
            .query_row(
                "SELECT id FROM files WHERE agent_id = ? AND path = ?",
                params![agent_id, path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?
            .ok_or_else(|| format!("File not found: {}", path))?;

        if !self.auto_versioning {
            // Overwrite mode: update the latest version's content in-place
            let current_version: i64 = db
                .query_row(
                    "SELECT current_version FROM files WHERE id = ?",
                    params![file_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Database query failed: {}", e))?;

            drop(db);
            self.store_content(&content_hash, content)?;
            let db = self
                .db
                .lock()
                .map_err(|e| format!("Mutex lock failed: {}", e))?;

            db.execute(
                "UPDATE file_versions SET content_hash = ?, size = ?, created_at = ?
                 WHERE file_id = ? AND version = ?",
                params![
                    &content_hash,
                    content.len() as i64,
                    now,
                    file_id,
                    current_version
                ],
            )
            .map_err(|e| format!("Failed to update version: {}", e))?;

            db.execute(
                "UPDATE files SET updated_at = ? WHERE id = ?",
                params![now, file_id],
            )
            .map_err(|e| format!("Failed to update file: {}", e))?;

            return Ok(current_version);
        }

        // Versioning mode: create a new version
        let next_version: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM file_versions WHERE file_id = ?",
                params![file_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Database query failed: {}", e))?;

        drop(db);

        // Store content
        self.store_content(&content_hash, content)?;

        // Record version
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;
        db.execute(
            "INSERT INTO file_versions (file_id, version, content_hash, size, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                file_id,
                next_version,
                &content_hash,
                content.len() as i64,
                now
            ],
        )
        .map_err(|e| format!("Failed to record version: {}", e))?;

        db.execute(
            "UPDATE files SET current_version = ?, updated_at = ? WHERE id = ?",
            params![next_version, now, file_id],
        )
        .map_err(|e| format!("Failed to update file: {}", e))?;

        // Prune old versions if max_versions is set
        if self.max_versions > 0 {
            let total_versions: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM file_versions WHERE file_id = ?",
                    params![file_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Failed to count versions: {}", e))?;

            if total_versions > self.max_versions as i64 {
                let to_delete = total_versions - self.max_versions as i64;
                db.execute(
                    "DELETE FROM file_versions WHERE file_id = ? AND version IN (
                         SELECT version FROM file_versions WHERE file_id = ?
                         ORDER BY version ASC LIMIT ?
                     )",
                    params![file_id, file_id, to_delete],
                )
                .map_err(|e| format!("Failed to prune old versions: {}", e))?;
                println!(
                    "[LSFS] Pruned {} old version(s) for file_id={}",
                    to_delete, file_id
                );
            }
        }

        Ok(next_version)
    }

    /// Update storage configuration at runtime
    pub fn update_config(&mut self, auto_versioning: bool, max_versions: u32) {
        println!(
            "[LSFS] Config updated: auto_versioning={}, max_versions={}",
            auto_versioning, max_versions
        );
        self.auto_versioning = auto_versioning;
        self.max_versions = max_versions;
    }

    /// Read the latest version of a file
    pub fn read(&self, agent_id: &str, path: &str) -> Result<String, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let content_hash: String = db
            .query_row(
                "SELECT fv.content_hash FROM file_versions fv
                 JOIN files f ON fv.file_id = f.id
                 WHERE f.agent_id = ? AND f.path = ?
                 ORDER BY fv.version DESC LIMIT 1",
                params![agent_id, path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?
            .ok_or_else(|| format!("File not found: {}", path))?;

        drop(db);

        self.read_content(&content_hash)
    }

    /// Read a specific version of a file
    pub fn read_version(&self, agent_id: &str, path: &str, version: i64) -> Result<String, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let content_hash: String = db
            .query_row(
                "SELECT fv.content_hash FROM file_versions fv
                 JOIN files f ON fv.file_id = f.id
                 WHERE f.agent_id = ? AND f.path = ? AND fv.version = ?",
                params![agent_id, path, version],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?
            .ok_or_else(|| format!("Version {} not found for file: {}", version, path))?;

        drop(db);

        self.read_content(&content_hash)
    }

    /// List directory contents
    pub fn list(&self, agent_id: &str, path: &str) -> Result<Vec<StorageEntry>, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let prefix = if path.is_empty() || path == "/" {
            "/".to_string()
        } else {
            let mut p = path.to_string();
            if !p.ends_with('/') {
                p.push('/');
            }
            p
        };

        let mut stmt = db
            .prepare(
                "SELECT 
                    CASE 
                        WHEN INSTR(SUBSTR(path, LENGTH(?) + 1), '/') > 0 
                        THEN SUBSTR(SUBSTR(path, LENGTH(?) + 1), 1, INSTR(SUBSTR(path, LENGTH(?) + 1), '/') - 1)
                        ELSE SUBSTR(path, LENGTH(?) + 1)
                    END as name,
                    CASE 
                        WHEN INSTR(SUBSTR(path, LENGTH(?) + 1), '/') > 0 THEN 1
                        ELSE is_dir
                    END as computed_is_dir,
                    MAX(current_version) as current_version,
                    MAX(updated_at) as updated_at
                 FROM files
                 WHERE agent_id = ? AND path LIKE ? || '%' AND path != ?
                 GROUP BY 1",
            )
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let entries = stmt
            .query_map(
                params![&prefix, &prefix, &prefix, &prefix, &prefix, agent_id, &prefix, &prefix],
                |row| {
                let is_dir: i32 = row.get(1)?;
                Ok(StorageEntry {
                    name: row.get(0)?,
                    is_dir: is_dir != 0,
                    size: 0, // Could be computed from content
                    modified: row.get(3)?,
                    version: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to query files: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect entries: {}", e))?;

        Ok(entries)
    }

    /// Delete a file
    pub fn delete(&self, agent_id: &str, path: &str) -> Result<(), String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        db.execute(
            "DELETE FROM files WHERE agent_id = ? AND path = ?",
            params![agent_id, path],
        )
        .map_err(|e| format!("Failed to delete file: {}", e))?;

        Ok(())
    }

    /// Rollback a file to a previous version
    pub fn rollback(&self, agent_id: &str, path: &str, version: i64) -> Result<(), String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        // Verify version exists
        let exists: bool = db
            .query_row(
                "SELECT COUNT(*) > 0 FROM file_versions fv
                 JOIN files f ON fv.file_id = f.id
                 WHERE f.agent_id = ? AND f.path = ? AND fv.version = ?",
                params![agent_id, path, version],
                |row| row.get(0),
            )
            .map_err(|e| format!("Database query failed: {}", e))?;

        if !exists {
            return Err(format!("Version {} not found", version));
        }

        let now = Utc::now().timestamp_millis();

        // Update current_version pointer
        db.execute(
            "UPDATE files SET current_version = ?, updated_at = ?
             WHERE agent_id = ? AND path = ?",
            params![version, now, agent_id, path],
        )
        .map_err(|e| format!("Failed to rollback: {}", e))?;

        Ok(())
    }

    /// Share a file with another agent
    pub fn share(
        &self,
        owner_id: &str,
        path: &str,
        target_id: &str,
        permission: Permission,
    ) -> Result<(), String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let file_id: i64 = db
            .query_row(
                "SELECT id FROM files WHERE agent_id = ? AND path = ?",
                params![owner_id, path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?
            .ok_or_else(|| format!("File not found: {}", path))?;

        let now = Utc::now().timestamp_millis();

        db.execute(
            "INSERT OR REPLACE INTO permissions (file_id, agent_id, permission, created_at)
             VALUES (?, ?, ?, ?)",
            params![file_id, target_id, permission.as_str(), now],
        )
        .map_err(|e| format!("Failed to set permission: {}", e))?;

        Ok(())
    }

    /// Get all versions of a file
    pub fn get_versions(&self, agent_id: &str, path: &str) -> Result<Vec<VersionInfo>, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let mut stmt = db
            .prepare(
                "SELECT fv.version, fv.created_at, fv.size FROM file_versions fv
                 JOIN files f ON fv.file_id = f.id
                 WHERE f.agent_id = ? AND f.path = ?
                 ORDER BY fv.version DESC",
            )
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let versions = stmt
            .query_map(params![agent_id, path], |row| {
                Ok(VersionInfo {
                    version: row.get(0)?,
                    created_at: row.get(1)?,
                    size: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to query versions: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect versions: {}", e))?;

        Ok(versions)
    }

    /// Get file permissions for an agent
    pub fn get_permissions(
        &self,
        agent_id: &str,
        file_id: i64,
    ) -> Result<Option<Permission>, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        let perm_str: Option<String> = db
            .query_row(
                "SELECT permission FROM permissions WHERE file_id = ? AND agent_id = ?",
                params![file_id, agent_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?;

        Ok(perm_str.and_then(|s| Permission::from_str(&s)))
    }

    // ---- Private helper methods ----

    fn hash_content(&self, content: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    fn store_content(&self, hash: &str, content: &str) -> Result<(), String> {
        let content_path = self.storage_dir.join("content").join(hash);
        fs::create_dir_all(content_path.parent().unwrap())
            .map_err(|e| format!("Failed to create content directory: {}", e))?;

        fs::write(&content_path, content).map_err(|e| format!("Failed to write content: {}", e))?;

        Ok(())
    }

    fn read_content(&self, hash: &str) -> Result<String, String> {
        let content_path = self.storage_dir.join("content").join(hash);
        fs::read_to_string(&content_path).map_err(|e| format!("Failed to read content: {}", e))
    }

    fn get_or_create_file_record(
        &self,
        agent_id: &str,
        path: &str,
        is_dir: bool,
        now: i64,
    ) -> Result<i64, String> {
        let db = self
            .db
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        // Try to get existing
        let existing: Option<i64> = db
            .query_row(
                "SELECT id FROM files WHERE agent_id = ? AND path = ?",
                params![agent_id, path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Database query failed: {}", e))?;

        if let Some(id) = existing {
            return Ok(id);
        }

        // Create new
        db.execute(
            "INSERT INTO files (agent_id, path, is_dir, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)",
            params![agent_id, path, if is_dir { 1 } else { 0 }, now, now],
        )
        .map_err(|e| format!("Failed to create file record: {}", e))?;

        let id = db.last_insert_rowid();
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_storage_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let storage = StorageManager::new(temp_dir.path().to_path_buf());
        assert!(storage.is_ok());
    }

    #[test]
    fn test_create_and_read_file() {
        let temp_dir = TempDir::new().unwrap();
        let storage = StorageManager::new(temp_dir.path().to_path_buf()).unwrap();

        storage
            .create_file("agent1", "/test.txt", "Hello World")
            .unwrap();
        let content = storage.read("agent1", "/test.txt").unwrap();
        assert_eq!(content, "Hello World");
    }

    #[test]
    fn test_versioning() {
        let temp_dir = TempDir::new().unwrap();
        let storage = StorageManager::new(temp_dir.path().to_path_buf()).unwrap();

        storage.create_file("agent1", "/test.txt", "v1").unwrap();
        let v2 = storage.write("agent1", "/test.txt", "v2").unwrap();
        assert_eq!(v2, 2);

        let content = storage.read("agent1", "/test.txt").unwrap();
        assert_eq!(content, "v2");

        let v1_content = storage.read_version("agent1", "/test.txt", 1).unwrap();
        assert_eq!(v1_content, "v1");
    }

    #[test]
    fn test_rollback() {
        let temp_dir = TempDir::new().unwrap();
        let storage = StorageManager::new(temp_dir.path().to_path_buf()).unwrap();

        storage.create_file("agent1", "/test.txt", "v1").unwrap();
        storage.write("agent1", "/test.txt", "v2").unwrap();

        storage.rollback("agent1", "/test.txt", 1).unwrap();

        let content = storage.read("agent1", "/test.txt").unwrap();
        assert_eq!(content, "v1");
    }

    #[test]
    fn test_permissions() {
        let temp_dir = TempDir::new().unwrap();
        let storage = StorageManager::new(temp_dir.path().to_path_buf()).unwrap();

        storage
            .create_file("agent1", "/test.txt", "content")
            .unwrap();
        storage
            .share("agent1", "/test.txt", "agent2", Permission::Read)
            .unwrap();

        // Verify share was recorded
        let versions = storage.get_versions("agent1", "/test.txt").unwrap();
        assert!(!versions.is_empty());
    }
}
