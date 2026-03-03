use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The base trait that all Agent Native Tools must implement.
pub trait Tool: Send + Sync {
    /// The unique name of the tool (e.g., 'read_file').
    fn name(&self) -> &'static str;

    /// A description of what the tool does, which will be fed to the LLM.
    fn description(&self) -> &'static str;

    /// Execute the tool given a JSON string of arguments.
    fn execute(&self, args: &str) -> Result<String, String>;

    /// Returns the JSON definition of the tool for OpenAI function calling.
    fn definition(&self) -> Value;
}

/// A rudimentary Virtual File System (VFS) Tool to prevent arbitrary agent access.
/// Only allows reading files from a specific allowed directory base.
pub struct VirtualFileSystem {
    base_dir: PathBuf,
}

impl VirtualFileSystem {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    /// Verifies that a requested path does not escape the sandbox (e.g., via `../`).
    fn is_safe_path(&self, requested_path: &Path) -> bool {
        if let Ok(canon_base) = self.base_dir.canonicalize() {
            if let Ok(canon_req) = requested_path.canonicalize() {
                return canon_req.starts_with(canon_base);
            }
        }
        false
    }
}

impl Tool for VirtualFileSystem {
    fn name(&self) -> &'static str {
        "read_file"
    }

    fn description(&self) -> &'static str {
        "Read a file from the OS sandbox virtual filesystem. Use for reading internal documents, config files, or sandboxed workspace files. Use file_read_full instead for reading files on the real macOS disk."
    }

    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON arguments: {}", e))?;

        if let Some(path_str) = payload.get("path").and_then(Value::as_str) {
            let target_path = self.base_dir.join(path_str);

            if !self.is_safe_path(&target_path) {
                return Err("Sandbox violation: Path is outside allowed directory.".to_string());
            }

            match std::fs::read_to_string(&target_path) {
                Ok(contents) => Ok(contents),
                Err(e) => Err(format!("Failed to read file: {}", e)),
            }
        } else {
            Err("Missing required argument: 'path'".to_string())
        }
    }

    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The relative path of the file to read."
                        }
                    },
                    "required": ["path"]
                }
            }
        })
    }
}

use crate::commands::macos::apps::MacOSApps;
use crate::commands::macos::system::MacOSSystem;
use crate::commands::traits::{AppBridge, SystemBridge};
use crate::KernelState;
use tauri::Manager;

// ── HTTP / Pure Tools ─────────────────────────────────────────────

/// Evaluate a math expression (e.g. "sqrt(144) + 5^2").
pub struct Calculate;

impl Calculate {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for Calculate {
    fn name(&self) -> &'static str {
        "calculate"
    }
    fn description(&self) -> &'static str {
        "Evaluate a math expression, do arithmetic, calculate numbers, percentages, square roots, trigonometry, or unit conversions. Use for any computation or formula."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let expr = payload
            .get("expression")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'expression'".to_string())?;
        let mut ns = fasteval::EmptyNamespace;
        fasteval::ez_eval(expr, &mut ns)
            .map_err(|e| format!("Calculation error: {}", e))
            .map(|v: f64| v.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": { "expression": { "type": "string", "description": "Math expression to evaluate" } },
                    "required": ["expression"]
                }
            }
        })
    }
}

/// Convert currency using exchangerate.host (free tier).
pub struct CurrencyConvert;

impl CurrencyConvert {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for CurrencyConvert {
    fn name(&self) -> &'static str {
        "currency_convert"
    }
    fn description(&self) -> &'static str {
        "Convert money between currencies using live exchange rates. Supports USD, EUR, GBP, JPY, and 30+ currencies. Use for price conversions, forex, or international pricing."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let from = payload.get("from").and_then(Value::as_str).unwrap_or("USD");
        let to = payload.get("to").and_then(Value::as_str).unwrap_or("EUR");
        let amount: f64 = payload.get("amount").and_then(Value::as_f64).unwrap_or(1.0);
        let url = format!("https://api.frankfurter.app/latest?from={}&to={}", from, to);
        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .build()
            .map_err(|e| e.to_string())?;
        let text = client
            .get(&url)
            .send()
            .map_err(|e| e.to_string())?
            .text()
            .map_err(|e| e.to_string())?;
        let json: Value =
            serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
        let rate = json
            .get("rates")
            .and_then(|r| r.get(to))
            .and_then(Value::as_f64)
            .ok_or_else(|| "Rate not found".to_string())?;
        Ok(format!("{} {} = {:.2} {}", amount, from, amount * rate, to))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string", "description": "Source currency code (e.g. USD)" },
                        "to": { "type": "string", "description": "Target currency code (e.g. EUR)" },
                        "amount": { "type": "number", "description": "Amount to convert" }
                    },
                    "required": ["from", "to"]
                }
            }
        })
    }
}

/// Look up word definition via api.dictionaryapi.dev.
pub struct DefineWord;

impl DefineWord {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for DefineWord {
    fn name(&self) -> &'static str {
        "define_word"
    }
    fn description(&self) -> &'static str {
        "Look up the dictionary definition and meaning of a word. Supports multiple languages. Use when the user asks 'what does X mean', 'define X', or wants vocabulary help."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let word = payload
            .get("word")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'word'".to_string())?;
        let lang = payload.get("lang").and_then(Value::as_str).unwrap_or("en");
        let url = format!(
            "https://api.dictionaryapi.dev/api/v2/entries/{}/{}",
            lang,
            urlencoding::encode(word)
        );
        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        let text = resp.text().map_err(|e| e.to_string())?;
        let arr: Vec<Value> =
            serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
        let first = arr
            .first()
            .ok_or_else(|| "No definition found".to_string())?;
        let empty_arr: Vec<Value> = vec![];
        let meanings = first
            .get("meanings")
            .and_then(Value::as_array)
            .unwrap_or(&empty_arr);
        let mut out = Vec::new();
        for m in meanings.iter().take(3) {
            let part = m.get("partOfSpeech").and_then(Value::as_str).unwrap_or("");
            let defs = m
                .get("definitions")
                .and_then(Value::as_array)
                .unwrap_or(&empty_arr);
            for d in defs.iter().take(2) {
                let def = d.get("definition").and_then(Value::as_str).unwrap_or("");
                out.push(format!("[{}] {}", part, def));
            }
        }
        if out.is_empty() {
            return Err("No definition found".to_string());
        }
        Ok(out.join("\n"))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "word": { "type": "string", "description": "Word to define" },
                        "lang": { "type": "string", "description": "Language code (default: en)" }
                    },
                    "required": ["word"]
                }
            }
        })
    }
}

/// Translate text via MyMemory API (free, no key).
pub struct Translate;

impl Translate {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for Translate {
    fn name(&self) -> &'static str {
        "translate"
    }
    fn description(&self) -> &'static str {
        "Translate text between languages. Supports English, Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Korean, and many more. Use for any translation request."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'text'".to_string())?;
        let to = payload
            .get("to")
            .and_then(Value::as_str)
            .unwrap_or("Spanish");
        let from = payload
            .get("from")
            .and_then(Value::as_str)
            .unwrap_or("English");
        let url = format!(
            "https://api.mymemory.translated.net/get?q={}&langpair={}|{}",
            urlencoding::encode(text),
            urlencoding::encode(from),
            urlencoding::encode(to)
        );
        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .build()
            .map_err(|e| e.to_string())?;
        let json: Value = client
            .get(&url)
            .send()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        let result = json
            .get("responseData")
            .and_then(|r| r.get("translatedText"))
            .and_then(Value::as_str)
            .ok_or_else(|| "Translation failed".to_string())?;
        Ok(result.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "Text to translate" },
                        "to": { "type": "string", "description": "Target language" },
                        "from": { "type": "string", "description": "Source language" }
                    },
                    "required": ["text"]
                }
            }
        })
    }
}

/// Get current date/time (optionally in a timezone).
pub struct CurrentTime;

impl CurrentTime {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for CurrentTime {
    fn name(&self) -> &'static str {
        "current_time"
    }
    fn description(&self) -> &'static str {
        "Get the current date, time, day of week, and timezone. Use when the user asks 'what time is it', 'what day is today', or needs the current date for scheduling."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let now = chrono::Local::now();
        Ok(now.format("%Y-%m-%d %H:%M:%S %Z").to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": { "timezone": { "type": "string", "description": "IANA timezone (e.g. Europe/Madrid)" } },
                    "required": []
                }
            }
        })
    }
}

/// Web search: DDG API -> DDG HTML -> SearXNG -> Google scrape.
pub struct WebSearch;

