/**
 * Math utilities for logprob-based HUD metrics.
 * 
 * All calculations work with logprobs from Cerebras API and convert
 * to probabilities internally.
 */

export interface TokenProb {
    token: string;
    logprob: number;
}

/**
 * Convert logprobs to normalized probabilities.
 * Handles numerical stability by subtracting max before exp.
 */
export function logprobsToProbs(logprobs: TokenProb[]): Map<string, number> {
    if (logprobs.length === 0) return new Map();
    
    // Find max logprob for numerical stability
    const maxLogprob = Math.max(...logprobs.map(lp => lp.logprob));
    
    // Compute exp(logprob - max) for each
    const exps = logprobs.map(lp => ({
        token: lp.token,
        exp: Math.exp(lp.logprob - maxLogprob)
    }));
    
    // Normalize
    const sumExp = exps.reduce((sum, e) => sum + e.exp, 0);
    const probs = new Map<string, number>();
    
    for (const { token, exp } of exps) {
        probs.set(token, exp / sumExp);
    }
    
    return probs;
}

/**
 * Calculate Shannon entropy from probability distribution.
 * H = -sum(p_i * log2(p_i))
 * 
 * Returns entropy in bits. Higher = more uncertain.
 */
export function calculateEntropy(probs: Map<string, number>): number {
    let entropy = 0;
    
    for (const p of probs.values()) {
        if (p > 0) {
            entropy -= p * Math.log2(p);
        }
    }
    
    return entropy;
}

/**
 * Calculate entropy directly from logprobs (convenience function).
 */
export function calculateEntropyFromLogprobs(logprobs: TokenProb[]): number {
    const probs = logprobsToProbs(logprobs);
    return calculateEntropy(probs);
}

/**
 * Calculate margin between top-1 and top-2 predictions.
 * margin = p1 - p2
 * 
 * Returns value in [0, 1]. Higher = more confident/clear choice.
 * Low margin (< 0.1-0.2) indicates ambiguity.
 */
export function calculateMargin(topLogprobs: TokenProb[]): number {
    if (topLogprobs.length < 2) return 1.0; // No ambiguity with single option
    
    // Sort by logprob descending (higher logprob = more likely)
    const sorted = [...topLogprobs].sort((a, b) => b.logprob - a.logprob);
    
    const probs = logprobsToProbs(sorted.slice(0, 2));
    const p1 = probs.get(sorted[0].token) || 0;
    const p2 = probs.get(sorted[1].token) || 0;
    
    return p1 - p2;
}

/**
 * Calculate KL divergence between two distributions.
 * KL(P || Q) = sum(P(i) * log(P(i) / Q(i)))
 * 
 * Used for perturbation saliency analysis.
 * Higher KL = removing token significantly changed predictions.
 */
export function calculateKL(p: Map<string, number>, q: Map<string, number>): number {
    let kl = 0;
    
    for (const [token, pVal] of p.entries()) {
        const qVal = q.get(token) || 1e-10; // Small epsilon to avoid log(0)
        if (pVal > 0) {
            kl += pVal * Math.log(pVal / qVal);
        }
    }
    
    return kl;
}

/**
 * Calculate surprisal of actual token.
 * surprisal = -log2(p(actual))
 * 
 * Higher = more surprised the model was by this token.
 */
export function calculateSurprisal(token: string, probs: Map<string, number>): number {
    const p = probs.get(token);
    if (p === undefined || p === 0) {
        // Token not in top-k, assign high surprisal
        // Actual value depends on k; for k=20, max prob is roughly bounded
        return 10.0; // ~1/1000 probability
    }
    return -Math.log2(p);
}

/**
 * Get color for entropy value (for heatmap).
 * 
 * entropy: 0 (certain) -> 4+ bits (very uncertain)
 * color: transparent -> orange-red with alpha
 * 
 * Much more subtle - barely visible at low entropy
 */
export function entropyToColor(entropy: number): string {
    // Only show color if entropy is above threshold
    if (entropy < 0.5) {
        return 'transparent';
    }
    
    // Clamp to [0.5, 4] bits range
    const t = Math.max(0, Math.min(1, (entropy - 0.5) / 3.5));
    
    // Very subtle alpha - max 0.25
    const alpha = t * 0.25;
    
    // Blue-ish for low uncertainty, transitioning to orange/red for high
    // This is easier on the eyes than yellow
    if (t < 0.5) {
        // Blue to purple
        const localT = t * 2;
        const r = Math.floor(localT * 100);
        const g = Math.floor(100 + localT * 50);
        const b = 200;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else {
        // Purple to orange
        const localT = (t - 0.5) * 2;
        const r = 100 + Math.floor(localT * 155);
        const g = 150 - Math.floor(localT * 100);
        const b = 200 - Math.floor(localT * 200);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

/**
 * Get color for margin value (for ambiguity highlighting).
 * 
 * margin: 0 (ambiguous) -> 1.0 (clear)
 * color: red -> green
 */
export function marginToColor(margin: number): string {
    const t = Math.max(0, Math.min(1, margin));
    const r = Math.floor((1 - t) * 255);
    const g = Math.floor(t * 255);
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Determine if margin indicates ambiguity (low confidence).
 */
export function isAmbiguous(margin: number, threshold: number = 0.15): boolean {
    return margin < threshold;
}

/**
 * Determine if entropy indicates high uncertainty.
 */
export function isUncertain(entropy: number, threshold: number = 2.0): boolean {
    return entropy > threshold;
}
