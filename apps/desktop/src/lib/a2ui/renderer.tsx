"use client";

import React, { useCallback, useReducer } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    A2UIText,
    A2UIActionRow,
    A2UICallout,
    A2UICanvas,
    A2UICodeBlock,
    A2UIDataGrid,
    A2UIImage,
    A2UIImageGallery,
    A2UILinkPreview,
    A2UIList,
    A2UIProgressBar,
    A2UISeparator,
    A2UIStatsRow,
    A2UITable,
    A2UITabs,
    A2UIAccordion,
    A2UICarousel,
    A2UITimeline,
    A2UIBadgeSet,
    A2UIInput,
    A2UISelect,
    A2UIToggle,
    A2UISlider,
    A2UIDatePicker,
    A2UIMap,
    A2UIAudioPlayer,
    A2UIVideoPlayer,
    A2UISkeleton,
    A2UIMarkdown,
} from "@/components/a2ui-components";
import {
    isSurfaceUpdate,
    isDataModelUpdate,
    isBeginRendering,
    isDeleteSurface,
    isShorthandUpdate,
    normalizeShorthandComponent,
    isA2UIMessage,
    A2UIComponentDef,
    A2UIMessage
} from "./types";
import { a2uiComponentToBlock } from "./componentMap";
import type { UIBlock } from "@/types/synthesis";

export interface A2UIState {
    componentMap: Record<string, Record<string, A2UIComponentDef>>;
    dataModel: Record<string, Record<string, unknown>>;
    rootId: string | null;
    surfaceId: string | null;
    catalogId: string | null;
}

const initialState: A2UIState = {
    componentMap: {},
    dataModel: {},
    rootId: null,
    surfaceId: null,
    catalogId: null,
};

type A2UIAction =
    | { type: "apply"; message: A2UIMessage }
    | { type: "reset" };