impl WebSearch {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for WebSearch {
    fn name(&self) -> &'static str {
        "web_search"
    }
    fn description(&self) -> &'static str {
        "Search the internet for information, news, articles, facts, or any topic. Returns web results with titles, URLs, and snippets. Use for research, fact-checking, current events, or finding websites."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'query'".to_string())?;

        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0 Agent")
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| e.to_string())?;

        // SearXNG local instance running on port 8080 (Docker container)
        // Ensure format=json is passed to get the structured response
        let searxng_url = format!(
            "http://localhost:8080/search?q={}&format=json",
            urlencoding::encode(query)
        );

        match client.get(&searxng_url).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    match resp.json::<Value>() {
                        Ok(json) => {
                            let empty_results = vec![];
                            let results_array = json
                                .get("results")
                                .and_then(Value::as_array)
                                .unwrap_or(&empty_results);

                            if results_array.is_empty() {
                                return Ok("No web results found.".to_string());
                            }

                            let formatted_results: Vec<String> = results_array
                                .iter()
                                .take(10)
                                .filter_map(|item| {
                                    let title = item
                                        .get("title")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Untitled");
                                    let url = item.get("url").and_then(Value::as_str).unwrap_or("");
                                    let content =
                                        item.get("content").and_then(Value::as_str).unwrap_or("");
                                    let engines: Vec<&str> = item
                                        .get("engines")
                                        .and_then(Value::as_array)
                                        .map(|arr| arr.iter().filter_map(|e| e.as_str()).collect())
                                        .unwrap_or_default();

                                    if url.is_empty() {
                                        None
                                    } else {
                                        // Remove HTML tags from content (sometimes SearXNG returns highlighted tags)
                                        let clean_content =
                                            content.replace("<b>", "").replace("</b>", "");
                                        let engine_str = if engines.is_empty() {
                                            String::new()
                                        } else {
                                            format!(" [{}]", engines.join(", "))
                                        };
                                        Some(format!(
                                            "[{}]({}) - {}{}",
                                            title, url, clean_content, engine_str
                                        ))
                                    }
                                })
                                .collect();

                            if !formatted_results.is_empty() {
                                return Ok(formatted_results.join("\n\n"));
                            }
                        }
                        Err(e) => {
                            return Err(format!("SearXNG returned invalid JSON: {}", e));
                        }
                    }
                } else {
                    return Err(format!("SearXNG returned HTTP {}", status));
                }
            }
            Err(e) => {
                return Err(format!("Failed to reach local SearXNG at localhost:8080. Is the Docker container running? Error: {}", e));
            }
        }

        Err("Web search failed for an unknown reason".to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": { "query": { "type": "string", "description": "Search query" } },
                    "required": ["query"]
                }
            }
        })
    }
}

/// Read page content: fetch URL and extract main text (simplified, no Readability).
pub struct ReadPage;

impl ReadPage {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for ReadPage {
    fn name(&self) -> &'static str {
        "read_page"
    }
    fn description(&self) -> &'static str {
        "Fetch and read the content of a web page given its URL. Extracts the main text from articles, blog posts, documentation, or any website. Use to read a specific link or extract information from a URL."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let url = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'url'".to_string())?;
        let client = reqwest::blocking::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .build()
            .map_err(|e| e.to_string())?;
        let html = client
            .get(url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .map_err(|e| e.to_string())?
            .text()
            .map_err(|e| e.to_string())?;
        // Basic extraction: strip tags, collapse whitespace
        let text = html
            .replace("</p>", "\n")
            .replace("<br>", "\n")
            .replace("<br/>", "\n");
        let text = regex::Regex::new(r"<[^>]+>")
            .unwrap()
            .replace_all(&text, "")
            .to_string();
        let text = regex::Regex::new(r"\n{3,}")
            .unwrap()
            .replace_all(&text, "\n\n")
            .to_string();
        let text = text.trim();
        let limit = 5000;
        Ok(if text.len() > limit {
            format!("{}... [TRUNCATED]", &text[..limit])
        } else {
            text.to_string()
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": { "url": { "type": "string", "description": "URL to fetch" } },
                    "required": ["url"]
                }
            }
        })
    }
}

// ── macOS Tools (wrap MacOSSystem / MacOSApps) ──────────────────────

fn run_macos_async<F, R>(f: F) -> R
where
    F: std::future::Future<Output = R>,
{
    tauri::async_runtime::block_on(f)
}

/// Clipboard read
pub struct ClipboardRead;
impl Tool for ClipboardRead {
    fn name(&self) -> &'static str {
        "clipboard_read"
    }
    fn description(&self) -> &'static str {
        "Read the current macOS clipboard contents. Use when the user says 'what did I copy', 'paste', 'show clipboard', or needs to access copied text."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.clipboard_read()).map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Clipboard write
pub struct ClipboardWrite;
impl Tool for ClipboardWrite {
    fn name(&self) -> &'static str {
        "clipboard_write"
    }
    fn description(&self) -> &'static str {
        "Copy text to the macOS clipboard. Use when the user says 'copy this', 'put in clipboard', or wants to save text for pasting elsewhere."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .ok_or("Missing 'text'")?;
        let sys = MacOSSystem;
        run_macos_async(sys.clipboard_write(text))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}})
    }
}

/// Notify
pub struct Notify;
impl Tool for Notify {
    fn name(&self) -> &'static str {
        "notify"
    }
    fn description(&self) -> &'static str {
        "Send a native macOS desktop notification with a title and message. Use to alert the user, confirm an action, or deliver status updates."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("SynthesisOS");
        let body = payload.get("body").and_then(Value::as_str).unwrap_or("");
        let sys = MacOSSystem;
        run_macos_async(sys.notify(title, body))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"}},"required":[]}}})
    }
}

/// Get volume
pub struct GetVolume;
impl Tool for GetVolume {
    fn name(&self) -> &'static str {
        "get_volume"
    }
    fn description(&self) -> &'static str {
        "Get the current macOS speaker volume level as a percentage. Use when the user asks 'what is the volume' or before adjusting volume."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.get_volume())
            .map(|v| format!("Volume: {}%", v as u32))
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

pub struct SetVolume;
impl Tool for SetVolume {
    fn name(&self) -> &'static str {
        "set_volume"
    }
    fn description(&self) -> &'static str {
        "Set the macOS speaker volume to a specific level. Use when the user says 'turn up the volume', 'set volume to 50%', 'mute', 'louder', or 'quieter'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let level: f32 = payload
            .get("level")
            .and_then(Value::as_f64)
            .map(|v| v as f32)
            .unwrap_or(0.5);
        let level = if level <= 1.0 { level * 100.0 } else { level };
        let sys = MacOSSystem;
        run_macos_async(sys.set_volume(level))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"level":{"type":"number"}},"required":["level"]}}})
    }
}

/// Get brightness
pub struct GetBrightness;
impl Tool for GetBrightness {
    fn name(&self) -> &'static str {
        "get_brightness"
    }
    fn description(&self) -> &'static str {
        "Get the current macOS display screen brightness level. Use when the user asks 'how bright is my screen' or before adjusting brightness."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.get_brightness())
            .map(|v| format!("Brightness: {:.0}%", v * 100.0))
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

pub struct SetBrightness;
impl Tool for SetBrightness {
    fn name(&self) -> &'static str {
        "set_brightness"
    }
    fn description(&self) -> &'static str {
        "Set the macOS display screen brightness to a specific level. Use when the user says 'make the screen brighter', 'dim the screen', 'set brightness to 80%'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let mut level: f32 = payload
            .get("level")
            .and_then(Value::as_f64)
            .map(|v| v as f32)
            .unwrap_or(0.5);
        // Normalize 0-100 (percentage) to 0-1 for the brightness CLI
        if level > 1.0 {
            level = level / 100.0;
        }
        let sys = MacOSSystem;
        run_macos_async(sys.set_brightness(level))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"level":{"type":"number"}},"required":["level"]}}})
    }
}

/// Toggle dark mode
pub struct ToggleDarkMode;
impl Tool for ToggleDarkMode {
    fn name(&self) -> &'static str {
        "toggle_dark_mode"
    }
    fn description(&self) -> &'static str {
        "Toggle macOS dark mode on or off. Switches between light and dark appearance theme. Use when the user says 'enable dark mode', 'switch to light mode', or 'change theme'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.toggle_dark_mode())
            .map(|v| format!("Dark mode: {}", if v { "on" } else { "off" }))
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Get battery
pub struct GetBattery;
impl Tool for GetBattery {
    fn name(&self) -> &'static str {
        "get_battery"
    }
    fn description(&self) -> &'static str {
        "Get MacBook battery level, charging status, and power source. Use when the user asks 'how much battery', 'am I charging', or 'battery status'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.get_battery())
            .map(|b| {
                format!(
                    "Battery: {:.0}% ({})",
                    b.percentage,
                    if b.charging { "charging" } else { &b.source }
                )
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Get WiFi
pub struct GetWifi;
impl Tool for GetWifi {
    fn name(&self) -> &'static str {
        "get_wifi"
    }
    fn description(&self) -> &'static str {
        "Get WiFi network connection status, SSID name, signal strength, and IP address. Use when the user asks 'am I connected to WiFi', 'what network am I on', or 'show WiFi info'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.get_wifi())
            .map(|w| {
                if w.connected {
                    format!("WiFi: {}", w.ssid)
                } else {
                    "WiFi: not connected".to_string()
                }
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Get system info
pub struct GetSystemInfo;
impl Tool for GetSystemInfo {
    fn name(&self) -> &'static str {
        "get_system_info"
    }
    fn description(&self) -> &'static str {
        "Get macOS system information: OS version, hostname, CPU model, RAM, and disk space. Use when the user asks about their computer specs, free storage, system status, or hardware details."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.get_system_info())
            .map(|s| {
                let base = format!(
                    "{} {} | {} | {} GB RAM | {}",
                    s.os_name, s.os_version, s.hostname, s.memory_gb, s.cpu
                );
                match (s.disk_total_gb, s.disk_free_gb) {
                    (Some(total), Some(free)) => {
                        format!("{} | Disk: {:.1} GB free of {:.1} GB", base, free, total)
                    }
                    _ => base,
                }
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Open app
pub struct OpenApp;
impl Tool for OpenApp {
    fn name(&self) -> &'static str {
        "open_app"
    }
    fn description(&self) -> &'static str {
        "Open or launch a macOS application by name. Also opens URLs in the default browser or files with their default app. Use when the user says 'open Safari', 'launch Slack', or 'open this URL'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let name = payload
            .get("name")
            .and_then(Value::as_str)
            .ok_or("Missing 'name'")?;
        let sys = MacOSSystem;
        run_macos_async(sys.open_app(name))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}})
    }
}

