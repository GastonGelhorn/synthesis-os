/**
 * tauriBridge.ts — centralised gateway to Rust backend.
 *
 * Every macOS tool imports helpers from HERE instead of `child_process`.
 * All calls go through Tauri `invoke()`. The app only runs inside Tauri.
 *
 * The detection is done ONCE at module load — no per-tool overhead.
 */

let _isTauri: boolean | null = null;

/** Returns true when running inside a Tauri native window. Cached after first call. */
export function isTauri(): boolean {
    if (_isTauri === null) {
        _isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    }
    return _isTauri;
}

/** Dynamically import and call invoke — only loaded when in Tauri */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
}

/** Throw a clear error when a Tauri-only operation is called outside Tauri */
function requireTauri(): void {
    if (!isTauri()) {
        throw new Error(
            "This operation requires the Tauri native runtime. " +
            "SynthesisOS must be run as a desktop app (npm run dev:tauri)."
        );
    }
}

// ── System Operations ───────────────────────────────────────────────

export async function clipboardRead(): Promise<string> {
    requireTauri();
    return invoke<string>("clipboard_read");
}

export async function clipboardWrite(text: string): Promise<void> {
    requireTauri();
    await invoke<void>("clipboard_write", { text });
}

export async function systemNotify(title: string, body: string): Promise<void> {
    requireTauri();
    await invoke<void>("system_notify", { title, body });
}

export async function getVolume(): Promise<number> {
    requireTauri();
    return invoke<number>("get_volume");
}

export async function setVolume(level: number): Promise<void> {
    requireTauri();
    await invoke<void>("set_volume", { level });
}

export async function getVolumeMuted(): Promise<boolean> {
    requireTauri();
    const result = await invoke<string>("run_applescript", { script: "output muted of (get volume settings)" });
    return result.trim() === "true";
}

export async function setVolumeMuted(muted: boolean): Promise<void> {
    requireTauri();
    await invoke<string>("run_applescript", { script: `set volume output muted ${muted}` });
}

export async function getBrightness(): Promise<number> {
    requireTauri();
    return invoke<number>("get_brightness");
}

export async function setBrightness(level: number): Promise<void> {
    requireTauri();
    await invoke<void>("set_brightness", { level: level / 100 });
}

export async function toggleDarkMode(): Promise<boolean> {
    requireTauri();
    return invoke<boolean>("toggle_dark_mode");
}

export interface BatteryInfo {
    percentage: number;
    charging: boolean;
    source: string;
}

export async function getBattery(): Promise<BatteryInfo> {
    requireTauri();
    return invoke<BatteryInfo>("get_battery");
}

export interface WifiInfo {
    ssid: string;
    signal: string;
    connected: boolean;
}

export async function getWifi(): Promise<WifiInfo> {
    requireTauri();
    return invoke<WifiInfo>("get_wifi");
}

export interface SystemInfoResult {
    os_name: string;
    os_version: string;
    hostname: string;
    cpu: string;
    memory_gb: number;
    arch: string;
    disk_total_gb?: number;
    disk_free_gb?: number;
}

export async function getSystemInfo(): Promise<SystemInfoResult> {
    requireTauri();
    return invoke<SystemInfoResult>("get_system_info");
}

export async function openApp(name: string): Promise<void> {
    requireTauri();
    await invoke<void>("open_app", { name });
}

export async function sayTts(text: string, voice?: string, rate?: number): Promise<void> {
    requireTauri();
    await invoke<void>("say_tts", { text, voice: voice || null, rate: rate ? Math.round(rate) : null });
}

export async function takeScreenshot(): Promise<string> {
    requireTauri();
    return invoke<string>("take_screenshot");
}

export async function searchFiles(query: string): Promise<string[]> {
    requireTauri();
    return invoke<string[]>("search_files", { query });
}

// ── App Operations ──────────────────────────────────────────────────

/** Run raw AppleScript via Tauri's Rust backend. */
export async function runAppleScript(script: string, _timeout = 15000): Promise<string> {
    requireTauri();
    return invoke<string>("run_applescript", { script });
}

/** Run raw JXA (JavaScript for Automation) via Tauri's Rust backend. */
export async function runJxa(script: string, _timeout = 15000): Promise<string> {
    requireTauri();
    return invoke<string>("run_jxa", { script });
}

