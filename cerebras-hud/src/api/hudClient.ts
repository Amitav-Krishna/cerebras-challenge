/**
 * API client for HUD features (entropy, ghost, autopanic, saliency).
 * 
 * Uses caching and debouncing for performance.
 */

import { EntropyResponse, GhostResponse, AutopanicResponse, SaliencyResponse, CursorRequest } from '../types/hud';
import { PredictionCache, makeCacheKey } from '../utils/cache';

const API_BASE_URL = 'http://localhost:8000';

// Caches for each feature
const entropyCache = new PredictionCache<EntropyResponse>(50, 1500);
const ghostCache = new PredictionCache<GhostResponse>(50, 1000);
const autopanicCache = new PredictionCache<AutopanicResponse>(30, 800);
const saliencyCache = new PredictionCache<SaliencyResponse>(10, 5000);

/**
 * Fetch entropy for a cursor position.
 */
export async function fetchEntropy(
    code: string, 
    uri: string, 
    cursorLine: number, 
    cursorChar: number
): Promise<EntropyResponse | null> {
    // Build prefix up to cursor
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    
    const cacheKey = makeCacheKey('entropy', prefix);
    const cached = entropyCache.get(cacheKey);
    if (cached) return cached;
    
    try {
        const response = await fetch(`${API_BASE_URL}/entropy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data: EntropyResponse = await response.json();
        entropyCache.set(cacheKey, data);
        return data;
    } catch (err) {
        console.error('Failed to fetch entropy:', err);
        return null;
    }
}

/**
 * Fetch ghost token suggestion.
 */
export async function fetchGhost(
    code: string,
    uri: string,
    cursorLine: number,
    cursorChar: number
): Promise<GhostResponse | null> {
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    
    const cacheKey = makeCacheKey('ghost', prefix);
    const cached = ghostCache.get(cacheKey);
    if (cached) return cached;
    
    try {
        const response = await fetch(`${API_BASE_URL}/ghost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data: GhostResponse = await response.json();
        ghostCache.set(cacheKey, data);
        return data;
    } catch (err) {
        console.error('Failed to fetch ghost:', err);
        return null;
    }
}

/**
 * Fetch autopanic detection.
 */
export async function fetchAutopanic(
    code: string,
    uri: string,
    cursorLine: number,
    cursorChar: number
): Promise<AutopanicResponse | null> {
    const lines = code.split('\n');
    const prefix = buildPrefix(lines, cursorLine, cursorChar);
    
    const cacheKey = makeCacheKey('autopanic', prefix);
    const cached = autopanicCache.get(cacheKey);
    if (cached) return cached;
    
    try {
        const response = await fetch(`${API_BASE_URL}/autopanic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, uri })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data: AutopanicResponse = await response.json();
        autopanicCache.set(cacheKey, data);
        return data;
    } catch (err) {
        console.error('Failed to fetch autopanic:', err);
        return null;
    }
}

/**
 * Fetch saliency analysis (expensive, use sparingly).
 */
export async function fetchSaliency(
    code: string,
    uri: string,
    cursorLine: number,
    cursorChar: number
): Promise<SaliencyResponse | null> {
    const cacheKey = makeCacheKey('saliency', `${uri}:${cursorLine}:${cursorChar}`);
    const cached = saliencyCache.get(cacheKey);
    if (cached) return cached;
    
    try {
        const response = await fetch(`${API_BASE_URL}/saliency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, uri, cursorLine, cursorChar })
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data: SaliencyResponse = await response.json();
        saliencyCache.set(cacheKey, data);
        return data;
    } catch (err) {
        console.error('Failed to fetch saliency:', err);
        return null;
    }
}

/**
 * Build prefix string up to cursor position.
 */
function buildPrefix(lines: string[], cursorLine: number, cursorChar: number): string {
    const targetLine = cursorLine - 1; // 0-indexed
    
    if (targetLine < 0) return '';
    if (targetLine >= lines.length) return lines.join('\n');
    
    const beforeCursor = lines[targetLine].substring(0, cursorChar);
    const prefixLines = lines.slice(0, targetLine);
    prefixLines.push(beforeCursor);
    
    return prefixLines.join('\n');
}

/**
 * Clear all caches.
 */
export function clearCaches(): void {
    entropyCache.clear();
    ghostCache.clear();
    autopanicCache.clear();
    saliencyCache.clear();
}
