/**
 * A2UI protocol types for SynthesisOS.
 * A2UI v0.8: https://a2ui.org/specification/v0.8-a2ui/
 * JSONL stream: surfaceUpdate, dataModelUpdate, beginRendering, deleteSurface.
 */

export const SYNTHESIS_CATALOG_ID = "https://synthesisos.dev/a2ui/synthesis-catalog/v1";

/** BoundValue: literal string or data path */
export interface BoundValue {
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
  path?: string;
}

/** A2UI component instance in surfaceUpdate */
export interface A2UIComponentDef {
  id: string;
  component: Record<string, unknown>;
}

/** surfaceUpdate message */
export interface SurfaceUpdateMessage {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponentDef[];
  };
}

/** dataModelUpdate message */
export interface DataModelUpdateMessage {
  dataModelUpdate: {
    surfaceId?: string;
    path?: string;
    contents?: Array<{ key: string } & ({ valueString?: string } | { valueNumber?: number } | { valueBoolean?: boolean } | { valueMap?: unknown[] })>;
    valueMap?: unknown;
  };
}

/** beginRendering message */
export interface BeginRenderingMessage {
  beginRendering: {
    surfaceId?: string;
    catalogId?: string;
    root: string;
  };
}

/** deleteSurface message */
export interface DeleteSurfaceMessage {
  deleteSurface: {
    surfaceId: string;
  };
}

/** Shorthand 'surfaceUpdate' message: {"surfaceUpdate": {"id": "...", "Type": ...}} */
export interface ShorthandUpdateMessage {
  surfaceUpdate: Record<string, unknown> & { id: string };
  surfaceId?: string;
}

export type A2UIMessage =
  | SurfaceUpdateMessage
  | DataModelUpdateMessage
  | BeginRenderingMessage
  | DeleteSurfaceMessage
  | ShorthandUpdateMessage;

export function isSurfaceUpdate(msg: unknown): msg is SurfaceUpdateMessage {
  return typeof msg === "object" && msg !== null && "surfaceUpdate" in msg && Array.isArray((msg as any).surfaceUpdate?.components);
}

export function isDataModelUpdate(msg: unknown): msg is DataModelUpdateMessage {
  return typeof msg === "object" && msg !== null && "dataModelUpdate" in msg;
}

export function isBeginRendering(msg: unknown): msg is BeginRenderingMessage {
  return typeof msg === "object" && msg !== null && "beginRendering" in msg;
}

export function isDeleteSurface(msg: unknown): msg is DeleteSurfaceMessage {
  return typeof msg === "object" && msg !== null && "deleteSurface" in msg;
}

export function isShorthandUpdate(msg: unknown): msg is ShorthandUpdateMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "surfaceUpdate" in msg &&
    typeof (msg as any).surfaceUpdate === "object" &&
    (msg as any).surfaceUpdate !== null &&
    "id" in (msg as any).surfaceUpdate
  );
}

export function isA2UIMessage(msg: unknown): msg is A2UIMessage {
  return isSurfaceUpdate(msg) || isDataModelUpdate(msg) || isBeginRendering(msg) || isDeleteSurface(msg) || isShorthandUpdate(msg);
}

/**
 * Normalizes a shorthand component definition to a standard A2UI structure.
 * Standard: { id: "...", component: { "Type": { ... } } }
 * Shorthand: { id: "...", "Type": { ... } } or { id: "...", "Type": "content" }
 */
export function normalizeShorthandComponent(raw: Record<string, unknown>): A2UIComponentDef | null {
  if (!raw.id || typeof raw.id !== "string") return null;
  const id = raw.id;
  let component: Record<string, unknown> = {};

  if (raw.component && typeof raw.component === "object" && !Array.isArray(raw.component)) {
    component = raw.component as Record<string, unknown>;
  } else {
    // Look for recognized component types directly at the root
    const commonTypes = [
      "Text", "Image", "ListBlock", "Callout", "CodeBlock", "DataGrid", "ActionRow",
      "ImageGallery", "Column", "ProgressBar", "StatsRow", "LinkPreview", "Separator",
      "TableBlock", "CanvasBlock",
      "Tabs", "Accordion", "Carousel", "Timeline", "BadgeSet",
      "Input", "Select", "Toggle", "Slider", "DatePicker",
      "Map", "AudioPlayer", "VideoPlayer", "Skeleton", "Markdown"
    ];
    const type = Object.keys(raw).find(k => commonTypes.includes(k));
    if (type) {
      let props = raw[type];
      // If props is a string, wrap it in a standard object (e.g. { text: props })
      if (typeof props === "string") {
        if (type === "Text") props = { text: props };
        else if (type === "Callout") props = { content: props };
        else if (type === "CodeBlock") props = { code: props };
      }
      component = { [type]: props };
    }
  }

  if (Object.keys(component).length === 0) return null;

  const res: A2UIComponentDef = { id, component };
  // Copy over extra fields like usageHint, variant, etc.

  const knownTypes = [
    "Text", "Image", "ListBlock", "Callout", "CodeBlock", "DataGrid", "ActionRow",
    "ImageGallery", "Column", "ProgressBar", "StatsRow", "LinkPreview", "Separator",
    "TableBlock", "CanvasBlock",
    "Tabs", "Accordion", "Carousel", "Timeline", "BadgeSet",
    "Input", "Select", "Toggle", "Slider", "DatePicker",
    "Map", "AudioPlayer", "VideoPlayer", "Skeleton", "Markdown"
  ];

  for (const [k, v] of Object.entries(raw)) {
    if (k !== "id" && k !== "component" && !knownTypes.includes(k)) {
      (res as any)[k] = v;
    }
  }

  return res;
}
