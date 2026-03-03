//! Auth module: users, roles, JWT, password hashing.
//! Stores users in SQLite (auth.db).

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

/// User roles. super_admin has full access + impersonation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    SuperAdmin,
    Admin,
    Guest,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::SuperAdmin => "super_admin",
            UserRole::Admin => "admin",
            UserRole::Guest => "guest",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "super_admin" => Some(UserRole::SuperAdmin),
            "admin" => Some(UserRole::Admin),
            "guest" => Some(UserRole::Guest),
            _ => None,
        }
    }

    pub fn can_impersonate(&self) -> bool {
        matches!(self, UserRole::SuperAdmin)
    }

    pub fn can_manage_users(&self) -> bool {
        matches!(self, UserRole::SuperAdmin)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub display_name: String,
    pub created_at: i64,
}

impl User {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        let role_str: String = row.get(3)?;
        Ok(Self {
            id: row.get(0)?,
            username: row.get(1)?,
            role: UserRole::from_str(&role_str).unwrap_or(UserRole::Guest),
            display_name: row.get(4)?,
            created_at: row.get(5)?,
        })
    }
}

/// JWT claims. sub = user_id, exp = expiry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

/// Auth manager: SQLite users table + JWT generation/validation.
pub struct AuthManager {
    conn: Mutex<rusqlite::Connection>,
    jwt_secret: Vec<u8>,
    jwt_expiry_hours: i64,
}

