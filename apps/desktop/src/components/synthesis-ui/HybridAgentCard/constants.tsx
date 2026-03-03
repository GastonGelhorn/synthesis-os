import React from "react";
import {
    Search,
    Globe,
    Code,
    StickyNote,
    Timer,
    BookOpen,
    Brain,
} from "lucide-react";

export const TOOL_ICONS: Record<string, React.ReactNode> = {
    web_search: <Search className="w-3 h-3" />,
    read_page: <Globe className="w-3 h-3" />,
    summarize_url: <BookOpen className="w-3 h-3" />,
    generate_code: <Code className="w-3 h-3" />,
    notes: <StickyNote className="w-3 h-3" />,
    set_timer: <Timer className="w-3 h-3" />,
};

export const TOOL_LABELS: Record<string, string> = {
    web_search: "Searching the web",
    read_page: "Reading page",
    summarize_url: "Summarizing content",
    generate_code: "Generating code",
    notes: "Creating note",
    set_timer: "Setting timer",
    email_reader: "Reading email",
    calendar: "Checking calendar",
    contacts: "Searching contacts",
    reminders: "Creating reminder",
    finder: "Managing files",
    music: "Playing music",
    safari_tabs: "Checking tabs",
    clipboard: "Accessing clipboard",
    open_app: "Opening app",
    desktop_screenshot: "Taking screenshot",
    calculate: "Calculating",
    weather: "Checking weather",
    currency_convert: "Converting currency",
    define_word: "Looking up definition",
    translate: "Translating text",
    search_images: "Searching images",
    image_description: "Analyzing image",
    qr_code: "Generating QR code",
    http_request: "Making API call",
    screenshot_url: "Screenshotting page",
    youtube_search: "Searching YouTube",
    rss_reader: "Reading feed",
    spotlight_search: "Searching files",
    system_info: "Getting system info",
    battery_info: "Checking battery",
    wifi_info: "Checking WiFi",
    say_tts: "Speaking text",
    dark_mode: "Toggling dark mode",
    notify: "Sending notification",
    file_manager: "Reading files",
    volume_brightness: "Adjusting volume/brightness",
};

export function getToolIcon(toolName?: string): React.ReactNode {
    if (!toolName) return <Brain className="w-3 h-3" />;
    return TOOL_ICONS[toolName] ?? <Brain className="w-3 h-3" />;
}

export function getToolLabel(toolName?: string): string {
    if (!toolName) return "Reasoning";
    return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
}