function applyDataModelUpdate(
    dataModel: Record<string, Record<string, unknown>>,
    surfaceId: string,
    path: string | undefined,
    contents: Array<{ key: string } & Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
    const next = { ...dataModel };
    const base = next[surfaceId] || {};
    if (!contents?.length) return next;

    let target: Record<string, unknown> = base;
    if (path) {
        const parts = path.replace(/^\//, "").split("/");
        for (const p of parts) {
            let child = target[p] as Record<string, unknown> | undefined;
            if (!child || typeof child !== "object") child = {};
            target[p] = child;
            target = child as Record<string, unknown>;
        }
    }
    for (const entry of contents) {
        const key = entry.key;
        const val = "valueString" in entry ? entry.valueString : "valueNumber" in entry ? entry.valueNumber : "valueBoolean" in entry ? entry.valueBoolean : entry.valueMap;
        target[key] = val;
    }
    next[surfaceId] = base;
    return next;
}

function reducer(state: A2UIState, action: A2UIAction): A2UIState {
    switch (action.type) {
        case "reset":
            return initialState;
        case "apply": {
            const msg = action.message;
            if (isSurfaceUpdate(msg)) {
                const { surfaceId: sid, components } = msg.surfaceUpdate;
                const nextMap = { ...state.componentMap };
                const existing = nextMap[sid] || {};
                const merged = { ...existing };
                for (const c of components) {
                    const normalized = normalizeShorthandComponent(c as any);
                    if (normalized) merged[normalized.id] = normalized;
                }
                nextMap[sid] = merged;
                return { ...state, componentMap: nextMap };
            }
            if (isShorthandUpdate(msg)) {
                const sid = msg.surfaceId ?? (msg.surfaceUpdate as any).surfaceId ?? state.surfaceId ?? "default";
                const nextMap = { ...state.componentMap };
                const existing = nextMap[sid] || {};
                const normalized = normalizeShorthandComponent(msg.surfaceUpdate);
                if (normalized) {
                    nextMap[sid] = { ...existing, [normalized.id]: normalized };
                }
                return { ...state, componentMap: nextMap };
            }
            if (isDataModelUpdate(msg)) {
                const dm = msg.dataModelUpdate;
                const sid = dm.surfaceId ?? state.surfaceId ?? "default";
                const nextData = applyDataModelUpdate(
                    state.dataModel,
                    sid,
                    dm.path,
                    dm.contents,
                );
                return { ...state, dataModel: nextData };
            }
            if (isBeginRendering(msg)) {
                const br = msg.beginRendering;
                const rootId = br.root;
                const surfaceId = br.surfaceId ?? state.surfaceId ?? "default";
                const catalogId = br.catalogId ?? state.catalogId ?? null;
                return {
                    ...state,
                    rootId,
                    surfaceId,
                    catalogId,
                };
            }
            if (isDeleteSurface(msg)) {
                const { surfaceId: sid } = msg.deleteSurface;
                const nextMap = { ...state.componentMap };
                delete nextMap[sid];
                const nextData = { ...state.dataModel };
                delete nextData[sid];
                const clearedRoot = state.surfaceId === sid ? null : state.rootId;
                const clearedSurface = state.surfaceId === sid ? null : state.surfaceId;
                return {
                    ...state,
                    componentMap: nextMap,
                    dataModel: nextData,
                    rootId: clearedRoot,
                    surfaceId: clearedSurface,
                };
            }
            return state;
        }
        default:
            return state;
    }
}

/** Convert surfaceUpdate payload to flat UIBlocks. Used when agent-response contains A2UI format. */
export function blocksFromSurfaceUpdate(
    surfaceUpdate: { surfaceId?: string; components?: Array<{ id: string; component: Record<string, unknown> }> },
    rootId: string = "root",
): import("@/types/synthesis").UIBlock[] {
    const components = surfaceUpdate?.components ?? [];
    const componentMap: Record<string, A2UIComponentDef> = {};
    for (const c of components) {
        const normalized = normalizeShorthandComponent(c as any);
        if (normalized) {
            componentMap[normalized.id] = normalized;
        }
    }
    return collectBlocks(rootId, componentMap, {});
}

/** Collect blocks in display order from root (Column with explicitList children) */
function collectBlocks(
    rootId: string,
    componentMap: Record<string, A2UIComponentDef>,
    dataModel: Record<string, unknown>,
): UIBlock[] {
    const blocks: UIBlock[] = [];
    const comp = componentMap[rootId];
    if (!comp || !comp.component) return blocks;
    const entries = Object.entries(comp.component);
    if (entries.length === 0) return blocks;
    const [typeName, props] = entries[0];
    const p = (props || {}) as Record<string, unknown>;

    if (typeName === "Column" || typeName === "Row") {
        const children = (p.children as { explicitList?: string[] })?.explicitList;
        if (!Array.isArray(children)) return blocks;
        for (const childId of children) {
            if (!childId) continue;
            blocks.push(...collectBlocks(childId, componentMap, dataModel));
        }
    } else {
        const block = a2uiComponentToBlock(comp, dataModel);
        if (block) blocks.push(block);
    }
    return blocks;
}

export function renderBlock(rawBlock: UIBlock | Record<string, unknown>, idx: number, isLight: boolean, accentColor?: string): React.ReactNode {
    let block = rawBlock as UIBlock;

    // Convert A2UI shorthand like {"Text": "..."} to standard UIBlock parsing
    if (!block.type) {
        const normalized = normalizeShorthandComponent(rawBlock as Record<string, unknown>);
        if (normalized) {
            const converted = a2uiComponentToBlock(normalized, {});
            if (converted) block = converted;
        }
    }

    const b = block as unknown as Record<string, unknown>;
    const id = (b.id as string) || `a2ui-block-${idx}`;
    switch (block.type) {
        case "hero_image":
            if (!(b.url as string)?.trim()) return null;
            return <A2UIImage id={id} url={b.url as string} caption={b.caption as string} isLight={isLight} aspectRatio="auto" />;
        case "image_gallery":
            if (!Array.isArray(b.images) || (b.images as unknown[]).length === 0) return null;
            return <A2UIImageGallery id={id} images={b.images as { url: string; caption?: string }[]} isLight={isLight} />;
        case "text_block":
            return <A2UIText id={id} content={(b.content as string) || ""} style={(b.style as any) || "body"} isLight={isLight} />;
        case "data_grid":
            if (!Array.isArray(b.items) || (b.items as unknown[]).length === 0) return null;
            return <A2UIDataGrid id={id} items={b.items as { label: string; value: string; icon?: string }[]} isLight={isLight} />;
        case "action_row":
            if (!Array.isArray(b.actions) || (b.actions as unknown[]).length === 0) return null;
            return <A2UIActionRow id={id} actions={b.actions as { label: string; intent: string; primary?: boolean }[]} isLight={isLight} />;
        case "list_block": {
            const items = (b.items as Array<{ text?: string; label?: string; icon?: string }>) || [];
            const listItems = items.map((it) => ({
                text: typeof it === "string" ? it : (it?.text ?? it?.label ?? ""),
                icon: (it as { icon?: string })?.icon,
            })).filter((it) => it.text);
            if (listItems.length === 0) return null;
            return <A2UIList id={id} items={listItems} ordered={!!b.ordered} isLight={isLight} />;
        }
        case "code_block":
            if (!(b.code as string)?.trim()) return null;
            return <A2UICodeBlock id={id} code={b.code as string} language={b.language as string} isLight={isLight} />;
        case "progress_bar": {
            const progItems = ((b.items as Array<{ label?: string; value?: number; color?: string }>) || []).map((it) => ({
                label: it?.label ?? "",
                value: typeof it?.value === "number" ? it.value : parseInt(String(it?.value), 10) || 0,
                color: it?.color,
            })).filter((it) => it.label);
            if (progItems.length === 0) return null;
            return (
                <div key={id} className="flex flex-col gap-2">
                    {progItems.map((pi, piIdx) => (
                        <A2UIProgressBar key={piIdx} id={`${id}-${piIdx}`} label={pi.label} value={pi.value} color={pi.color} accentColor={accentColor} isLight={isLight} />
                    ))}
                </div>
            );
        }
        case "stats_row":
            if (!Array.isArray(b.stats) || (b.stats as unknown[]).length === 0) return null;
            return <A2UIStatsRow id={id} stats={b.stats as { label: string; value: string; trend?: "up" | "down" | "neutral" }[]} isLight={isLight} />;
        case "link_preview":
            if (!(b.url as string)?.trim()) return null;
            return (
                <A2UILinkPreview
                    id={id}
                    url={b.url as string}
                    title={(b.title as string) || (b.url as string)}
                    description={b.description as string}
                    isLight={isLight}
                />
            );
        case "separator":
            return <A2UISeparator id={id} label={(b.label ?? b.content) as string} isLight={isLight} />;
        case "callout":
            if (!(b.content as string)?.trim()) return null;
            return (
                <A2UICallout
                    id={id}
                    content={b.content as string}
                    variant={(b.variant as any) || "info"}
                    title={b.title as string}
                    isLight={isLight}
                />
            );
        case "table_block":
            if (!Array.isArray(b.headers) || !Array.isArray(b.rows)) return null;
            return <A2UITable id={id} headers={b.headers as string[]} rows={b.rows as string[][]} isLight={isLight} />;
        case "canvas_block": {
            const points = ((b.items as Array<{ label?: string; value?: number; color?: string }>) || [])
                .map((it) => ({
                    label: String(it?.label ?? ""),
                    value: Number(it?.value ?? 0),
                    color: typeof it?.color === "string" ? it.color : undefined,
                }))
                .filter((p) => p.label && Number.isFinite(p.value));
            if (points.length === 0) return null;
            return (
                <A2UICanvas
                    id={id}
                    title={b.title as string}
                    points={points}
                    canvasType={(b.canvas_type as "bar" | "line") ?? "bar"}
                    accentColor={accentColor}
                    isLight={isLight}
                />
            );
        }
        case "tabs_block":
            if (!Array.isArray(b.tabs) || b.tabs.length === 0) return null;
            return <A2UITabs id={id} tabs={b.tabs as any} activeTabId={b.activeTabId as string} isLight={isLight} />;
        case "accordion_block":
            return <A2UIAccordion id={id} title={b.title as string} icon={b.icon as string} defaultExpanded={b.defaultExpanded as boolean} isLight={isLight} />;
        case "carousel_block":
            return <A2UICarousel id={id} isLight={isLight} autoPlay={b.autoPlay as boolean} />;
        case "timeline_block":
            if (!Array.isArray(b.events) || b.events.length === 0) return null;
            return <A2UITimeline id={id} events={b.events as any} isLight={isLight} accentColor={accentColor} />;
        case "badge_set":
            if (!Array.isArray(b.badges) || b.badges.length === 0) return null;
            return <A2UIBadgeSet id={id} badges={b.badges as any} isLight={isLight} />;
        case "input_block":
            return <A2UIInput id={id} value={b.value as string} placeholder={b.placeholder as string} type={b.inputType as any} label={b.label as string} isLight={isLight} />;
        case "select_block":
            if (!Array.isArray(b.options) || b.options.length === 0) return null;
            return <A2UISelect id={id} value={b.value as string} options={b.options as any} label={b.label as string} isLight={isLight} />;
        case "toggle_block":
            return <A2UIToggle id={id} checked={b.checked as boolean} label={b.label as string} isLight={isLight} accentColor={accentColor} />;
        case "slider_block":
            return <A2UISlider id={id} value={typeof b.value === 'number' ? b.value : Number(b.value || 0)} min={b.min as number} max={b.max as number} step={b.step as number} label={b.label as string} isLight={isLight} accentColor={accentColor} />;
        case "datepicker_block":
            return <A2UIDatePicker id={id} date={b.date as string} label={b.label as string} isLight={isLight} />;
        case "map_block":
            return <A2UIMap id={id} latitude={b.latitude as number} longitude={b.longitude as number} zoom={b.zoom as number} markers={b.markers as any} isLight={isLight} />;
        case "audio_player":
            if (!b.url) return null;
            return <A2UIAudioPlayer id={id} url={b.url as string} title={b.title as string} artist={b.artist as string} autoPlay={b.autoPlay as boolean} isLight={isLight} accentColor={accentColor} />;
        case "video_player":
            if (!b.url) return null;
            return <A2UIVideoPlayer id={id} url={b.url as string} title={b.title as string} autoPlay={b.autoPlay as boolean} isLight={isLight} />;
        case "skeleton_block":
            return <A2UISkeleton id={id} type={b.skeletonType as any} lines={b.lines as number} isLight={isLight} />;
        case "markdown_block":
            if (!b.content) return null;
            return <A2UIMarkdown id={id} content={b.content as string} isLight={isLight} />;
        default:
            return null;
    }
}

/** Returns false for blocks that should be hidden (redundant set_volume OK, raw Feed dump) */
export function defaultBlockFilter(block: UIBlock | Record<string, unknown>): boolean {
    const b = block as Record<string, unknown>;
    const type = b.type as string;
    const content = String(b.content ?? "").trim();
    const title = String(b.title ?? "").trim().toLowerCase();
    if (type === "callout" && content) {
        if (content === "OK" && (title === "set_volume" || b._toolName === "set_volume")) return false;
        if (/^Feed \(\d+ entries\):/.test(content)) return false;
    }
    if (type === "text_block" && content) {
        if (/^Feed \(\d+ entries\):/.test(content)) return false;
    }
    return true;
}

export interface A2UIRendererProps {
    state: A2UIState;
    isLight?: boolean;
    accentColor?: string;
    compact?: boolean;
    /** Return false to hide a block. Uses defaultBlockFilter when not provided. */
    blockFilter?: (block: UIBlock) => boolean;
}

export function A2UIRenderer({ state, isLight = false, accentColor, compact, blockFilter = defaultBlockFilter }: A2UIRendererProps) {
    const { rootId, surfaceId, componentMap, dataModel } = state;
    if (!surfaceId) return null;

    const map = componentMap[surfaceId];
    const model = dataModel[surfaceId] ?? {};
    if (!map) return null;

    let blocks = collectBlocks(rootId || "root", map, model);
    if (blocks.length === 0) {
        for (const compId of Object.keys(map)) {
            if (compId === rootId) continue;
            const b = a2uiComponentToBlock(map[compId], model);
            if (b) blocks.push(b);
        }
    }

    blocks = blocks.filter(blockFilter);
    if (blocks.length === 0) return null;

    return (
        <AnimatePresence mode="popLayout">
            {blocks.map((block, idx) => {
                const content = renderBlock(block, idx, isLight, accentColor);
                if (!content) return null;
                return (
                    <motion.div
                        key={`a2ui-block-${idx}`}
                        initial={{ opacity: 0, y: 12, filter: "blur(3px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                        layout
                        className={compact ? "" : ""}
                    >
                        {content}
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );
}

/** Apply an A2UI message to state and return the new state (for use outside the hook) */
export function applyA2UIMessage(state: A2UIState, msg: unknown): A2UIState {
    if (isA2UIMessage(msg)) {
        return reducer(state, { type: "apply", message: msg as any });
    }
    return state;
}

export function useA2UIState() {
    const [state, dispatch] = useReducer(reducer, initialState);

    const applyMessage = useCallback((msg: unknown) => {
        if (isA2UIMessage(msg)) {
            dispatch({ type: "apply", message: msg as any });
        }
    }, []);

    const reset = useCallback(() => {
        dispatch({ type: "reset" });
    }, []);

    const hasContent = state.rootId != null && state.surfaceId != null;

    return { state, applyMessage, reset, hasContent };
}