/// Say TTS
pub struct SayTts;
impl Tool for SayTts {
    fn name(&self) -> &'static str {
        "say_tts"
    }
    fn description(&self) -> &'static str {
        "Speak text aloud using macOS text-to-speech. Supports different voices and speech rates. Use when the user says 'read this aloud', 'say something', or wants audio output of text."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .ok_or("Missing 'text'")?;
        let voice = payload.get("voice").and_then(Value::as_str);
        let rate = payload
            .get("rate")
            .and_then(Value::as_u64)
            .map(|r| r as u32);
        let sys = MacOSSystem;
        run_macos_async(sys.say_tts(text, voice, rate))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"text":{"type":"string"},"voice":{"type":"string"},"rate":{"type":"number"}},"required":["text"]}}})
    }
}

/// Take screenshot
pub struct TakeScreenshot;
impl Tool for TakeScreenshot {
    fn name(&self) -> &'static str {
        "take_screenshot"
    }
    fn description(&self) -> &'static str {
        "Capture a screenshot of the macOS desktop or a specific window. Use when the user says 'take a screenshot', 'capture my screen', or 'show me what's on screen'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let sys = MacOSSystem;
        run_macos_async(sys.take_screenshot()).map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Search files (Spotlight)
pub struct SearchFiles;
impl Tool for SearchFiles {
    fn name(&self) -> &'static str {
        "search_files"
    }
    fn description(&self) -> &'static str {
        "Search for files, folders, and documents on macOS using Spotlight (mdfind). Use when the user says 'find a file', 'where is my document', 'search for PDF', or needs to locate files on disk."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or("Missing 'query'")?;
        let sys = MacOSSystem;
        run_macos_async(sys.search_files(query))
            .map(|v| v.join("\n"))
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}})
    }
}

/// Notes list
pub struct NotesList;
impl Tool for NotesList {
    fn name(&self) -> &'static str {
        "notes_list"
    }
    fn description(&self) -> &'static str {
        "List notes from Apple Notes app, optionally filtered by search query. Use when the user says 'show my notes', 'list notes', or 'find a note about X'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value = serde_json::from_str(args).unwrap_or(Value::Null);
        let query = payload.get("query").and_then(Value::as_str);
        let apps = MacOSApps;
        run_macos_async(apps.notes_list(query))
            .map(|v| {
                v.iter()
                    .map(|n| format!("{} ({})", n.title, n.date))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":[]}}})
    }
}

/// Notes read
pub struct NotesRead;
impl Tool for NotesRead {
    fn name(&self) -> &'static str {
        "notes_read"
    }
    fn description(&self) -> &'static str {
        "Read the full content of a specific note from Apple Notes by title. Use when the user wants to see what a particular note says."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .ok_or("Missing 'title'")?;
        let apps = MacOSApps;
        run_macos_async(apps.notes_read(title)).map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}}})
    }
}

/// Remember a fact in OS long-term memory (name, preferences, etc.). Implemented via MemoryEvolve in scheduler; not executed as a normal tool.
pub struct Remember;
impl Tool for Remember {
    fn name(&self) -> &'static str {
        "remember"
    }
    fn description(&self) -> &'static str {
        "Save a fact to long-term memory for future recall. Use when the user shares personal info (name, birthday, pet, preference, address), says 'remember that...', or provides any information they'd want recalled later. Examples: 'my name is Gastón', 'I prefer dark mode', 'remember I'm allergic to peanuts'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        Err(
            "remember is handled by the kernel memory pipeline; this path should not be called."
                .to_string(),
        )
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": { "type": "string", "description": "The fact to remember (e.g. User's name is X)" },
                        "context": { "type": "string", "description": "Optional context tag (e.g. user_profile, preference)" }
                    },
                    "required": ["content"]
                }
            }
        })
    }
}

/// Explicitly update Core Memory blocks (Conscious Memory).
/// Use this to edit your own Persona or information about the User.
pub struct CoreMemoryTool;
impl Tool for CoreMemoryTool {
    fn name(&self) -> &'static str {
        "core_memory_append"
    }
    fn description(&self) -> &'static str {
        "Add new information to your always-visible Core Memory. Use 'user_profile' block to store facts about the user (name, preferences, family, work). Use 'persona' block to evolve your own personality and behavioral notes. Core memory persists across all conversations."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        Err("core_memory_append is handled by the kernel memory pipeline; this path should not be called.".to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "block": {
                            "type": "string",
                            "enum": ["persona", "user_profile"],
                            "description": "The block to update"
                        },
                        "content": {
                            "type": "string",
                            "description": "New information to append/integrate into the block"
                        }
                    },
                    "required": ["block", "content"]
                }
            }
        })
    }
}

/// Replace specific text in a Core Memory block (self-editing).
/// Allows the agent to update outdated facts instead of just appending new ones.
pub struct CoreMemoryReplace;
impl Tool for CoreMemoryReplace {
    fn name(&self) -> &'static str {
        "core_memory_replace"
    }
    fn description(&self) -> &'static str {
        "Update or correct existing information in Core Memory by replacing old text with new text. Use when facts change: user moved cities, changed job, got married, updated preferences, or any previously stored info is now outdated. Finds and replaces exact text within the specified block."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        Err("core_memory_replace is handled by the kernel memory pipeline; this path should not be called.".to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "block": {
                            "type": "string",
                            "enum": ["persona", "user_profile"],
                            "description": "The core memory block to edit"
                        },
                        "old_content": {
                            "type": "string",
                            "description": "Exact text to find and replace in the block"
                        },
                        "new_content": {
                            "type": "string",
                            "description": "New text to replace the old content with. Use empty string to delete."
                        }
                    },
                    "required": ["block", "old_content", "new_content"]
                }
            }
        })
    }
}

/// Notes create
pub struct NotesCreate;
impl Tool for NotesCreate {
    fn name(&self) -> &'static str {
        "notes_create"
    }
    fn description(&self) -> &'static str {
        "Create a new note in Apple Notes with a title and body text. Use when the user says 'create a note', 'write a note', 'save this as a note', or 'jot down'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .ok_or("Missing 'title'")?;
        let body = payload.get("body").and_then(Value::as_str).unwrap_or("");
        let apps = MacOSApps;
        run_macos_async(apps.notes_create(title, body))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"}},"required":["title"]}}})
    }
}

/// Email list
pub struct EmailList;
impl Tool for EmailList {
    fn name(&self) -> &'static str {
        "email_list"
    }
    fn description(&self) -> &'static str {
        "List emails from Apple Mail inbox or other mailboxes. Shows subject, sender, and date. Filter by unread only. Use when the user says 'check my email', 'show inbox', 'read my mail', or 'any new messages'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value = serde_json::from_str(args).unwrap_or(Value::Null);
        let mailbox = payload
            .get("mailbox")
            .and_then(Value::as_str)
            .unwrap_or("INBOX");
        let max = payload.get("max").and_then(Value::as_u64).unwrap_or(10) as u32;
        let unread_only = payload
            .get("unread_only")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let apps = MacOSApps;
        run_macos_async(apps.email_list(mailbox, max, unread_only))
            .map(|v| {
                v.iter()
                    .map(|e| format!("{} | {} | {}", e.subject, e.from, e.date))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"mailbox":{"type":"string"},"max":{"type":"number"},"unread_only":{"type":"boolean"}},"required":[]}}})
    }
}

/// Calendar today
pub struct CalendarToday;
impl Tool for CalendarToday {
    fn name(&self) -> &'static str {
        "calendar_today"
    }
    fn description(&self) -> &'static str {
        "Get today's calendar events and schedule from Apple Calendar. Shows event titles, times, and locations. Use when the user asks 'what's on my calendar', 'my schedule today', 'do I have meetings', or 'what's planned today'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let apps = MacOSApps;
        run_macos_async(apps.calendar_today())
            .map(|v| {
                v.iter()
                    .map(|e| format!("{} | {} - {}", e.title, e.start_date, e.end_date))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Calendar create
pub struct CalendarCreate;
impl Tool for CalendarCreate {
    fn name(&self) -> &'static str {
        "calendar_create"
    }
    fn description(&self) -> &'static str {
        "Create a new event in Apple Calendar with title, start time, end time, and optional notes. Use when the user says 'schedule a meeting', 'add to calendar', 'book time for', or 'create an event'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .ok_or("Missing 'title'")?;
        let start = payload
            .get("start")
            .and_then(Value::as_str)
            .ok_or("Missing 'start'")?;
        let end = payload
            .get("end")
            .and_then(Value::as_str)
            .ok_or("Missing 'end'")?;
        let notes = payload.get("notes").and_then(Value::as_str);
        let apps = MacOSApps;
        run_macos_async(apps.calendar_create(title, start, end, notes))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"title":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"},"notes":{"type":"string"}},"required":["title","start","end"]}}})
    }
}

/// Reminders list
pub struct RemindersList;
impl Tool for RemindersList {
    fn name(&self) -> &'static str {
        "reminders_list"
    }
    fn description(&self) -> &'static str {
        "List pending reminders from Apple Reminders app with titles and due dates. Use when the user says 'show my reminders', 'what do I need to do', or 'my to-do list'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let apps = MacOSApps;
        run_macos_async(apps.reminders_list())
            .map(|v| {
                v.iter()
                    .map(|r| format!("{} (due: {})", r.name, r.due_date))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Reminders add
pub struct RemindersAdd;
impl Tool for RemindersAdd {
    fn name(&self) -> &'static str {
        "reminders_add"
    }
    fn description(&self) -> &'static str {
        "Add a new reminder to Apple Reminders with an optional due date. Use when the user says 'remind me to', 'add a reminder', 'add to my to-do list', or 'don't let me forget'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .ok_or("Missing 'title'")?;
        let due = payload.get("due").and_then(Value::as_str);
        let apps = MacOSApps;
        run_macos_async(apps.reminders_add(title, due))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"title":{"type":"string"},"due":{"type":"string"}},"required":["title"]}}})
    }
}

