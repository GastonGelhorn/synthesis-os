//! Semantic labels for tool execution status — human-readable descriptions
//! shown in the UI instead of raw tool names.

use once_cell::sync::Lazy;
use std::collections::HashMap;

static TOOL_LABELS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    // Web & search
    m.insert("web_search", "Searching the web");
    m.insert("read_page", "Reading page");
    m.insert("search_images", "Searching images");
    m.insert("http_request", "Performing HTTP request");
    m.insert("summarize_url", "Summarizing URL");
    m.insert("youtube_search", "Searching YouTube");
    m.insert("rss_reader", "Reading RSS feed");
    // Knowledge & utilities
    m.insert("weather", "Checking weather");
    m.insert("calculate", "Calculating");
    m.insert("currency_convert", "Converting currency");
    m.insert("define_word", "Looking up definition");
    m.insert("translate", "Translating");
    m.insert("current_time", "Getting current time");
    m.insert("qr_code", "Generating QR code");
    // Files & storage
    m.insert("read_file", "Reading file");
    m.insert("dir_list", "Listing directory");
    m.insert("storage_read", "Reading storage");
    m.insert("storage_list", "Listing storage");
    m.insert("storage_versions", "Checking versions");
    // macOS apps
    m.insert("notes_list", "Checking notes");
    m.insert("notes_read", "Reading note");
    m.insert("email_list", "Checking emails");
    m.insert("calendar_today", "Checking calendar");
    m.insert("reminders_list", "Checking reminders");
    m.insert("contacts_search", "Searching contacts");
    m.insert("safari_tabs", "Checking Safari tabs");
    // System
    m.insert("get_volume", "Getting volume");
    m.insert("get_brightness", "Getting brightness");
    m.insert("get_battery", "Checking battery");
    m.insert("get_wifi", "Checking WiFi");
    m.insert("get_system_info", "Getting system info");
    m.insert("get_spatial_bounds", "Getting spatial bounds");
    m.insert("get_node_content", "Getting node content");
    m.insert("search_files", "Searching files");
    m.insert("clipboard_read", "Reading clipboard");
    m
});

/// Returns a semantic label for a tool name, or a fallback based on the raw name.
pub fn tool_status_label(tool_names: &[&str]) -> String {
    if tool_names.is_empty() {
        return "Executing tools...".to_string();
    }
    let labels: Vec<String> = tool_names
        .iter()
        .map(|&name| {
            TOOL_LABELS
                .get(name)
                .map(|s| (*s).to_string())
                .unwrap_or_else(|| format!("Executing {}", name))
        })
        .collect();
    if labels.len() == 1 {
        labels.into_iter().next().unwrap()
    } else {
        labels.join(" and ")
    }
}