impl AuthManager {
    pub fn new(app_dir: PathBuf) -> Result<Self, String> {
        let db_path = app_dir.join("auth.db");
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("Failed to open auth DB: {}", e))?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'guest',
                display_name TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS user_client_state (
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, kind),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            ",
        )
        .map_err(|e| format!("Failed to init auth schema: {}", e))?;

        let jwt_secret = std::env::var("SYNTHESIS_JWT_SECRET")
            .unwrap_or_else(|_| Uuid::new_v4().to_string())
            .into_bytes();

        Ok(Self {
            conn: Mutex::new(conn),
            jwt_secret,
            jwt_expiry_hours: 24 * 7, // 7 days
        })
    }

    fn hash_password(password: &str) -> Result<String, String> {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| format!("Password hash failed: {}", e))
    }

    fn verify_password(password: &str, hash: &str) -> Result<(), String> {
        let parsed = PasswordHash::new(hash).map_err(|e| format!("Invalid hash: {}", e))?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|_| "Invalid password".to_string())
    }

    /// Create a new user. Returns error if username exists.
    pub fn create_user(
        &self,
        username: &str,
        password: &str,
        role: UserRole,
        display_name: Option<&str>,
    ) -> Result<User, String> {
        let id = Uuid::new_v4().to_string();
        let hash = Self::hash_password(password)?;
        let display = display_name.unwrap_or(username).to_string();
        let created_at = Utc::now().timestamp_millis();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, display_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, username, hash, role.as_str(), display, created_at],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "Username already exists".to_string()
            } else {
                format!("Failed to create user: {}", e)
            }
        })?;

        Ok(User {
            id: id.clone(),
            username: username.to_string(),
            role,
            display_name: display,
            created_at,
        })
    }

    /// Authenticate by username/password. Returns User and JWT on success.
    pub fn login(&self, username: &str, password: &str) -> Result<(User, String), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let row = conn
            .query_row(
                "SELECT id, username, password_hash, role, display_name, created_at
                 FROM users WHERE username = ?1",
                params![username],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, i64>(5)?)),
            )
            .map_err(|_| "Invalid username or password".to_string())?;

        let (id, uname, hash, role_str, display_name, created_at) = row;
        Self::verify_password(password, &hash)?;

        let role = UserRole::from_str(&role_str).unwrap_or(UserRole::Guest);
        let user = User {
            id: id.clone(),
            username: uname,
            role,
            display_name,
            created_at,
        };

        let token = self.issue_token(&user)?;
        Ok((user, token))
    }

    pub fn issue_token(&self, user: &User) -> Result<String, String> {
        let now = Utc::now();
        let exp = now + Duration::hours(self.jwt_expiry_hours);
        let claims = Claims {
            sub: user.id.clone(),
            username: user.username.clone(),
            role: user.role.as_str().to_string(),
            exp: exp.timestamp(),
            iat: now.timestamp(),
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.jwt_secret),
        )
        .map_err(|e| format!("JWT encode failed: {}", e))
    }

    /// Validate JWT and return Claims. Returns error if invalid/expired.
    pub fn validate_token(&self, token: &str) -> Result<Claims, String> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&self.jwt_secret),
            &Validation::default(),
        )
        .map_err(|e| format!("Invalid token: {}", e))?;
        Ok(token_data.claims)
    }

    /// Get user by id.
    pub fn get_user(&self, user_id: &str) -> Result<Option<User>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, username, password_hash, role, display_name, created_at FROM users WHERE id = ?1")
            .map_err(|e| format!("prepare failed: {}", e))?;
        let rows = stmt
            .query_map(params![user_id], User::from_row)
            .map_err(|e| format!("query failed: {}", e))?;
        let user = rows.filter_map(|r| r.ok()).next();
        Ok(user)
    }

    /// List all users. super_admin only.
    pub fn list_users(&self) -> Result<Vec<User>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, username, password_hash, role, display_name, created_at FROM users ORDER BY created_at")
            .map_err(|e| format!("prepare failed: {}", e))?;
        let rows = stmt
            .query_map([], User::from_row)
            .map_err(|e| format!("query failed: {}", e))?;
        let users: Vec<User> = rows.filter_map(|r| r.ok()).collect();
        Ok(users)
    }

    /// Count users. Used for seed check.
    pub fn user_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .map_err(|e| format!("count failed: {}", e))?;
        Ok(count)
    }

    /// Seed super admin if no users exist. Password from env SYNTHESIS_SUPER_ADMIN_PASSWORD.
    pub fn seed_super_admin_if_empty(&self) -> Result<Option<User>, String> {
        let count = self.user_count()?;
        if count > 0 {
            return Ok(None);
        }
        let password = std::env::var("SYNTHESIS_SUPER_ADMIN_PASSWORD")
            .unwrap_or_else(|_| "admin".to_string());
        let user = self.create_user("admin", &password, UserRole::SuperAdmin, Some("Super Admin"))?;
        Ok(Some(user))
    }

    /// Reset all users and seed super_admin. Used for fresh start.
    pub fn reset_and_seed(&self) -> Result<User, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions", []).map_err(|e| format!("delete sessions: {}", e))?;
        conn.execute("DELETE FROM users", []).map_err(|e| format!("delete users: {}", e))?;
        drop(conn);
        let password = std::env::var("SYNTHESIS_SUPER_ADMIN_PASSWORD")
            .unwrap_or_else(|_| "admin".to_string());
        self.create_user("admin", &password, UserRole::SuperAdmin, Some("Super Admin"))
    }

    /// Clear all users and sessions. No reseed. Used to return to first-run onboarding.
    pub fn clear_all_users(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM user_client_state", []).map_err(|e| format!("delete client state: {}", e))?;
        conn.execute("DELETE FROM sessions", []).map_err(|e| format!("delete sessions: {}", e))?;
        conn.execute("DELETE FROM users", []).map_err(|e| format!("delete users: {}", e))?;
        Ok(())
    }

    /// Get client sync state for a user (settings or workspace JSON).
    pub fn get_client_state(&self, user_id: &str, kind: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT data FROM user_client_state WHERE user_id = ?1 AND kind = ?2")
            .map_err(|e| format!("prepare: {}", e))?;
        let mut rows = stmt.query(params![user_id, kind]).map_err(|e| format!("query: {}", e))?;
        if let Some(row) = rows.next().map_err(|e| format!("next: {}", e))? {
            let data: String = row.get(0).map_err(|e| format!("get: {}", e))?;
            return Ok(Some(data));
        }
        Ok(None)
    }

    /// Set client sync state for a user. kind = "settings" | "workspace".
    pub fn set_client_state(&self, user_id: &str, kind: &str, data: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO user_client_state (user_id, kind, data, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (user_id, kind) DO UPDATE SET data = ?3, updated_at = ?4",
            params![user_id, kind, data, now],
        )
        .map_err(|e| format!("set_client_state: {}", e))?;
        Ok(())
    }
}