/// Contacts search
pub struct ContactsSearch;
impl Tool for ContactsSearch {
    fn name(&self) -> &'static str {
        "contacts_search"
    }
    fn description(&self) -> &'static str {
        "Search Apple Contacts for people by name, email, or phone number. Returns contact details. Use when the user says 'find contact', 'what's John's number', 'look up email for', or 'search address book'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or("Missing 'query'")?;
        let apps = MacOSApps;
        run_macos_async(apps.contacts_search(query))
            .map(|v| {
                v.iter()
                    .map(|c| format!("{} | {} | {}", c.name, c.email, c.phone))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}})
    }
}

/// Music play
pub struct MusicPlay;
impl Tool for MusicPlay {
    fn name(&self) -> &'static str {
        "music_play"
    }
    fn description(&self) -> &'static str {
        "Play music in Apple Music app. Search and play a song, artist, album, or playlist, or resume the current track. Use when the user says 'play music', 'play some jazz', 'put on a song', or 'resume music'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value = serde_json::from_str(args).unwrap_or(Value::Null);
        let query = payload.get("query").and_then(Value::as_str);
        let apps = MacOSApps;
        run_macos_async(apps.music_play(query)).map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":[]}}})
    }
}

/// Music pause
pub struct MusicPause;
impl Tool for MusicPause {
    fn name(&self) -> &'static str {
        "music_pause"
    }
    fn description(&self) -> &'static str {
        "Pause the currently playing track in Apple Music. Use when the user says 'pause music', 'stop the music', or 'pause the song'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let apps = MacOSApps;
        run_macos_async(apps.music_pause())
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Music next
pub struct MusicNext;
impl Tool for MusicNext {
    fn name(&self) -> &'static str {
        "music_next"
    }
    fn description(&self) -> &'static str {
        "Skip to the next track in Apple Music. Use when the user says 'next song', 'skip this', 'next track', or 'play the next one'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let apps = MacOSApps;
        run_macos_async(apps.music_next())
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

/// Finder open
pub struct FinderOpen;
impl Tool for FinderOpen {
    fn name(&self) -> &'static str {
        "finder_open"
    }
    fn description(&self) -> &'static str {
        "Open a folder or file location in macOS Finder. Use when the user says 'open this folder', 'show in Finder', 'open Downloads', or 'go to directory'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;
        let apps = MacOSApps;
        run_macos_async(apps.finder_open(path))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}})
    }
}

/// Finder trash
pub struct FinderTrash;
impl Tool for FinderTrash {
    fn name(&self) -> &'static str {
        "finder_trash"
    }
    fn description(&self) -> &'static str {
        "Move a file or folder to the macOS Trash. Use when the user says 'delete this file', 'trash it', 'remove this document', or 'move to trash'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;
        let apps = MacOSApps;
        run_macos_async(apps.finder_trash(path))
            .map(|_| "OK".to_string())
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}})
    }
}

/// Safari tabs
pub struct SafariTabs;
impl Tool for SafariTabs {
    fn name(&self) -> &'static str {
        "safari_tabs"
    }
    fn description(&self) -> &'static str {
        "List all open Safari browser tabs with their titles and URLs. Use when the user says 'show my tabs', 'what tabs are open', 'list Safari tabs', or 'what am I browsing'."
    }
    fn execute(&self, _args: &str) -> Result<String, String> {
        let apps = MacOSApps;
        run_macos_async(apps.safari_tabs())
            .map(|v| v.join("\n"))
            .map_err(|e| e.to_string())
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{},"required":[]}}})
    }
}

// ══════════════════════════════════════════════════════════════
// ADDITIONAL TOOLS — ported from TypeScript agent tools
// ══════════════════════════════════════════════════════════════

// ── HTTP Request ──────────────────────────────────────────────

/// Generic HTTP request tool (GET/POST/PUT/DELETE). SSRF-protected.
pub struct HttpRequest;

impl HttpRequest {
    pub fn new() -> Self {
        Self
    }

    fn is_private_ip(host: &str) -> bool {
        // Block private IPs, localhost, etc.
        let blocked = [
            "127.",
            "10.",
            "192.168.",
            "172.16.",
            "172.17.",
            "172.18.",
            "172.19.",
            "172.20.",
            "172.21.",
            "172.22.",
            "172.23.",
            "172.24.",
            "172.25.",
            "172.26.",
            "172.27.",
            "172.28.",
            "172.29.",
            "172.30.",
            "172.31.",
            "0.",
            "169.254.",
            "localhost",
            "[::1]",
            "[::]",
        ];
        blocked.iter().any(|b| host.starts_with(b) || host == *b)
    }
}

impl Tool for HttpRequest {
    fn name(&self) -> &'static str {
        "http_request"
    }
    fn description(&self) -> &'static str {
        "Make HTTP API requests (GET, POST, PUT, DELETE) to any public endpoint. Use for calling REST APIs, fetching JSON data, webhooks, or integrating with external services."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let url_str = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Missing 'url'")?;
        let method = payload
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("GET")
            .to_uppercase();

        // SSRF protection
        if let Ok(parsed) = url::Url::parse(url_str) {
            if let Some(host) = parsed.host_str() {
                if Self::is_private_ip(host) {
                    return Err("SSRF protection: private/local addresses blocked".to_string());
                }
            }
        }

        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;

        let mut req = match method.as_str() {
            "POST" => client.post(url_str),
            "PUT" => client.put(url_str),
            "DELETE" => client.delete(url_str),
            "PATCH" => client.patch(url_str),
            _ => client.get(url_str),
        };

        // Add custom headers
        if let Some(headers) = payload.get("headers").and_then(Value::as_object) {
            for (k, v) in headers {
                if let Some(val) = v.as_str() {
                    if let (Ok(name), Ok(value)) = (
                        reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                        reqwest::header::HeaderValue::from_str(val),
                    ) {
                        req = req.header(name, value);
                    }
                }
            }
        }

        // Add body
        if let Some(body) = payload.get("body").and_then(Value::as_str) {
            if !body.is_empty() {
                req = req.body(body.to_string());
            }
        }

        let resp = req.send().map_err(|e| format!("Request failed: {}", e))?;
        let status = resp.status().as_u16();
        let text = resp.text().map_err(|e| e.to_string())?;
        let limit = 8000;
        let body = if text.len() > limit {
            format!("{}...[TRUNCATED]", &text[..limit])
        } else {
            text
        };
        Ok(format!("HTTP {} — {}", status, body))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "Full URL" },
                        "method": { "type": "string", "description": "HTTP method (GET, POST, PUT, DELETE, PATCH)" },
                        "headers": { "type": "object", "description": "Optional headers as key-value pairs" },
                        "body": { "type": "string", "description": "Request body (for POST/PUT)" }
                    },
                    "required": ["url"]
                }
            }
        })
    }
}

// ── Summarize URL ─────────────────────────────────────────────

/// Fetch a URL and produce a concise summary of its content.
pub struct SummarizeUrl;

impl SummarizeUrl {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for SummarizeUrl {
    fn name(&self) -> &'static str {
        "summarize_url"
    }
    fn description(&self) -> &'static str {
        "Fetch a web page and return a summarized version of its content including title, description, and main text. Use when the user wants a quick summary of a URL, article, or web page without reading the whole thing."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let url = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Missing 'url'")?;
        let client = reqwest::blocking::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| e.to_string())?;
        let html = client
            .get(url)
            .send()
            .map_err(|e| e.to_string())?
            .text()
            .map_err(|e| e.to_string())?;

        // Extract title
        let title = regex::Regex::new(r"<title[^>]*>([^<]+)</title>")
            .ok()
            .and_then(|re| re.captures(&html))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();

        // Extract meta description
        let desc =
            regex::Regex::new(r#"<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']"#)
                .ok()
                .and_then(|re| re.captures(&html))
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();

        // Strip tags, get text
        let text = html
            .replace("</p>", "\n")
            .replace("<br>", "\n")
            .replace("<br/>", "\n");
        let text = regex::Regex::new(r"<script[^>]*>[\s\S]*?</script>")
            .unwrap()
            .replace_all(&text, "");
        let text = regex::Regex::new(r"<style[^>]*>[\s\S]*?</style>")
            .unwrap()
            .replace_all(&text, "");
        let text = regex::Regex::new(r"<[^>]+>")
            .unwrap()
            .replace_all(&text, "");
        let text = regex::Regex::new(r"\n{3,}")
            .unwrap()
            .replace_all(&text, "\n\n");
        let text = regex::Regex::new(r" {2,}").unwrap().replace_all(&text, " ");
        let text = text.trim();

        // Take first ~3000 chars for summary
        let excerpt = if text.len() > 3000 {
            &text[..3000]
        } else {
            text
        };
        let mut result = String::new();
        if !title.is_empty() {
            result.push_str(&format!("Title: {}\n", title));
        }
        if !desc.is_empty() {
            result.push_str(&format!("Description: {}\n", desc));
        }
        result.push_str(&format!("URL: {}\n\nContent:\n{}", url, excerpt));
        Ok(result)
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": { "url": { "type": "string", "description": "URL to summarize" } },
                    "required": ["url"]
                }
            }
        })
    }
}

