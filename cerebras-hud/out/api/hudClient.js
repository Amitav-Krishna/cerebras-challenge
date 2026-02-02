"use strict";
/**
 * API client for HUD features (entropy, ghost, autopanic, saliency).
 *
 * Uses caching and debouncing for performance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchEntropy = fetchEntropy;
exports.fetchGhost = fetchGhost;
exports.fetchAutopanic = fetchAutopanic;
exports.fetchSaliency = fetchSaliency;
exports.clearCaches = clearCaches;
const cache_1 = require("../utils/cache");
const API_BASE_URL = 'http://localhost:8000';
// Caches for each feature
const entropyCache = new cache_1.PredictionCache(50, 1500);
const ghostCache = new cache_1.PredictionCache(50, 1000);
const autopanicCache = new cache_1.PredictionCache(30, 800);
const saliencyCache = new cache_1.PredictionCache(10, 5000);
/**
 * Fetch entropy for a cursor position.
 */
async function fetchEntropy(code, uri, cursorLine, cursorChar) {
    // Build prefix up to cursor
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    const cacheKey = (0, cache_1.makeCacheKey)('entropy', prefix);
    const cached = entropyCache.get(cacheKey);
    if (cached)
        return cached;
    try {
        const response = await fetch(`${API_BASE_URL}/entropy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        entropyCache.set(cacheKey, data);
        return data;
    }
    catch (err) {
        console.error('Failed to fetch entropy:', err);
        return null;
    }
}
/**
 * Fetch ghost token suggestion.
 */
async function fetchGhost(code, uri, cursorLine, cursorChar) {
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    const cacheKey = (0, cache_1.makeCacheKey)('ghost', prefix);
    const cached = ghostCache.get(cacheKey);
    if (cached)
        return cached;
    try {
        const response = await fetch(`${API_BASE_URL}/ghost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        ghostCache.set(cacheKey, data);
        return data;
    }
    catch (err) {
        console.error('Failed to fetch ghost:', err);
        return null;
    }
}
/**
 * Fetch autopanic detection.
 */
async function fetchAutopanic(code, uri, cursorLine, cursorChar) {
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    const cacheKey = (0, cache_1.makeCacheKey)('autopanic', prefix);
    const cached = autopanicCache.get(cacheKey);
    if (cached)
        return cached;
    try {
        const response = await fetch(`${API_BASE_URL}/autopanic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        autopanicCache.set(cacheKey, data);
        return data;
    }
    catch (err) {
        console.error('Failed to fetch autopanic:', err);
        return null;
    }
}
/**
 * Fetch saliency analysis (expensive, use sparingly).
 */
async function fetchSaliency(code, uri, cursorLine, cursorChar) {
    const cacheKey = (0, cache_1.makeCacheKey)('saliency', `${uri}:${cursorLine}:${cursorChar}`);
    const cached = saliencyCache.get(cacheKey);
    if (cached)
        return cached;
    try {
        const response = await fetch(`${API_BASE_URL}/saliency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, uri, cursorLine, cursorChar })
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        saliencyCache.set(cacheKey, data);
        return data;
    }
    catch (err) {
        console.error('Failed to fetch saliency:', err);
        return null;
    }
}
/**
 * Build prefix string up to cursor position.
 */
function buildPrefix(lines, cursorLine, cursorChar) {
    const targetLine = cursorLine - 1; // 0-indexed
    if (targetLine < 0)
        return '';
    if (targetLine >= lines.length)
        return lines.join('\n');
    const beforeCursor = lines[targetLine].substring(0, cursorChar);
    const prefixLines = lines.slice(0, targetLine);
    prefixLines.push(beforeCursor);
    return prefixLines.join('\n');
}
/**
 * Clear all caches.
 */
function clearCaches() {
    entropyCache.clear();
    ghostCache.clear();
    autopanicCache.clear();
    saliencyCache.clear();
}
