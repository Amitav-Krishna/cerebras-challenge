/**
 * Type definitions for HUD features (entropy, ghost tokens, etc.)
 */

import { TokenProb } from './logprobs';

// ============================================================================
// Request Types
// ============================================================================

export interface PrefixRequest {
    prefix: string;
    uri: string;
}

export interface CursorRequest {
    code: string;
    uri: string;
    cursorLine: number;
    cursorChar: number;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Entropy analysis for a cursor position.
 */
export interface EntropyResponse {
    entropy: number;           // Shannon entropy in bits
    maxLogprob: number;        // Highest logprob (confidence of top prediction)
    topLogprobs: TokenProb[];  // Top-k logprobs used for calculation
    tokenCount: number;        // Number of tokens considered
}

/**
 * Ghost token suggestion.
 */
export interface GhostResponse {
    primary: TokenProb;        // Top prediction
    secondary: TokenProb;      // Second best (for ghost display)
    margin: number;            // Difference in probability
    shouldShowGhost: boolean;  // Whether margin is low enough to show ambiguity
}

/**
 * Bracket autopanic detection.
 */
export interface AutopanicResponse {
    expectingClose: boolean;   // Model expects a closing token
    closeTypes: string[];      // Which closing tokens are likely
    confidence: number;        // Total probability mass on closing tokens
    topCloseToken: string;     // Most likely closing token
    topCloseProb: number;      // Probability of most likely closer
}

/**
 * Saliency result for a single token position.
 */
export interface SaliencyToken {
    line: number;
    character: number;
    klDivergence: number;      // Impact on next-token distribution
    tokenText: string;
}

/**
 * Perturbation-based saliency map.
 */
export interface SaliencyResponse {
    tokens: SaliencyToken[];
    baseEntropy: number;
}

/**
 * Combined analysis response.
 */
export interface HudAnalysisResponse {
    entropy?: EntropyResponse;
    ghost?: GhostResponse;
    autopanic?: AutopanicResponse;
    saliency?: SaliencyResponse;
}

// ============================================================================
// Feature Configuration
// ============================================================================

export interface HudFeatureConfig {
    entropy: {
        enabled: boolean;
        threshold: number;      // Show heatmap when entropy > this
        windowSize: number;     // Characters before cursor to highlight
    };
    ghost: {
        enabled: boolean;
        marginThreshold: number; // Show ghost when margin < this
    };
    autopanic: {
        enabled: boolean;
        confidenceThreshold: number; // Trigger when close prob > this
    };
    saliency: {
        enabled: boolean;
        maxTokens: number;      // Max tokens to analyze
        klThreshold: number;    // Min KL to be considered salient
    };
}

export const DEFAULT_CONFIG: HudFeatureConfig = {
    entropy: {
        enabled: true,
        threshold: 1.0,
        windowSize: 100
    },
    ghost: {
        enabled: true,
        marginThreshold: 0.15
    },
    autopanic: {
        enabled: true,
        confidenceThreshold: 0.6
    },
    saliency: {
        enabled: false, // Expensive, off by default
        maxTokens: 10,
        klThreshold: 0.1
    }
};