// ── YouTube Search ────────────────────────────────────────────

/// Search YouTube videos via Invidious API (no API key needed).
pub struct YoutubeSearch;

impl YoutubeSearch {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for YoutubeSearch {
    fn name(&self) -> &'static str {
        "youtube_search"
    }
    fn description(&self) -> &'static str {
        "Search YouTube for videos by topic, title, or keyword. Returns video titles, URLs, view counts, and duration. Use when the user says 'find videos about', 'search YouTube for', 'show me tutorials', or wants video content."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or("Missing 'query'")?;
        let count = payload.get("count").and_then(Value::as_u64).unwrap_or(5) as usize;
        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;

        // Try multiple Invidious instances
        for instance in &[
            "https://vid.puffyan.us",
            "https://invidious.snopyta.org",
            "https://yewtu.be",
        ] {
            let url = format!(
                "{}/api/v1/search?q={}&type=video",
                instance,
                urlencoding::encode(query)
            );
            if let Ok(resp) = client.get(&url).send() {
                if let Ok(arr) = resp.json::<Vec<Value>>() {
                    let results: Vec<String> = arr.iter().take(count).filter_map(|v| {
                        let title = v.get("title")?.as_str()?;
                        let vid_id = v.get("videoId")?.as_str()?;
                        let author = v.get("author").and_then(Value::as_str).unwrap_or("Unknown");
                        let views = v.get("viewCount").and_then(Value::as_u64).unwrap_or(0);
                        let length = v.get("lengthSeconds").and_then(Value::as_u64).unwrap_or(0);
                        let mins = length / 60;
                        let secs = length % 60;
                        Some(format!("- {} ({}:{:02})\n  By: {} | Views: {}\n  https://youtube.com/watch?v={}",
                            title, mins, secs, author, views, vid_id))
                    }).collect();
                    if !results.is_empty() {
                        return Ok(format!(
                            "YouTube results for \"{}\":\n\n{}",
                            query,
                            results.join("\n\n")
                        ));
                    }
                }
            }
        }

        // Fallback: SearXNG with videos category
        for instance in &["https://search.sapti.me", "https://searx.be"] {
            let url = format!(
                "{}/search?q={}&format=json&categories=videos",
                instance,
                urlencoding::encode(query)
            );
            if let Ok(resp) = client
                .get(&url)
                .timeout(std::time::Duration::from_secs(6))
                .send()
            {
                if let Ok(json) = resp.json::<Value>() {
                    if let Some(arr) = json.get("results").and_then(Value::as_array) {
                        let results: Vec<String> = arr
                            .iter()
                            .take(count)
                            .filter_map(|r| {
                                let title = r.get("title")?.as_str()?;
                                let url = r.get("url")?.as_str()?;
                                Some(format!("- {}\n  {}", title, url))
                            })
                            .collect();
                        if !results.is_empty() {
                            return Ok(format!(
                                "Video results for \"{}\":\n\n{}",
                                query,
                                results.join("\n\n")
                            ));
                        }
                    }
                }
            }
        }

        Err(format!("YouTube search failed for '{}'", query))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "YouTube search query" },
                        "count": { "type": "integer", "description": "Number of results (default 5, max 10)" }
                    },
                    "required": ["query"]
                }
            }
        })
    }
}

// ── RSS Reader ────────────────────────────────────────────────

/// Parse RSS/Atom feeds and return latest entries.
pub struct RssReader;

impl RssReader {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for RssReader {
    fn name(&self) -> &'static str {
        "rss_reader"
    }
    fn description(&self) -> &'static str {
        "Read and parse an RSS or Atom feed to get the latest articles, blog posts, or news entries. Returns titles, links, and summaries. Use for following blogs, news feeds, or podcasts."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let url = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Missing 'url'")?;
        let count = payload.get("count").and_then(Value::as_u64).unwrap_or(10) as usize;
        let client = reqwest::blocking::Client::builder()
            .user_agent("SynthesisOS/1.0")
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        let xml = client
            .get(url)
            .send()
            .map_err(|e| e.to_string())?
            .text()
            .map_err(|e| e.to_string())?;

        let mut entries = Vec::new();

        // Try RSS 2.0 format: <item><title>...<link>...<description>...
        let item_re = regex::Regex::new(r"(?s)<item>(.*?)</item>").unwrap();
        let title_re =
            regex::Regex::new(r"(?s)<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>").unwrap();
        let link_re =
            regex::Regex::new(r"(?s)<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>").unwrap();
        let desc_re =
            regex::Regex::new(r"(?s)<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>")
                .unwrap();

        for cap in item_re.captures_iter(&xml).take(count) {
            let item_xml = &cap[1];
            let title = title_re
                .captures(item_xml)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim())
                .unwrap_or("Untitled");
            let link = link_re
                .captures(item_xml)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim())
                .unwrap_or("");
            let desc = desc_re
                .captures(item_xml)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim())
                .unwrap_or("");
            // Strip HTML from description
            let clean_desc = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(desc, "");
            let short_desc = if clean_desc.len() > 150 {
                format!("{}...", &clean_desc[..150])
            } else {
                clean_desc.to_string()
            };
            entries.push(format!("- {}\n  {}\n  {}", title, link, short_desc));
        }

        // Try Atom format if RSS found nothing: <entry><title>...<link href="...">
        if entries.is_empty() {
            let entry_re = regex::Regex::new(r"(?s)<entry>(.*?)</entry>").unwrap();
            let atom_link_re = regex::Regex::new(r#"<link[^>]+href=["']([^"']+)["']"#).unwrap();
            let summary_re =
                regex::Regex::new(r"(?s)<summary[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</summary>")
                    .unwrap();

            for cap in entry_re.captures_iter(&xml).take(count) {
                let entry_xml = &cap[1];
                let title = title_re
                    .captures(entry_xml)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().trim())
                    .unwrap_or("Untitled");
                let link = atom_link_re
                    .captures(entry_xml)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().trim())
                    .unwrap_or("");
                let summary = summary_re
                    .captures(entry_xml)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().trim())
                    .unwrap_or("");
                let clean_summary = regex::Regex::new(r"<[^>]+>")
                    .unwrap()
                    .replace_all(summary, "");
                let short = if clean_summary.len() > 150 {
                    format!("{}...", &clean_summary[..150])
                } else {
                    clean_summary.to_string()
                };
                entries.push(format!("- {}\n  {}\n  {}", title, link, short));
            }
        }

        if entries.is_empty() {
            Err("Could not parse RSS/Atom feed. Check URL.".to_string())
        } else {
            Ok(format!(
                "Feed ({} entries):\n\n{}",
                entries.len(),
                entries.join("\n\n")
            ))
        }
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "RSS or Atom feed URL" },
                        "count": { "type": "integer", "description": "Max entries to return (default 10)" }
                    },
                    "required": ["url"]
                }
            }
        })
    }
}

// ── QR Code ───────────────────────────────────────────────────

/// Generate a QR code as an SVG string or URL via goqr.me API.
pub struct QrCode;

impl QrCode {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for QrCode {
    fn name(&self) -> &'static str {
        "qr_code"
    }
    fn description(&self) -> &'static str {
        "Generate a QR code image from text, a URL, or any data. Returns a downloadable QR code image URL. Use when the user says 'make a QR code', 'generate QR for this link', or needs a scannable code."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let data = payload
            .get("data")
            .and_then(Value::as_str)
            .ok_or("Missing 'data'")?;
        let size = payload.get("size").and_then(Value::as_u64).unwrap_or(300);
        let qr_url = format!(
            "https://api.qrserver.com/v1/create-qr-code/?size={}x{}&data={}",
            size,
            size,
            urlencoding::encode(data)
        );
        Ok(format!(
            "QR Code generated:\nData: {}\nImage URL: {}",
            data, qr_url
        ))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": { "type": "string", "description": "Text or URL to encode" },
                        "size": { "type": "integer", "description": "Image size in pixels (default 300)" }
                    },
                    "required": ["data"]
                }
            }
        })
    }
}

// ── Set Timer ─────────────────────────────────────────────────

/// Set a timer/reminder. Notifies via macOS notification after delay.
pub struct SetTimer;

impl SetTimer {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for SetTimer {
    fn name(&self) -> &'static str {
        "set_timer"
    }
    fn description(&self) -> &'static str {
        "Set a countdown timer that sends a macOS notification when it expires. Use when the user says 'set a timer for 5 minutes', 'remind me in 30 seconds', 'alarm in 1 hour', or 'start a countdown'."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let seconds = payload
            .get("seconds")
            .and_then(Value::as_u64)
            .ok_or("Missing 'seconds'")?;
        let label = payload
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Timer done!");
        let label_owned = label.to_string();

        // Spawn async timer that sends notification when done
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(seconds));
            let script = format!(
                r#"display notification "{}" with title "SynthesisOS Timer" sound name "Glass""#,
                label_owned.replace('"', "\\\"")
            );
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output();
        });

        let mins = seconds / 60;
        let secs = seconds % 60;
        if mins > 0 {
            Ok(format!("Timer set for {}m {}s: \"{}\"", mins, secs, label))
        } else {
            Ok(format!("Timer set for {}s: \"{}\"", seconds, label))
        }
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "seconds": { "type": "integer", "description": "Timer duration in seconds" },
                        "label": { "type": "string", "description": "Message to show when timer fires" }
                    },
                    "required": ["seconds"]
                }
            }
        })
    }
}

// ── Image Search ──────────────────────────────────────────────

