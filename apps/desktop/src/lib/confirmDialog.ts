/**
 * Confirm dialog that uses Tauri's native dialog when in Tauri context,
 * falling back to window.confirm when running in browser.
 * Tauri's native dialog is more reliable in the desktop webview.
 */
export async function confirmDialog(message: string, title = "Confirm"): Promise<boolean> {
    try {
        const { confirm } = await import("@tauri-apps/plugin-dialog");
        return await confirm(message, { title, kind: "warning" });
    } catch {
        return typeof window !== "undefined" && window.confirm(message);
    }
}
