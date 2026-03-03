/**
 * IndexedDB-backed storage for Synthesis OS.
 * Provides persistent document storage beyond localStorage limits.
 */

import { SynthesisNode, SpaceId, ConversationMessage, SpaceConversationHistory } from "@/types/synthesis";
import type { AgentTask } from "@/lib/agent/types";

// ── Types ──

export interface SynthesisDocument {
    id: string;
    name: string;
    spaceId: SpaceId;
    nodes: SynthesisNode[];
    conversationHistory: SpaceConversationHistory;
    createdAt: number;
    updatedAt: number;
}

export interface SynthesisDocumentMeta {
    id: string;
    name: string;
    spaceId: SpaceId;
    nodeCount: number;
    createdAt: number;
    updatedAt: number;
}

// ── Constants ──

const DB_NAME = "synthesis-os";
const DB_VERSION = 2;
const STORE_NODES = "nodes";
const STORE_DOCUMENTS = "documents";
const STORE_STATE = "state";
const STORE_TASKS = "tasks";

const CURRENT_STATE_KEY = "current";

/** State key for IndexedDB; when profileId is set, scope by profile */
function getStateKey(profileId: string | null): string {
    return profileId ? `current:${profileId}` : CURRENT_STATE_KEY;
}

// ── Database initialization ──

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(STORE_NODES)) {
                db.createObjectStore(STORE_NODES, { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
                const docStore = db.createObjectStore(STORE_DOCUMENTS, { keyPath: "id" });
                docStore.createIndex("spaceId", "spaceId", { unique: false });
                docStore.createIndex("updatedAt", "updatedAt", { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_STATE)) {
                db.createObjectStore(STORE_STATE);
            }

            if (!db.objectStoreNames.contains(STORE_TASKS)) {
                const taskStore = db.createObjectStore(STORE_TASKS, { keyPath: "id" });
                taskStore.createIndex("nodeId", "nodeId", { unique: false });
                taskStore.createIndex("spaceId", "spaceId", { unique: false });
                taskStore.createIndex("status", "status", { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ── Generic IDB helpers ──

async function idbPut<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const request = key !== undefined ? store.put(value, key) : store.put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

// ── State persistence (replaces localStorage for nodes) ──

export interface PersistedStateIDB {
    activeSpaceId: SpaceId;
    nodes: SynthesisNode[];
    conversationHistory: SpaceConversationHistory;
    osConversationHistory?: ConversationMessage[];
}

export async function saveStateToIDB(state: PersistedStateIDB, profileId?: string | null): Promise<void> {
    await idbPut(STORE_STATE, state, getStateKey(profileId ?? null));
}

export async function loadStateFromIDB(profileId?: string | null): Promise<PersistedStateIDB | undefined> {
    const key = profileId !== undefined ? getStateKey(profileId) : getStateKey(null);
    return idbGet<PersistedStateIDB>(STORE_STATE, key);
}

/** Clear workspace state from IndexedDB (nodes, edges, conversation history). Does not clear tasks. */
export async function clearStateFromIDB(profileId?: string | null): Promise<void> {
    await idbPut(STORE_STATE, {
        activeSpaceId: "work",
        nodes: [],
        conversationHistory: { work: [], entertainment: [], research: [] },
        osConversationHistory: [],
    } as PersistedStateIDB, getStateKey(profileId ?? null));
}

// ── Document management ──

export async function saveDocument(doc: SynthesisDocument): Promise<void> {
    await idbPut(STORE_DOCUMENTS, { ...doc, updatedAt: Date.now() });
}

export async function loadDocument(id: string): Promise<SynthesisDocument | undefined> {
    return idbGet<SynthesisDocument>(STORE_DOCUMENTS, id);
}

export async function deleteDocument(id: string): Promise<void> {
    await idbDelete(STORE_DOCUMENTS, id);
}

export async function listDocuments(): Promise<SynthesisDocumentMeta[]> {
    const docs = await idbGetAll<SynthesisDocument>(STORE_DOCUMENTS);
    return docs
        .map((doc) => ({
            id: doc.id,
            name: doc.name,
            spaceId: doc.spaceId,
            nodeCount: doc.nodes.length,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Agent Task persistence ──

export interface PersistedAgentTask {
    id: string;
    nodeId: string;
    query: string;
    spaceId: SpaceId;
    status: AgentTask["status"];
    steps: AgentTask["steps"];
    config: AgentTask["config"];
    createdAt: number;
    updatedAt: number;
}

export async function saveTask(task: PersistedAgentTask): Promise<void> {
    await idbPut(STORE_TASKS, { ...task, updatedAt: Date.now() });
}

export async function loadTask(id: string): Promise<PersistedAgentTask | undefined> {
    return idbGet<PersistedAgentTask>(STORE_TASKS, id);
}

export async function deleteTask(id: string): Promise<void> {
    await idbDelete(STORE_TASKS, id);
}

export async function listTasks(spaceId?: SpaceId): Promise<PersistedAgentTask[]> {
    const all = await idbGetAll<PersistedAgentTask>(STORE_TASKS);
    const filtered = spaceId ? all.filter((t) => t.spaceId === spaceId) : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadTaskByNodeId(nodeId: string): Promise<PersistedAgentTask | undefined> {
    const all = await idbGetAll<PersistedAgentTask>(STORE_TASKS);
    return all.find((t) => t.nodeId === nodeId);
}

export async function archiveCompletedTasks(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    const all = await idbGetAll<PersistedAgentTask>(STORE_TASKS);
    const cutoff = Date.now() - maxAge;
    let deleted = 0;
    for (const task of all) {
        if ((task.status === "completed" || task.status === "failed" || task.status === "cancelled") && task.updatedAt < cutoff) {
            await idbDelete(STORE_TASKS, task.id);
            deleted++;
        }
    }
    return deleted;
}

/** Delete all agent tasks from IndexedDB. */
export async function clearAllTasksFromIDB(): Promise<void> {
    const all = await idbGetAll<PersistedAgentTask>(STORE_TASKS);
    for (const task of all) {
        await idbDelete(STORE_TASKS, task.id);
    }
}

// ── Utility ──

export function isIndexedDBAvailable(): boolean {
    try {
        return typeof indexedDB !== "undefined";
    } catch {
        return false;
    }
}