/// Search for images on the web. Uses SearXNG image category or DuckDuckGo fallback.
pub struct SearchImages;

impl SearchImages {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for SearchImages {
    fn name(&self) -> &'static str {
        "search_images"
    }
    fn description(&self) -> &'static str {
        "Search the web for images and photos by keyword. Returns image URLs with titles. Use when the user says 'find images of', 'show me pictures of', 'search for photos', or needs visual content for any topic."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing 'query'".to_string())?;
        let count = payload.get("count").and_then(Value::as_u64).unwrap_or(6) as usize;

        let chrome_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
        let client = reqwest::blocking::Client::builder()
            .user_agent(chrome_ua)
            .timeout(std::time::Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| e.to_string())?;

        // Helper: validate image URL (same blocklist as the original TypeScript)
        fn is_valid_image_url(url_str: &str) -> bool {
            if !url_str.starts_with("https") {
                return false;
            }
            let host = url_str.split('/').nth(2).unwrap_or("").to_lowercase();
            let blocked = [
                "localhost",
                "127.0.0.1",
                "imgur.com",
                "i.imgur.com",
                "placeholder.com",
                "placehold.co",
            ];
            if blocked
                .iter()
                .any(|b| host == *b || host.ends_with(&format!(".{}", b)))
            {
                return false;
            }
            if host.ends_with(".local") {
                return false;
            }
            true
        }

        fn format_results(images: &[(String, String)], query: &str) -> String {
            let lines: Vec<String> = images
                .iter()
                .enumerate()
                .map(|(i, (url, title))| {
                    format!(
                        "- {}\n  Image: {}\n  Thumbnail: {}",
                        if title.is_empty() {
                            format!("Image {}", i + 1)
                        } else {
                            title.clone()
                        },
                        url,
                        url
                    )
                })
                .collect();
            format!(
                "Found {} images for \"{}\":\n\n{}",
                images.len(),
                query,
                lines.join("\n\n")
            )
        }

        // ── Strategy 1: DuckDuckGo i.js Image API (original TypeScript method) ──
        // Step 1: Get vqd token from DDG search page
        // Step 2: Query /i.js endpoint for actual image results
        {
            let search_url = format!("https://duckduckgo.com/?q={}", urlencoding::encode(query));
            if let Ok(resp) = client.get(&search_url).send() {
                if let Ok(html) = resp.text() {
                    // Extract vqd token
                    let vqd_re = regex::Regex::new(r#"vqd=["']?([^"'&]+)"#).unwrap();
                    let vqd_alt = regex::Regex::new(r#"vqd=([\d-]+)"#).unwrap();
                    let vqd = vqd_re
                        .captures(&html)
                        .or_else(|| vqd_alt.captures(&html))
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().to_string());

                    if let Some(vqd_token) = vqd {
                        let api_url = format!(
                            "https://duckduckgo.com/i.js?q={}&o=json&p=1&s=0&u=bing&f=,,,,,&l=us-en&vqd={}",
                            urlencoding::encode(query), vqd_token
                        );
                        if let Ok(api_resp) = client
                            .get(&api_url)
                            .header("Referer", "https://duckduckgo.com/")
                            .send()
                        {
                            if let Ok(json) = api_resp.json::<Value>() {
                                if let Some(results) = json.get("results").and_then(Value::as_array)
                                {
                                    let images: Vec<(String, String)> = results
                                        .iter()
                                        .filter_map(|r| {
                                            let url = r.get("image").and_then(Value::as_str)?;
                                            if !is_valid_image_url(url) {
                                                return None;
                                            }
                                            let title = r
                                                .get("title")
                                                .and_then(Value::as_str)
                                                .unwrap_or("")
                                                .to_string();
                                            Some((url.to_string(), title))
                                        })
                                        .take(count)
                                        .collect();
                                    if !images.is_empty() {
                                        println!(
                                            "[SearchImages] DDG i.js: {} results",
                                            images.len()
                                        );
                                        return Ok(format_results(&images, query));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Strategy 2: Bing Images HTML scrape (original TypeScript method) ──
        {
            let bing_url = format!(
                "https://www.bing.com/images/search?q={}&form=HDRSC2&first=1",
                urlencoding::encode(query)
            );
            if let Ok(resp) = client.get(&bing_url).send() {
                if let Ok(html) = resp.text() {
                    // Bing embeds image URLs in murl attributes: murl&quot;:&quot;https://...&quot;
                    let murl_re =
                        regex::Regex::new(r#"murl&quot;:&quot;(https?://[^&]+?)&quot;"#).unwrap();
                    let mut seen = std::collections::HashSet::new();
                    let images: Vec<(String, String)> = murl_re
                        .captures_iter(&html)
                        .filter_map(|c| {
                            let url = c.get(1)?.as_str().replace("&amp;", "&");
                            if !is_valid_image_url(&url) || seen.contains(&url) {
                                return None;
                            }
                            seen.insert(url.clone());
                            Some((url, String::new()))
                        })
                        .take(count)
                        .collect();
                    if !images.is_empty() {
                        println!("[SearchImages] Bing HTML: {} results", images.len());
                        return Ok(format_results(&images, query));
                    }
                }
            }
        }

        // ── Strategy 3: Wikimedia Commons API (good for specific topics) ──
        {
            let url = format!(
                "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={}&gsrnamespace=6&gsrlimit={}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json",
                urlencoding::encode(query), count.min(10)
            );
            if let Ok(resp) = client.get(&url).send() {
                if let Ok(json) = resp.json::<Value>() {
                    if let Some(pages) = json
                        .get("query")
                        .and_then(|q| q.get("pages"))
                        .and_then(Value::as_object)
                    {
                        let images: Vec<(String, String)> = pages
                            .values()
                            .take(count)
                            .filter_map(|page| {
                                let title = page
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Image")
                                    .trim_start_matches("File:")
                                    .to_string();
                                let imageinfo =
                                    page.get("imageinfo").and_then(Value::as_array)?.first()?;
                                let full = imageinfo
                                    .get("thumburl")
                                    .and_then(Value::as_str)
                                    .or_else(|| imageinfo.get("url").and_then(Value::as_str))?;
                                Some((full.to_string(), title))
                            })
                            .collect();
                        if !images.is_empty() {
                            println!("[SearchImages] Wikimedia: {} results", images.len());
                            return Ok(format_results(&images, query));
                        }
                    }
                }
            }
        }

        // ── Strategy 4: Google Images scrape ──
        {
            let url = format!(
                "https://www.google.com/search?q={}&tbm=isch&hl=es&num={}",
                urlencoding::encode(query),
                count.min(10)
            );
            if let Ok(resp) = client.get(&url).send() {
                if let Ok(html) = resp.text() {
                    let img_re = regex::Regex::new(
                        r#"\["(https?://[^"]+\.(?:jpg|jpeg|png|webp|gif))[^"]*""#,
                    )
                    .unwrap();
                    let mut seen = std::collections::HashSet::new();
                    let images: Vec<(String, String)> = img_re
                        .captures_iter(&html)
                        .filter_map(|c| {
                            let url = c.get(1)?.as_str().to_string();
                            if url.contains("google.com")
                                || url.contains("gstatic.com")
                                || url.len() > 500
                            {
                                return None;
                            }
                            if !is_valid_image_url(&url) || seen.contains(&url) {
                                return None;
                            }
                            seen.insert(url.clone());
                            Some((url, String::new()))
                        })
                        .take(count)
                        .collect();
                    if !images.is_empty() {
                        println!("[SearchImages] Google Images: {} results", images.len());
                        return Ok(format_results(&images, query));
                    }
                }
            }
        }

        // ── Strategy 5: SearXNG (only if running locally) ──
        for instance in &["http://localhost:8080", "https://search.sapti.me"] {
            let url = format!(
                "{}/search?q={}&format=json&categories=images",
                instance,
                urlencoding::encode(query)
            );
            if let Ok(resp) = client
                .get(&url)
                .timeout(std::time::Duration::from_secs(3))
                .send()
            {
                if let Ok(json) = resp.json::<Value>() {
                    if let Some(arr) = json.get("results").and_then(Value::as_array) {
                        let images: Vec<(String, String)> = arr
                            .iter()
                            .filter_map(|r| {
                                let title = r
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string();
                                let img_url = r
                                    .get("img_src")
                                    .and_then(Value::as_str)
                                    .or_else(|| r.get("url").and_then(Value::as_str))?
                                    .to_string();
                                if !is_valid_image_url(&img_url) {
                                    return None;
                                }
                                Some((img_url, title))
                            })
                            .take(count)
                            .collect();
                        if !images.is_empty() {
                            return Ok(format_results(&images, query));
                        }
                    }
                }
            }
        }

        Err(format!(
            "Could not find images for '{}'. Try web_search with 'images of {}' as a fallback.",
            query, query
        ))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "What to search images for (e.g. 'dinosaur', 'sunset beach')" },
                        "count": { "type": "integer", "description": "Number of images to return (default: 5, max: 10)" }
                    },
                    "required": ["query"]
                }
            }
        })
    }
}

/// Tool Manager
/// Acts as a registry for all available native tools and safely dispatches execution.
pub struct ToolManager {
    tools: HashMap<String, Box<dyn Tool>>,
    #[allow(dead_code)]
    app_handle: tauri::AppHandle,
}

impl ToolManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            tools: HashMap::new(),
            app_handle,
        }
    }

    /// Register a new tool with the OS subsystem.
    pub fn register(&mut self, tool: Box<dyn Tool>) {
        println!("[Kernel:Tools] Registered tool: {}", tool.name());
        self.tools.insert(tool.name().to_string(), tool);
    }

