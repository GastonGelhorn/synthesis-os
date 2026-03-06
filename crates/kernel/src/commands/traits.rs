use serde::{Deserialize, Serialize};

// ── Data Types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct BatteryInfo {
    pub percentage: f32,
    pub charging: bool,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WifiInfo {
    pub ssid: String,
    pub signal: String,
    pub connected: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
    pub cpu: String,
    pub memory_gb: f32,
    pub arch: String,
    /// Disk space in GB for root volume (/). None if unavailable (e.g. Windows).
    pub disk_total_gb: Option<f32>,
    pub disk_free_gb: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteItem {
    pub title: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailMessage {
    pub id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub read: bool,
    pub preview: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    pub location: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReminderItem {
    pub name: String,
    pub due_date: String,
    pub completed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactInfo {
    pub name: String,
    pub email: String,
    pub phone: String,
}

// ── System Bridge ───────────────────────────────────────────────────

/// Platform-agnostic system operations.
/// macOS: implemented via AppleScript / CLI tools.
/// Windows (future): via COM, WMI, PowerShell.
pub trait SystemBridge: Send + Sync {
    fn clipboard_read(&self) -> impl std::future::Future<Output = Result<String, String>> + Send;
    fn clipboard_write(
        &self,
        text: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn notify(
        &self,
        title: &str,
        body: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn get_volume(&self) -> impl std::future::Future<Output = Result<f32, String>> + Send;
    fn set_volume(
        &self,
        level: f32,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn get_brightness(&self) -> impl std::future::Future<Output = Result<f32, String>> + Send;
    fn set_brightness(
        &self,
        level: f32,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn toggle_dark_mode(&self) -> impl std::future::Future<Output = Result<bool, String>> + Send;
    fn get_battery(&self) -> impl std::future::Future<Output = Result<BatteryInfo, String>> + Send;
    fn get_wifi(&self) -> impl std::future::Future<Output = Result<WifiInfo, String>> + Send;
    fn get_system_info(
        &self,
    ) -> impl std::future::Future<Output = Result<SystemInfo, String>> + Send;
    fn open_app(&self, name: &str) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn say_tts(
        &self,
        text: &str,
        voice: Option<&str>,
        rate: Option<u32>,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn take_screenshot(&self) -> impl std::future::Future<Output = Result<String, String>> + Send;
    fn search_files(
        &self,
        query: &str,
    ) -> impl std::future::Future<Output = Result<Vec<String>, String>> + Send;
}

// ── App Bridge ──────────────────────────────────────────────────────

/// Platform-agnostic app integrations.
/// macOS: Apple Mail, Calendar, Notes, Reminders, Contacts, Music, Finder, Safari.
/// Windows (future): Outlook, OneNote, etc.
pub trait AppBridge: Send + Sync {
    // Notes
    fn notes_list(
        &self,
        query: Option<&str>,
    ) -> impl std::future::Future<Output = Result<Vec<NoteItem>, String>> + Send;
    fn notes_read(
        &self,
        title: &str,
    ) -> impl std::future::Future<Output = Result<String, String>> + Send;
    fn notes_create(
        &self,
        title: &str,
        body: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    // Email
    fn email_list(
        &self,
        mailbox: &str,
        max: u32,
        unread_only: bool,
    ) -> impl std::future::Future<Output = Result<Vec<EmailMessage>, String>> + Send;
    fn email_read(
        &self,
        message_id: &str,
    ) -> impl std::future::Future<Output = Result<String, String>> + Send;

    // Calendar
    fn calendar_today(
        &self,
    ) -> impl std::future::Future<Output = Result<Vec<CalendarEvent>, String>> + Send;
    fn calendar_create(
        &self,
        title: &str,
        start: &str,
        end: &str,
        notes: Option<&str>,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    // Reminders
    fn reminders_list(
        &self,
    ) -> impl std::future::Future<Output = Result<Vec<ReminderItem>, String>> + Send;
    fn reminders_add(
        &self,
        title: &str,
        due: Option<&str>,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    // Contacts
    fn contacts_search(
        &self,
        query: &str,
    ) -> impl std::future::Future<Output = Result<Vec<ContactInfo>, String>> + Send;

    // Music
    fn music_play(
        &self,
        query: Option<&str>,
    ) -> impl std::future::Future<Output = Result<String, String>> + Send;
    fn music_pause(&self) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn music_next(&self) -> impl std::future::Future<Output = Result<(), String>> + Send;

    // Finder
    fn finder_open(
        &self,
        path: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn finder_trash(
        &self,
        path: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    // Safari
    fn safari_tabs(&self) -> impl std::future::Future<Output = Result<Vec<String>, String>> + Send;
}
