/** Safe area insets (px) so nodes stay inside visible viewport. */
const SAFE_LEFT = 24;
const SAFE_TOP = 88;
const SAFE_RIGHT = 24;
const SAFE_BOTTOM = 100;

/**
 * Clamp a position so a card of size (w, h) stays within the viewport.
 */
export function clampPositionToViewport(
    x: number,
    y: number,
    w: number,
    h: number,
    viewportW: number,
    viewportH: number,
): { x: number; y: number } {
    const maxX = Math.max(0, viewportW - w - SAFE_RIGHT);
    const maxY = Math.max(0, viewportH - h - SAFE_BOTTOM);
    return {
        x: Math.round(Math.max(SAFE_LEFT, Math.min(maxX, x))),
        y: Math.round(Math.max(SAFE_TOP, Math.min(maxY, y))),
    };
}

/**
 * Occupancy-grid positioning for new nodes.
 * If viewport is provided, only returns positions that fit on screen and clamps the result.
 */
export function findNextOpenPosition(
    existingNodes: Array<{
        position: { x: number; y: number };
        dimension: { w: number; h: number };
        status: string;
    }>,
    cardSize: { w: number; h: number },
    cols = 3,
    offsetX = 140,
    offsetY = 70,
    gap = 40,
    viewport?: { w: number; h: number },
): { x: number; y: number } {
    const visible = existingNodes.filter((n) => n.status !== "minimized");
    const occupied = new Set<string>();

    for (const node of visible) {
        const col = Math.round((node.position.x - offsetX) / (cardSize.w + gap));
        const row = Math.round((node.position.y - offsetY) / (cardSize.h + gap));
        if (col >= 0 && row >= 0) {
            occupied.add(`${col},${row}`);
        }
    }

    const maxRows = viewport
        ? Math.max(1, Math.floor((viewport.h - SAFE_TOP - SAFE_BOTTOM - offsetY) / (cardSize.h + gap)))
        : 20;
    const maxCols = viewport
        ? Math.max(1, Math.min(cols, Math.floor((viewport.w - SAFE_LEFT - SAFE_RIGHT - offsetX) / (cardSize.w + gap))))
        : cols;

    for (let row = 0; row < maxRows; row++) {
        for (let col = 0; col < maxCols; col++) {
            if (!occupied.has(`${col},${row}`)) {
                const x = offsetX + col * (cardSize.w + gap);
                const y = offsetY + row * (cardSize.h + gap);
                if (viewport) {
                    return clampPositionToViewport(x, y, cardSize.w, cardSize.h, viewport.w, viewport.h);
                }
                return { x, y };
            }
        }
    }

    const x = offsetX;
    const y = offsetY + visible.length * (cardSize.h + gap);
    if (viewport) {
        return clampPositionToViewport(x, y, cardSize.w, cardSize.h, viewport.w, viewport.h);
    }
    return { x, y };
}