    /// Dispatch a tool execution request by name.
    pub fn execute(&self, tool_name: &str, args: &str) -> Result<String, String> {
        if let Some(tool) = self.tools.get(tool_name) {
            tool.execute(args)
        } else {
            Err(format!("Tool '{}' not found in registry.", tool_name))
        }
    }

    /// Retrieves all registered tool definitions for LLM context.
    pub fn get_tool_definitions(&self) -> Vec<Value> {
        self.tools.values().map(|t| t.definition()).collect()
    }
}

/// A Tool to retrieve GodMode Spatial Window coordinates from the frontend.
pub struct GetSpatialBounds {
    app_handle: tauri::AppHandle,
}
/// A tool to fetch and read the text content of any URL.
pub struct WebScraper;

impl WebScraper {
    pub fn new() -> Self {
        Self
    }
}

/// A tool to get current weather for a city using wttr.in.
pub struct Weather;

impl Weather {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for Weather {
    fn name(&self) -> &'static str {
        "weather"
    }

    fn description(&self) -> &'static str {
        "Get the current weather forecast for any city: temperature, conditions, humidity, wind speed, and feels-like. Use when the user asks 'what's the weather', 'is it going to rain', 'temperature in Madrid', or 'weather forecast'."
    }

    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON arguments: {}", e))?;

        let city = payload
            .get("city")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing required argument: 'city'".to_string())?;

        let url = format!("https://wttr.in/{}?format=j1", urlencoding::encode(city));

        let client = reqwest::blocking::Client::builder()
            .user_agent("curl/7.64.1")
            // Avoid hanging the entire agent if wttr.in is slow or unreachable
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;

        let response = client
            .get(&url)
            .send()
            .map_err(|e| format!("Weather request failed: {}", e))?;

        let text = response
            .text()
            .map_err(|e| format!("Failed to read weather response: {}", e))?;

        // Parse wttr.in j1 format: extract current_condition from JSON
        let json: Value =
            serde_json::from_str(&text).map_err(|e| format!("Invalid weather JSON: {}", e))?;

        let current = json
            .get("current_condition")
            .and_then(|arr| arr.as_array())
            .and_then(|a| a.first())
            .ok_or_else(|| "No current condition in response".to_string())?;

        let temp = current.get("temp_C").and_then(Value::as_str).unwrap_or("?");
        let feels = current
            .get("FeelsLikeC")
            .and_then(Value::as_str)
            .unwrap_or("?");
        let desc = current
            .get("weatherDesc")
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .and_then(|o| o.get("value"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown");
        let humidity = current
            .get("humidity")
            .and_then(Value::as_str)
            .unwrap_or("?");
        let wind = current
            .get("windspeedKmph")
            .and_then(Value::as_str)
            .unwrap_or("?");

        Ok(format!(
            "Weather in {}: {}°C (feels like {}°C). {}. Humidity: {}%. Wind: {} km/h.",
            city, temp, feels, desc, humidity, wind
        ))
    }

    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "City name (e.g. Madrid, London, New York)"
                        }
                    },
                    "required": ["city"]
                }
            }
        })
    }
}

impl Tool for WebScraper {
    fn name(&self) -> &'static str {
        "web_scrape"
    }

    fn description(&self) -> &'static str {
        "Fetch the raw HTML and text content of a web page URL. Lower-level than read_page — returns full HTML for processing. Use for web scraping, data extraction, or when read_page is insufficient."
    }

    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON arguments: {}", e))?;

        let url = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing required argument: 'url'".to_string())?;

        // Blocking request for simplicity within the Tool trait (which is called from a tokio worker)
        // Note: In production we'd use a more robust scraper with headless browser support.
        let client = reqwest::blocking::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .build()
            .map_err(|e| e.to_string())?;

        let response = client
            .get(url)
            .send()
            .map_err(|e| format!("Request failed: {}", e))?;

        let text = response
            .text()
            .map_err(|e| format!("Failed to read body: {}", e))?;

        // Truncate to avoid exploding LLM context (First 5000 chars)
        let limit = 5000;
        if text.len() > limit {
            Ok(format!("{}... [TRUNCATED]", &text[..limit]))
        } else {
            Ok(text)
        }
    }

    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The URL to scrape."
                        }
                    },
                    "required": ["url"]
                }
            }
        })
    }
}

impl GetSpatialBounds {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl Tool for GetSpatialBounds {
    fn name(&self) -> &'static str {
        "get_spatial_bounds"
    }

    fn description(&self) -> &'static str {
        "Retrieves the 3D X/Y spatial floating coordinates of all active GUI windows. Use this to determine layout logic for GodMode."
    }

    fn execute(&self, _args: &str) -> Result<String, String> {
        let state = self.app_handle.state::<KernelState>();
        // Using blocking lock since execute is called from a tokio worker thread but needs to be synchronous for the Tool trait.
        // For production, we'd either change the trait to be async or use a block_on.
        let map =
            tauri::async_runtime::block_on(async { state.spatial_positions.lock().await.clone() });
        match serde_json::to_string(&map) {
            Ok(json) => Ok(json),
            Err(e) => Err(format!("Failed to serialize spatial bounds: {}", e)),
        }
    }

    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        })
    }
}

/// Tool to fetch full content of a spatial node by ID (lazy loading).
pub struct GetNodeContent {
    app_handle: tauri::AppHandle,
}

impl GetNodeContent {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl Tool for GetNodeContent {
    fn name(&self) -> &'static str {
        "get_node_content"
    }

    fn description(&self) -> &'static str {
        "Fetch the full content (title, summary, type) of a spatial node by its ID. Use when you need details about a specific open card/node in the workspace. The OTHER ACTIVE SPATIAL NODES section lists only id and title; call this tool for full content when relevant."
    }

    fn execute(&self, args: &str) -> Result<String, String> {
        let payload: Value =
            serde_json::from_str(args).map_err(|e| format!("Invalid JSON arguments: {}", e))?;
        let node_id = payload
            .get("node_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing required argument: 'node_id'".to_string())?;

        let state = self.app_handle.state::<KernelState>();
        let reg =
            tauri::async_runtime::block_on(async { state.node_registry.read().await.clone() });
        match reg.get(node_id) {
            Some(n) => Ok(format!(
                "id: {}\ntitle: {}\ntype: {}\nsummary: {}",
                n.id,
                n.title,
                n.node_type,
                if n.summary.is_empty() {
                    "(empty)"
                } else {
                    &n.summary
                }
            )),
            None => Err(format!(
                "Node '{}' not found in registry. It may have been closed.",
                node_id
            )),
        }
    }

    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "The ID of the spatial node to fetch (from OTHER ACTIVE SPATIAL NODES list)."
                        }
                    },
                    "required": ["node_id"]
                }
            }
        })
    }
}

// ══════════════════════════════════════════════════════════════
// LSFS STORAGE TOOLS — Agent access to the versioned file system
// ══════════════════════════════════════════════════════════════

use crate::syscall::{Syscall, SyscallResponse};
use tokio::sync::oneshot;

/// Helper: send a syscall through KernelState and block until response arrives.
fn send_syscall(
    app_handle: &tauri::AppHandle,
    make_syscall: impl FnOnce(oneshot::Sender<SyscallResponse>) -> Syscall,
) -> Result<String, String> {
    let state = app_handle.state::<KernelState>();
    let (tx, rx) = oneshot::channel();
    let syscall = make_syscall(tx);
    tauri::async_runtime::block_on(async {
        state
            .syscall_tx
            .send(syscall)
            .await
            .map_err(|e| format!("Failed to send syscall: {}", e))?;
        let resp = rx
            .await
            .map_err(|e| format!("Syscall response channel closed: {}", e))?;
        match resp.data {
            Ok(val) => Ok(serde_json::to_string(&val).unwrap_or_else(|_| "null".to_string())),
            Err(e) => Err(e),
        }
    })
}

/// Storage Read — read latest version of a file from LSFS.
pub struct StorageReadTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageReadTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageReadTool {
    fn name(&self) -> &'static str {
        "storage_read"
    }
    fn description(&self) -> &'static str {
        "Read a file from the OS internal versioned storage (LSFS). Retrieves the latest version of documents, notes, or data stored by the kernel. Use for accessing OS-managed files with version history."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageRead {
            agent_id,
            path,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"File path in LSFS (e.g. /docs/notes.txt)"}},"required":["agent_id","path"]}}})
    }
}

/// Storage Write — write data to a file (creates new version if auto-versioning is ON).
pub struct StorageWriteTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageWriteTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageWriteTool {
    fn name(&self) -> &'static str {
        "storage_write"
    }
    fn description(&self) -> &'static str {
        "Write or update a file in the OS internal versioned storage (LSFS). Automatically creates a new version when auto-versioning is enabled, preserving history. Use for saving documents, notes, or data that benefit from version tracking."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        let data = p
            .get("data")
            .and_then(Value::as_str)
            .ok_or("Missing 'data'")?
            .to_string();
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageWrite {
            agent_id,
            path,
            data,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"File path in LSFS"},"data":{"type":"string","description":"Content to write"}},"required":["agent_id","path","data"]}}})
    }
}

/// Storage Create — create a new file or directory.
pub struct StorageCreateTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageCreateTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageCreateTool {
    fn name(&self) -> &'static str {
        "storage_create"
    }
    fn description(&self) -> &'static str {
        "Create a new file or folder in the OS internal versioned storage (LSFS). Provide content for a file, or omit content to create a directory. Use for initializing new documents or organizing the internal storage structure."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        let content = p.get("content").and_then(Value::as_str).map(String::from);
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageCreate {
            agent_id,
            path,
            content,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"Path to create"},"content":{"type":"string","description":"File content (omit for directory)"}},"required":["agent_id","path"]}}})
    }
}

