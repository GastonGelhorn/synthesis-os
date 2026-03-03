/**
 * PIN hashing for profile unlock.
 * Uses PBKDF2 with SHA-256. Salt is randomly generated per profile.
 * Format stored: base64(salt):base64(hash)
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 32;

function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export async function hashPin(pin: string, salt?: Uint8Array): Promise<string> {
    const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
    const saltCopy = new Uint8Array(s);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(pin),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltCopy,
            iterations: ITERATIONS,
            hash: "SHA-256",
        },
        key,
        KEY_LENGTH * 8,
    );
    const hashB64 = arrayBufferToBase64(bits as ArrayBuffer);
    const saltB64 = arrayBufferToBase64(saltCopy.buffer.slice(0));
    return `${saltB64}:${hashB64}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
    const [saltB64, hashB64] = stored.split(":");
    if (!saltB64 || !hashB64) return false;
    const salt = new Uint8Array(base64ToArrayBuffer(saltB64) as ArrayBuffer);
    const computed = await hashPin(pin, salt);
    return computed === stored;
}
