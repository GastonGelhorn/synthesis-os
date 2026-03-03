export interface A2UIBaseProps {
    id: string; // The A2UI component ID
    isLight?: boolean;
    accentColor?: string;
}

// ==========================================
// A. CORE DATA DISPLAY (Migrated & Enhanced)
// ==========================================

export interface A2UITextProps extends A2UIBaseProps {
    content: string;
    style?: "h1" | "h2" | "h3" | "body" | "caption" | "quote" | "mono";
}

export interface A2UICalloutProps extends A2UIBaseProps {
    content: string;
    title?: string;
    variant?: "info" | "success" | "warning" | "error";
}

export interface A2UIDataGridProps extends A2UIBaseProps {
    items: Array<{ label: string; value: string; icon?: string }>;
}

export interface A2UIStatsRowProps extends A2UIBaseProps {
    stats: Array<{ label: string; value: string | number; trend?: "up" | "down" | "neutral" }>;
}

export interface A2UIActionRowProps extends A2UIBaseProps {
    actions: Array<{ label: string; intent: string; primary?: boolean; icon?: string }>;
}

export interface A2UIImageProps extends A2UIBaseProps {
    url: string;
    caption?: string;
    aspectRatio?: "auto" | "square" | "video" | "panorama";
}

export interface A2UIImageGalleryProps extends A2UIBaseProps {
    images: Array<{ url: string; caption?: string }>;
}

export interface A2UILinkPreviewProps extends A2UIBaseProps {
    url: string;
    title: string;
    description?: string;
    imageUrl?: string;
}

export interface A2UIListProps extends A2UIBaseProps {
    items: Array<{ text: string; icon?: string }>;
    ordered?: boolean;
}

export interface A2UICodeBlockProps extends A2UIBaseProps {
    code: string;
    language?: string;
}

export interface A2UITableProps extends A2UIBaseProps {
    headers: string[];
    rows: string[][];
}

export interface A2UIProgressBarProps extends A2UIBaseProps {
    value: number; // 0-100
    label?: string;
    color?: string;
}

export interface A2UISeparatorProps extends A2UIBaseProps {
    label?: string;
}

export interface A2UICanvasProps extends A2UIBaseProps {
    points: Array<{ label: string; value: number; color?: string }>;
    canvasType?: "bar" | "line" | "pie";
    title?: string;
}

export interface A2UIMarkdownProps extends A2UIBaseProps {
    content: string; // Full markdown content for advanced rendering
}


// ==========================================
// B. LAYOUT & STRUCTURE
// ==========================================

export interface A2UITabsProps extends A2UIBaseProps {
    tabs: Array<{ id: string; label: string; icon?: string }>;
    activeTabId?: string;
    // Children will be managed by A2UIRenderer, 
    // but the component handles the layout
}

export interface A2UIAccordionProps extends A2UIBaseProps {
    title: string;
    icon?: string;
    defaultExpanded?: boolean;
    // children handled by renderer
}

export interface A2UICarouselProps extends A2UIBaseProps {
    // children handled by renderer
    autoPlay?: boolean;
}

export interface A2UITimelineProps extends A2UIBaseProps {
    events: Array<{
        title: string;
        description?: string;
        timestamp: string;
        status?: "done" | "active" | "pending";
    }>;
}

export interface A2UIBadgeSetProps extends A2UIBaseProps {
    badges: Array<{ label: string; color?: string; icon?: string }>;
}


// ==========================================
// C. INTERACTIVE / FORMS
// ==========================================

export interface A2UIInputProps extends A2UIBaseProps {
    value: string;
    placeholder?: string;
    type?: "text" | "password" | "number" | "search";
    label?: string;
}

export interface A2UISelectProps extends A2UIBaseProps {
    value: string;
    options: Array<{ label: string; value: string }>;
    label?: string;
}

export interface A2UIToggleProps extends A2UIBaseProps {
    checked: boolean;
    label: string;
}

export interface A2UISliderProps extends A2UIBaseProps {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
}

export interface A2UIDatePickerProps extends A2UIBaseProps {
    date: string; // ISO string
    label?: string;
}


// ==========================================
// D. SPECIALIZED / MEDIA
// ==========================================

export interface A2UIMapProps extends A2UIBaseProps {
    latitude: number;
    longitude: number;
    zoom?: number;
    markers?: Array<{ lat: number; lng: number; label?: string }>;
}

export interface A2UIAudioPlayerProps extends A2UIBaseProps {
    url: string;
    title?: string;
    artist?: string;
    autoPlay?: boolean;
}

export interface A2UIVideoPlayerProps extends A2UIBaseProps {
    url: string;
    title?: string;
    autoPlay?: boolean;
}

export interface A2UISkeletonProps extends A2UIBaseProps {
    type?: "text" | "card" | "avatar" | "image";
    lines?: number;
}

// Registry map type for type-safe rendering
export type A2UIComponentPropsMap = {
    Text: A2UITextProps;
    TextBlock: A2UITextProps; // Alias for Text
    Callout: A2UICalloutProps;
    DataGrid: A2UIDataGridProps;
    StatsRow: A2UIStatsRowProps;
    ActionRow: A2UIActionRowProps;
    Image: A2UIImageProps;
    HeroImage: A2UIImageProps; // Alias
    ImageGallery: A2UIImageGalleryProps;
    LinkPreview: A2UILinkPreviewProps;
    List: A2UIListProps;
    CodeBlock: A2UICodeBlockProps;
    Table: A2UITableProps;
    ProgressBar: A2UIProgressBarProps;
    Separator: A2UISeparatorProps;
    Canvas: A2UICanvasProps;
    Markdown: A2UIMarkdownProps;

    // Layout
    Tabs: A2UITabsProps;
    Accordion: A2UIAccordionProps;
    Carousel: A2UICarouselProps;
    Timeline: A2UITimelineProps;
    BadgeSet: A2UIBadgeSetProps;
    Column: A2UIBaseProps; // standard container
    Row: A2UIBaseProps; // standard container

    // Interactive
    Input: A2UIInputProps;
    Select: A2UISelectProps;
    Toggle: A2UIToggleProps;
    Slider: A2UISliderProps;
    DatePicker: A2UIDatePickerProps;

    // Media
    Map: A2UIMapProps;
    AudioPlayer: A2UIAudioPlayerProps;
    VideoPlayer: A2UIVideoPlayerProps;
    Skeleton: A2UISkeletonProps;
};
