"use strict";
/**
 * Type definitions for HUD features (entropy, ghost tokens, etc.)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
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