/// Storage List — list directory contents with metadata.
pub struct StorageListTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageListTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageListTool {
    fn name(&self) -> &'static str {
        "storage_list"
    }
    fn description(&self) -> &'static str {
        "List files and folders in the OS internal versioned storage (LSFS). Returns metadata including name, size, version number, and timestamps. Use to browse and explore the kernel's internal file structure."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageList {
            agent_id,
            path,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"Directory path to list"}},"required":["agent_id","path"]}}})
    }
}

/// Storage Delete — delete a file or directory from LSFS.
pub struct StorageDeleteTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageDeleteTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageDeleteTool {
    fn name(&self) -> &'static str {
        "storage_delete"
    }
    fn description(&self) -> &'static str {
        "Permanently delete a file or directory from the OS internal versioned storage (LSFS). This action cannot be undone. Use when the user wants to remove old or unwanted files from internal storage."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageDelete {
            agent_id,
            path,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"Path to delete"}},"required":["agent_id","path"]}}})
    }
}

/// Storage Rollback — revert a file to a specific version.
pub struct StorageRollbackTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageRollbackTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageRollbackTool {
    fn name(&self) -> &'static str {
        "storage_rollback"
    }
    fn description(&self) -> &'static str {
        "Revert a file in LSFS to a previous version. Restores the file content to an earlier state. Use storage_versions first to see available version numbers. Use when the user wants to undo changes or restore an older version of a document."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        let version = p
            .get("version")
            .and_then(Value::as_u64)
            .ok_or("Missing 'version'")?;
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageRollback {
            agent_id,
            path,
            version,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"File path to rollback"},"version":{"type":"integer","description":"Target version number"}},"required":["agent_id","path","version"]}}})
    }
}

/// Storage Versions — get version history for a file.
pub struct StorageVersionsTool {
    pub app_handle: tauri::AppHandle,
}
impl StorageVersionsTool {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}
impl Tool for StorageVersionsTool {
    fn name(&self) -> &'static str {
        "storage_versions"
    }
    fn description(&self) -> &'static str {
        "View the complete version history of a file in LSFS. Returns all version numbers, timestamps, and sizes. Use to check what versions are available before rolling back, or to see when a file was last modified."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let agent_id = p
            .get("agent_id")
            .and_then(Value::as_str)
            .ok_or("Missing 'agent_id'")?
            .to_string();
        let path = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?
            .to_string();
        send_syscall(&self.app_handle, |response_tx| Syscall::StorageVersions {
            agent_id,
            path,
            response_tx,
        })
    }
    fn definition(&self) -> Value {
        serde_json::json!({"type":"function","function":{"name":self.name(),"description":self.description(),"parameters":{"type":"object","properties":{"agent_id":{"type":"string","description":"The agent's unique ID"},"path":{"type":"string","description":"File path to check versions"}},"required":["agent_id","path"]}}})
    }
}

// ══════════════════════════════════════════════════════════════
// REAL FILESYSTEM TOOLS — Read/Write/Append to actual macOS disk
// These are SENSITIVE (requiresApproval in the agent pipeline).
// ══════════════════════════════════════════════════════════════

/// Write (or create) a file anywhere on the real macOS filesystem.
/// Creates parent directories if needed. Overwrites existing content.
pub struct FileWrite;
impl Tool for FileWrite {
    fn name(&self) -> &'static str {
        "file_write"
    }
    fn description(&self) -> &'static str {
        "Create or overwrite a file on the Mac's real filesystem. Use for saving documents, scripts, text files, or any content to Desktop, Documents, Downloads, or any directory. Creates parent folders automatically. Requires absolute paths like /Users/gaston/Desktop/file.txt."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path_str = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;
        let content = p
            .get("content")
            .and_then(Value::as_str)
            .ok_or("Missing 'content'")?;

        let path = std::path::Path::new(path_str);

        // Create parent directories if they don't exist
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }

        std::fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(format!(
            "File written successfully: {} ({} bytes)",
            path_str,
            content.len()
        ))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute file path on macOS (e.g. /Users/gaston/Desktop/file.txt)" },
                        "content": { "type": "string", "description": "Text content to write" }
                    },
                    "required": ["path", "content"]
                }
            }
        })
    }
}

/// Append content to an existing file (or create if missing).
pub struct FileAppend;
impl Tool for FileAppend {
    fn name(&self) -> &'static str {
        "file_append"
    }
    fn description(&self) -> &'static str {
        "Append text to the end of a file on the Mac's real filesystem. Creates the file if it doesn't exist. Use for adding entries to logs, journals, notes, or any file where you want to add content without overwriting existing text."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        use std::io::Write;
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path_str = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;
        let content = p
            .get("content")
            .and_then(Value::as_str)
            .ok_or("Missing 'content'")?;

        let path = std::path::Path::new(path_str);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to append: {}", e))?;

        Ok(format!("Appended {} bytes to {}", content.len(), path_str))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute file path on macOS" },
                        "content": { "type": "string", "description": "Text to append" }
                    },
                    "required": ["path", "content"]
                }
            }
        })
    }
}

/// Read any file from the real macOS filesystem (no sandbox restriction).
pub struct FileReadFull;
impl Tool for FileReadFull {
    fn name(&self) -> &'static str {
        "file_read_full"
    }
    fn description(&self) -> &'static str {
        "Read the full contents of any file on the Mac's real filesystem. Use for reading documents, configs, scripts, logs, or any text file. Supports files up to 5MB. Use absolute paths like /Users/gaston/Documents/file.txt."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path_str = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;

        let metadata = std::fs::metadata(path_str)
            .map_err(|e| format!("Cannot access '{}': {}", path_str, e))?;

        // Safety: refuse files > 5MB to avoid LLM context overflow
        if metadata.len() > 5 * 1024 * 1024 {
            return Err(format!(
                "File too large ({} bytes). Max 5MB.",
                metadata.len()
            ));
        }

        std::fs::read_to_string(path_str)
            .map_err(|e| format!("Failed to read '{}': {}", path_str, e))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute file path on macOS" }
                    },
                    "required": ["path"]
                }
            }
        })
    }
}

/// List directory contents on the real macOS filesystem with metadata.
pub struct DirList;
impl Tool for DirList {
    fn name(&self) -> &'static str {
        "dir_list"
    }
    fn description(&self) -> &'static str {
        "List the contents of any folder on the Mac's real filesystem. Returns each item's name, type (file or folder), size, and last modified date. Use to explore Desktop, Documents, Downloads, or any directory. Like 'ls -la' in the terminal."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let path_str = p
            .get("path")
            .and_then(Value::as_str)
            .ok_or("Missing 'path'")?;

        let entries = std::fs::read_dir(path_str)
            .map_err(|e| format!("Failed to list '{}': {}", path_str, e))?;

        let mut results = Vec::new();
        for entry in entries.flatten() {
            let meta = entry.metadata().ok();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            results.push(serde_json::json!({
                "name": name,
                "is_dir": is_dir,
                "size": size,
                "modified_epoch": modified,
            }));
        }

        Ok(serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute directory path" }
                    },
                    "required": ["path"]
                }
            }
        })
    }
}

/// Move or rename a file/folder on the real macOS filesystem.
pub struct FileMove;
impl Tool for FileMove {
    fn name(&self) -> &'static str {
        "file_move"
    }
    fn description(&self) -> &'static str {
        "Move or rename a file or folder on the Mac's real filesystem. Use for organizing files, renaming documents, or relocating items between directories. Creates destination parent folders automatically."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let from = p
            .get("from")
            .and_then(Value::as_str)
            .ok_or("Missing 'from'")?;
        let to = p.get("to").and_then(Value::as_str).ok_or("Missing 'to'")?;

        // Create target parent dirs if needed
        let to_path = std::path::Path::new(to);
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create target dirs: {}", e))?;
        }

        std::fs::rename(from, to)
            .map_err(|e| format!("Failed to move '{}' → '{}': {}", from, to, e))?;

        Ok(format!("Moved {} → {}", from, to))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string", "description": "Source path" },
                        "to": { "type": "string", "description": "Destination path" }
                    },
                    "required": ["from", "to"]
                }
            }
        })
    }
}

/// Copy a file on the real macOS filesystem.
pub struct FileCopy;
impl Tool for FileCopy {
    fn name(&self) -> &'static str {
        "file_copy"
    }
    fn description(&self) -> &'static str {
        "Copy a file to a new location on the Mac's real filesystem. Use for duplicating documents, making backups, or copying files between directories. Creates destination parent folders automatically."
    }
    fn execute(&self, args: &str) -> Result<String, String> {
        let p: Value = serde_json::from_str(args).map_err(|e| format!("Invalid JSON: {}", e))?;
        let from = p
            .get("from")
            .and_then(Value::as_str)
            .ok_or("Missing 'from'")?;
        let to = p.get("to").and_then(Value::as_str).ok_or("Missing 'to'")?;

        let to_path = std::path::Path::new(to);
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create target dirs: {}", e))?;
        }

        std::fs::copy(from, to)
            .map_err(|e| format!("Failed to copy '{}' → '{}': {}", from, to, e))?;

        Ok(format!("Copied {} → {}", from, to))
    }
    fn definition(&self) -> Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string", "description": "Source file path" },
                        "to": { "type": "string", "description": "Destination file path" }
                    },
                    "required": ["from", "to"]
                }
            }
        })
    }
}