export interface NoteItem { title: string; date: string; }

export async function notesList(query?: string): Promise<NoteItem[]> {
    requireTauri();
    return invoke<NoteItem[]>("notes_list", { query: query || null });
}

export async function notesRead(title: string): Promise<string> {
    requireTauri();
    return invoke<string>("notes_read", { title });
}

export async function notesCreate(title: string, body: string): Promise<void> {
    requireTauri();
    await invoke<void>("notes_create", { title, body });
}

export interface EmailMessage {
    subject: string;
    from: string;
    date: string;
    read: boolean;
    preview: string;
}

export async function emailList(mailbox = "INBOX", max = 10, unreadOnly = false): Promise<EmailMessage[]> {
    requireTauri();
    return invoke<EmailMessage[]>("email_list", { mailbox, max, unreadOnly });
}

export interface CalendarEvent {
    title: string;
    start_timestamp?: number;
    end_timestamp?: number;
    start_date?: string;
    end_date?: string;
    location: string;
    notes?: string;
    calendar?: string;
}

export async function getCalendarEvents(startOffsetDays: number, endOffsetDays: number): Promise<CalendarEvent[]> {
    requireTauri();
    return invoke<CalendarEvent[]>("get_calendar_events", { startOffsetDays, endOffsetDays });
}

export async function calendarToday(): Promise<CalendarEvent[]> {
    requireTauri();
    return invoke<CalendarEvent[]>("calendar_today");
}

export async function calendarCreate(title: string, start: string, end: string, notes?: string): Promise<void> {
    requireTauri();
    await invoke<void>("calendar_create", { title, start, end, notes: notes || null });
}

export interface ReminderItem { name: string; due_date: string; completed: boolean; }

export async function remindersList(): Promise<ReminderItem[]> {
    requireTauri();
    return invoke<ReminderItem[]>("reminders_list");
}

export async function remindersAdd(title: string, due?: string): Promise<void> {
    requireTauri();
    await invoke<void>("reminders_add", { title, due: due || null });
}

export interface ContactInfo { name: string; email: string; phone: string; }

export async function contactsSearch(query: string): Promise<ContactInfo[]> {
    requireTauri();
    return invoke<ContactInfo[]>("contacts_search", { query });
}

export async function musicPlay(query?: string): Promise<string> {
    requireTauri();
    return invoke<string>("music_play", { query: query || null });
}

export async function musicPause(): Promise<void> {
    requireTauri();
    await invoke<void>("music_pause");
}

export async function musicNext(): Promise<void> {
    requireTauri();
    await invoke<void>("music_next");
}

export async function finderOpen(path: string): Promise<void> {
    requireTauri();
    await invoke<void>("finder_open", { path });
}

export async function finderTrash(path: string): Promise<void> {
    requireTauri();
    await invoke<void>("finder_trash", { path });
}

export async function safariTabs(): Promise<string[]> {
    requireTauri();
    return invoke<string[]>("safari_tabs");
}

// ── Desktop Takeover (Jarvis Mode) ──────────────────────────────

/** Enter Jarvis Mode: hide desktop icons + auto-hide dock + fullscreen (Rust handles window) */
export async function enterJarvisMode(): Promise<void> {
    requireTauri();
    await invoke<void>("enter_jarvis_mode");
}

/** Exit Jarvis Mode: restore desktop icons + dock + exit fullscreen (Rust handles window) */
export async function exitJarvisMode(): Promise<void> {
    requireTauri();
    await invoke<void>("exit_jarvis_mode");
}

/** Hide desktop icons only */
export async function hideDesktopIcons(): Promise<void> {
    requireTauri();
    await invoke<void>("hide_desktop_icons");
}

/** Show desktop icons only */
export async function showDesktopIcons(): Promise<void> {
    requireTauri();
    await invoke<void>("show_desktop_icons");
}

/** Hide dock (enable auto-hide) */
export async function hideDock(): Promise<void> {
    requireTauri();
    await invoke<void>("hide_dock");
}

/** Show dock (disable auto-hide) */
export async function showDock(): Promise<void> {
    requireTauri();
    await invoke<void>("show_dock");
}
