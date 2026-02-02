"use strict";
/**
 * Simple LRU cache for API predictions.
 * Keys are prefix hashes, values include timestamp for TTL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictionCache = void 0;
exports.hashString = hashString;
exports.makeCacheKey = makeCacheKey;
class PredictionCache {
    constructor(maxSize = 100, ttlMs = 2000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }
    get(key) {
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
    set(key, value) {
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
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
exports.PredictionCache = PredictionCache;
/**
 * Simple hash function for strings.
 * Used to create cache keys from code prefixes.
 */
function hashString(str) {
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
function makeCacheKey(feature, prefix) {
    return `${feature}:${hashString(prefix)}`;
}
