/**
 * Simple LRU cache for API predictions.
 * Keys are prefix hashes, values include timestamp for TTL.
 */

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

export class PredictionCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;
    private ttlMs: number;

    constructor(maxSize: number = 100, ttlMs: number = 2000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        
        if (!entry) {
            return undefined;
        }
        
        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }
        
        // Move to end (LRU)
        this.cache.delete(key);
        this.cache.set(key, entry);
        
        return entry.value;
    }

    set(key: string, value: T): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * Simple hash function for strings.
 * Used to create cache keys from code prefixes.
 */
export function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}

/**
 * Create a cache key from feature type and prefix.
 */
export function makeCacheKey(feature: string, prefix: string): string {
    return `${feature}:${hashString(prefix)}`;
}
