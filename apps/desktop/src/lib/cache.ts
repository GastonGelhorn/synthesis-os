/**
 * Simple LRU cache with TTL expiration.
 * Used server-side to avoid re-scraping and re-generating for identical queries.
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();

    constructor(
        private maxSize: number,
        private ttlMs: number,
    ) {}

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        // Move to end (most recently used) by re-inserting
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }

    set(key: string, data: T): void {
        // Evict oldest entry if at capacity
        if (this.cache.size >= this.maxSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
    }

    has(key: string): boolean {
        return this.get(key) !== null;
    }

    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
    }
}
