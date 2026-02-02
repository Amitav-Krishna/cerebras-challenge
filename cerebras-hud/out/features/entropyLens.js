"use strict";
/**
 * Entropy Lens Feature
 *
 * Renders a heatmap overlay showing model uncertainty.
 * Higher entropy (uncertainty) = warmer colors (yellow -> red).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateEntropyLens = activateEntropyLens;
exports.debouncedEntropyHighlight = debouncedEntropyHighlight;
exports.clearEntropyDecorations = clearEntropyDecorations;
exports.deactivateEntropyLens = deactivateEntropyLens;
const vscode = __importStar(require("vscode"));
const hudClient_1 = require("../api/hudClient");
const metrics_1 = require("../utils/metrics");
// Configuration
const ENTROPY_HIGH_THRESHOLD = 2.0; // bits - show strong color
const ENTROPY_WINDOW_SIZE = 100; // chars to highlight before cursor
const DEBOUNCE_MS = 150; // wait for typing pause
// State
let entropyDecorationType = null;
let entropyTimeout = null;
let isAnalyzing = false;
/**
 * Initialize the entropy lens.
 */
function activateEntropyLens(context) {
    // Register command to toggle
    context.subscriptions.push(vscode.commands.registerCommand('cerebrasHud.toggleEntropy', toggleEntropy));
    // Initial highlight
    debouncedEntropyHighlight();
}
/**
 * Debounced entropy highlighting.
 */
function debouncedEntropyHighlight() {
    if (entropyTimeout) {
        clearTimeout(entropyTimeout);
    }
    entropyTimeout = setTimeout(() => {
        highlightEntropy();
    }, DEBOUNCE_MS);
}
/**
 * Clear entropy decorations.
 */
function clearEntropyDecorations(editor) {
    if (entropyDecorationType) {
        editor.setDecorations(entropyDecorationType, []);
        entropyDecorationType.dispose();
        entropyDecorationType = null;
    }
}
let entropyEnabled = true;
function toggleEntropy() {
    entropyEnabled = !entropyEnabled;
    vscode.window.showInformationMessage(`Entropy Lens: ${entropyEnabled ? 'Enabled' : 'Disabled'}`);
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        if (entropyEnabled) {
            highlightEntropy();
        }
        else {
            clearEntropyDecorations(editor);
        }
    }
}
/**
 * Main entropy highlighting function.
 */
async function highlightEntropy() {
    if (!entropyEnabled)
        return;
    if (isAnalyzing)
        return;
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    isAnalyzing = true;
    try {
        const document = editor.document;
        const uri = document.uri.toString();
        // Get cursor position
        const position = editor.selection.active;
        const cursorLine = position.line;
        const cursorChar = position.character;
        // Fetch entropy data
        const entropyData = await (0, hudClient_1.fetchEntropy)(document.getText(), uri, cursorLine + 1, // API uses 1-indexed
        cursorChar);
        if (!entropyData)
            return;
        // Clear old decorations
        clearEntropyDecorations(editor);
        // Apply new decoration
        applyEntropyDecoration(editor, entropyData.entropy, position);
    }
    catch (err) {
        console.error('Entropy highlighting failed:', err);
    }
    finally {
        isAnalyzing = false;
    }
}
/**
 * Apply entropy heatmap decoration across multiple lines.
 */
function applyEntropyDecoration(editor, entropy, cursorPosition) {
    const document = editor.document;
    const color = (0, metrics_1.entropyToColor)(entropy);
    // Find the start position (windowSize chars before cursor)
    let remainingChars = ENTROPY_WINDOW_SIZE;
    let startLine = cursorPosition.line;
    let startChar = cursorPosition.character;
    // Walk backwards to find start position
    while (remainingChars > 0 && startLine >= 0) {
        const lineLength = document.lineAt(startLine).text.length;
        const charsInLine = startLine === cursorPosition.line
            ? Math.min(startChar, remainingChars)
            : Math.min(lineLength, remainingChars);
        remainingChars -= charsInLine;
        if (remainingChars > 0 && startLine > 0) {
            startLine--;
            startChar = document.lineAt(startLine).text.length;
        }
        else {
            startChar = startLine === cursorPosition.line
                ? Math.max(0, startChar - charsInLine)
                : lineLength - charsInLine;
            break;
        }
    }
    // Clamp to valid document range
    startLine = Math.max(0, startLine);
    const startPos = new vscode.Position(startLine, Math.max(0, startChar));
    const range = new vscode.Range(startPos, cursorPosition);
    // Create decoration type
    entropyDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    // Apply decoration
    editor.setDecorations(entropyDecorationType, [range]);
    // Show entropy value in status bar
    updateStatusBar(entropy);
}
let statusBarItem = null;
function updateStatusBar(entropy) {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.show();
    }
    // Format entropy with color indicator
    const indicator = entropy > ENTROPY_HIGH_THRESHOLD ? '🔴' :
        entropy > 1.0 ? '🟡' : '🟢';
    statusBarItem.text = `${indicator} Entropy: ${entropy.toFixed(2)} bits`;
    statusBarItem.tooltip = `Model uncertainty: ${entropy.toFixed(2)} bits\n` +
        `(0=certain, 4+=very uncertain)`;
}
/**
 * Cleanup on deactivate.
 */
function deactivateEntropyLens() {
    if (entropyTimeout) {
        clearTimeout(entropyTimeout);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
