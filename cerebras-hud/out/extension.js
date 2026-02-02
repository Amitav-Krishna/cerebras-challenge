"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const client_1 = require("./api/client");
const entropyLens_1 = require("./features/entropyLens");
const ghostToken_1 = require("./features/ghostToken");
const saliencyLens_1 = require("./features/saliencyLens");
// Legacy configuration (existing logprob highlighting)
const CONFUSION_THRESHOLD = -1.0;
const DEBOUNCE_MS = 300;
// State
let decorationTypes = [];
let timeout = null;
let isAnalyzing = false;
/**
 * Get color for logprob-based highlighting (legacy feature).
 */
function getColor(logprob) {
    const t = Math.max(0, Math.min(1, (Math.abs(logprob) - 1) / 4));
    const g = Math.floor((1 - t) * 255);
    return `rgba(255, ${g}, 0, 0.4)`;
}
/**
 * Legacy: Analyze code for logprob-based highlighting.
 */
async function highlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    if (isAnalyzing)
        return;
    isAnalyzing = true;
    try {
        const code = editor.document.getText();
        const uri = editor.document.uri.toString();
        const analysis = await (0, client_1.analyze)(code, uri);
        clearDecorations(editor);
        applyDecorations(editor, analysis);
    }
    catch (err) {
        console.error('Analysis failed:', err);
    }
    finally {
        isAnalyzing = false;
    }
}
/**
 * Legacy: Apply logprob-based decorations.
 */
function applyDecorations(editor, analysis) {
    for (const line of analysis.lines) {
        const lineText = editor.document.lineAt(line.line_number - 1).text;
        let searchPos = 0;
        for (const tok of line.tokens) {
            if (tok.logprob === 0)
                continue;
            const trimmed = tok.token.trim();
            if (!trimmed)
                continue;
            if (tok.logprob >= CONFUSION_THRESHOLD)
                continue;
            const tokenPos = lineText.indexOf(trimmed, searchPos);
            if (tokenPos >= 0) {
                const start = new vscode.Position(line.line_number - 1, tokenPos);
                const end = new vscode.Position(line.line_number - 1, tokenPos + trimmed.length);
                const range = new vscode.Range(start, end);
                const decoration = vscode.window.createTextEditorDecorationType({
                    backgroundColor: getColor(tok.logprob),
                    overviewRulerColor: getColor(tok.logprob),
                    overviewRulerLane: vscode.OverviewRulerLane.Right
                });
                editor.setDecorations(decoration, [range]);
                decorationTypes.push(decoration);
                searchPos = tokenPos + trimmed.length;
            }
        }
    }
}
/**
 * Legacy: Clear all decorations.
 */
function clearDecorations(editor) {
    for (const dt of decorationTypes) {
        editor.setDecorations(dt, []);
        dt.dispose();
    }
    decorationTypes = [];
}
/**
 * Legacy: Debounced highlight.
 */
function debouncedHighlight() {
    if (timeout) {
        clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
        highlight();
    }, DEBOUNCE_MS);
}
/**
 * Combined update function that triggers both legacy and new features.
 */
function onDocumentChange() {
    // Legacy logprob analysis
    debouncedHighlight();
    // New entropy lens
    (0, entropyLens_1.debouncedEntropyHighlight)();
    // Ghost token feature
    (0, ghostToken_1.debouncedGhostUpdate)();
    // Saliency analysis (expensive, only on explicit trigger or pause)
    (0, saliencyLens_1.debouncedSaliencyUpdate)();
}
/**
 * Extension activation.
 */
function activate(context) {
    console.log('Cerebras HUD: Activating...');
    // Initialize legacy highlighting
    highlight();
    // Initialize new HUD features
    (0, entropyLens_1.activateEntropyLens)(context);
    (0, ghostToken_1.activateGhostToken)(context);
    (0, saliencyLens_1.activateSaliencyLens)(context);
    // Register event handlers
    context.subscriptions.push(
    // Combined change handler for both features
    vscode.workspace.onDidChangeTextDocument(() => onDocumentChange()), 
    // Editor switch handler
    vscode.window.onDidChangeActiveTextEditor(() => {
        highlight();
        (0, entropyLens_1.debouncedEntropyHighlight)();
        (0, ghostToken_1.debouncedGhostUpdate)();
        (0, saliencyLens_1.debouncedSaliencyUpdate)();
    }), 
    // Cursor movement for real-time updates
    vscode.window.onDidChangeTextEditorSelection(() => {
        (0, entropyLens_1.debouncedEntropyHighlight)();
        (0, ghostToken_1.debouncedGhostUpdate)();
        // Note: Saliency only updates on document changes, not cursor moves
    }));
    console.log('Cerebras HUD: Activated successfully');
}
/**
 * Extension deactivation.
 */
function deactivate() {
    if (timeout) {
        clearTimeout(timeout);
    }
    (0, entropyLens_1.deactivateEntropyLens)();
    (0, ghostToken_1.deactivateGhostToken)();
    (0, saliencyLens_1.deactivateSaliencyLens)();
}
