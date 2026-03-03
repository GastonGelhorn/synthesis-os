/**
 * Maps A2UI component definitions to SynthesisOS flat block format.
 * Used by the A2UI renderer to produce blocks compatible with renderBlock.
 */

import type { A2UIComponentDef, BoundValue } from "./types";
import type { UIBlock } from "@/types/synthesis";

function resolveBoundValue(val: unknown, dataModel: Record<string, unknown>): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val !== "object") return String(val);
  const bv = val as BoundValue;
  if (bv.literalString !== undefined) return String(bv.literalString);
  if (bv.literalNumber !== undefined) return String(bv.literalNumber);
  if (bv.literalBoolean !== undefined) return String(bv.literalBoolean);
  if (bv.path) {
    const parts = bv.path.replace(/^\//, "").split("/");
    let cur: unknown = dataModel;
    for (const p of parts) {
      if (cur != null && typeof cur === "object" && p in cur) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return cur != null ? String(cur) : "";
  }
  return "";
}

function resolveBoundValueOptional(val: unknown, dataModel: Record<string, unknown>): string | undefined {
  const s = resolveBoundValue(val, dataModel);
  return s.trim() || undefined;
}

/** Convert A2UI component definition to SynthesisOS UIBlock format */
export function a2uiComponentToBlock(
  comp: A2UIComponentDef,
  dataModel: Record<string, unknown> = {},
): UIBlock | null {
  if (!comp || !comp.component) return null;
  const entries = Object.entries(comp.component);
  if (entries.length === 0) return null;
  const [typeName, props] = entries[0];
  const p = (props || {}) as Record<string, unknown>;

  switch (typeName) {
    case "Text":
    case "TextBlock": {
      const content = resolveBoundValue(p.content ?? p.text, dataModel);
      const rawStyle = (p.style ?? p.variant ?? p.usageHint) as string | undefined;
      let style = (rawStyle || "body").toLowerCase();
      if (!content) return null;
      const styleMap: Record<string, string> = {
        title: "h1", subtitle: "h2", heading: "h1", heading1: "h1", heading2: "h2",
        h3: "body", h4: "body", h5: "body",
      };
      style = styleMap[style] ?? (["h1", "h2", "body", "caption", "quote", "none"].includes(style) ? style : "body");
      return {
        type: "text_block",
        content,
        style: style as "h1" | "h2" | "body" | "caption" | "quote" | "none",
      };
    }
    case "DataGrid": {
      const items = (p.items || []) as Array<Record<string, unknown>>;
      return {
        type: "data_grid",
        items: items.map(it => {
          if (!it || typeof it !== "object") return { label: "", value: "" };
          const resolved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
            resolved[k] = resolveBoundValue(v, dataModel);
          }
          return {
            label: String(resolved.label || ""),
            value: String(resolved.value || ""),
            icon: typeof resolved.icon === "string" ? resolved.icon : undefined,
          };
        }),
      };
    }
    case "ActionRow": {
      const actions = (p.actions || []) as Array<Record<string, unknown>>;
      return {
        type: "action_row",
        actions: actions.map(a => ({
          label: String(resolveBoundValue(a.label, dataModel) || "Action"),
          intent: String(resolveBoundValue(a.intent, dataModel) || "none"),
          primary: !!(Boolean(a.primary) === true || String(a.primary) === "true" || Boolean(resolveBoundValue(a.primary, dataModel)) === true || String(resolveBoundValue(a.primary, dataModel)).toLowerCase() === "true"),
        })),
      };
    }
    case "Image":
    case "HeroImage": {
      const url = resolveBoundValue(p.url, dataModel);
      if (!url?.trim()) return null;
      return {
        type: "hero_image",
        url,
        caption: resolveBoundValue(p.caption, dataModel) ?? null,
      };
    }
    case "ImageGallery": {
      const images = (p.images || []) as Array<Record<string, unknown>>;
      return {
        type: "image_gallery",
        images: images.map(img => ({
          url: resolveBoundValue(img.url, dataModel) || "",
          caption: resolveBoundValue(img.caption, dataModel),
        })),
      };
    }
    case "ListBlock": {
      const items = (p.items || []) as Array<unknown>;
      const rawOrdered = resolveBoundValue(p.ordered, dataModel);
      const ordered = Boolean(p.ordered) === true || String(p.ordered) === "true" || Boolean(rawOrdered) === true || String(rawOrdered).toLowerCase() === "true";
      return {
        type: "list_block",
        ordered,
        items: items.map(it => {
          if (typeof it === "string") return { text: it };
          if (!it || typeof it !== "object") return { text: "" };
          const obj = it as Record<string, unknown>;
          return {
            text: resolveBoundValue(obj.text || obj.label, dataModel) || "",
            icon: resolveBoundValue(obj.icon, dataModel),
          };
        }),
      };
    }
    case "CodeBlock": {
      const code = resolveBoundValue(p.code, dataModel) || "";
      const language = resolveBoundValue(p.language, dataModel) || "plaintext";
      return {
        type: "code_block",
        code,
        language,
      };
    }
    case "ProgressBar": {
      const items = (p.items || []) as Array<Record<string, unknown>>;
      return {
        type: "progress_bar",
        items: items.map(it => ({
          label: resolveBoundValue(it.label, dataModel) || "",
          value: Number(resolveBoundValue(it.value, dataModel) || 0),
          color: resolveBoundValue(it.color, dataModel),
        })),
      };
    }
    case "StatsRow": {
      const stats = (p.stats || []) as Array<Record<string, unknown>>;
      return {
        type: "stats_row",
        stats: stats.map(s => ({
          label: resolveBoundValue(s.label, dataModel) || "",
          value: resolveBoundValue(s.value, dataModel) || "",
          trend: resolveBoundValue(s.trend, dataModel) as "up" | "down" | "neutral" | undefined,
        })),
      };
    }
    case "LinkPreview": {
      const url = resolveBoundValue(p.url, dataModel);
      if (!url?.trim()) return null;
      return {
        type: "link_preview",
        url: url,
        title: resolveBoundValue(p.title, dataModel) || url,
        description: resolveBoundValue(p.description, dataModel),
      };
    }
    case "Divider":
    case "Separator": {
      return {
        type: "separator",
        label: resolveBoundValue(p.label ?? p.content, dataModel) || undefined,
      };
    }
    case "Callout": {
      const content = resolveBoundValue(p.content, dataModel);
      if (!content?.trim()) return null;
      return {
        type: "callout",
        content,
        variant: (resolveBoundValue(p.variant, dataModel) || "info") as "info" | "warning" | "success" | "error",
        title: resolveBoundValue(p.title, dataModel),
      };
    }
    case "TableBlock": {
      const headers = (p.headers || []) as Array<unknown>;
      const rows = (p.rows || []) as Array<Array<unknown>>;
      return {
        type: "table_block",
        headers: headers.map(h => resolveBoundValue(h, dataModel) || ""),
        rows: rows.map(row => row.map(cell => resolveBoundValue(cell, dataModel) || "")),
      };
    }
    case "CanvasBlock": {
      const items = (p.items || []) as Array<Record<string, unknown>>;
      return {
        type: "canvas_block",
        title: resolveBoundValue(p.title, dataModel) || "",
        canvas_type: (resolveBoundValue(p.canvas_type || p.canvasType, dataModel) || "bar") as "bar" | "line",
        items: items.map(it => ({
          label: resolveBoundValue(it.label, dataModel) || "",
          value: String(resolveBoundValue(it.value, dataModel) || 0),
          color: resolveBoundValue(it.color, dataModel),
        })),
      };
    }
    case "Column":
      return null;
    default:
      return null;
  }
}
