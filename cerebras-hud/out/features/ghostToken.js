"use strict";
/**
 * Ghost Token Feature
 *
 * Shows a faint "ghost" token when the model is uncertain (low margin).
 * This indicates the alternative the model was considering.
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
exports.activateGhostToken = activateGhostToken;
exports.debouncedGhostUpdate = debouncedGhostUpdate;
exports.clearGhostDecorations = clearGhostDecorations;
exports.deactivateGhostToken = deactivateGhostToken;
const vscode = __importStar(require("vscode"));
const hudClient_1 = require("../api/hudClient");
// Configuration
const MARGIN_THRESHOLD = 0.15; // Show ghost when margin < this
const GHOST_OPACITY = 0.4; // How faint the ghost appears
const DEBOUNCE_MS = 100; // Slightly faster than entropy
// State
let ghostDecorationType = null;
let ambiguityDecorationType = null;
let ghostTimeout = null;
let isAnalyzing = false;
let ghostEnabled = true;
/**
 * Initialize the ghost token feature.
 */
function activateGhostToken(context) {
    context.subscriptions.push(vscode.commands.registerCommand('cerebrasHud.toggleGhost', toggleGhost));
}
function toggleGhost() {
    ghostEnabled = !ghostEnabled;
    vscode.window.showInformationMessage(`Ghost Tokens: ${ghostEnabled ? 'Enabled' : 'Disabled'}`);
    const editor = vscode.window.activeTextEditor;
    if (editor && !ghostEnabled) {
        clearGhostDecorations(editor);
    }
}
/**
 * Debounced ghost token update.
 */
function debouncedGhostUpdate() {
    if (ghostTimeout) {
        clearTimeout(ghostTimeout);
    }
    ghostTimeout = setTimeout(() => {
        updateGhostToken();
    }, DEBOUNCE_MS);
}
/**
 * Clear ghost decorations.
 */
function clearGhostDecorations(editor) {
    if (ghostDecorationType) {
        editor.setDecorations(ghostDecorationType, []);
        ghostDecorationType.dispose();
        ghostDecorationType = null;
    }
    if (ambiguityDecorationType) {
        editor.setDecorations(ambiguityDecorationType, []);
        ambiguityDecorationType.dispose();
        ambiguityDecorationType = null;
    }
}
/**
 * Main ghost token update function.
 */
async function updateGhostToken() {
    if (!ghostEnabled)
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
        const position = editor.selection.active;
        // Fetch ghost data
        const ghostData = await (0, hudClient_1.fetchGhost)(document.getText(), uri, position.line + 1, position.character);
        if (!ghostData)
            return;
        // Clear old decorations
        clearGhostDecorations(editor);
        // Show ghost if margin is low
        if (ghostData.shouldShowGhost) {
            showGhostToken(editor, position, ghostData);
        }
        // Always show ambiguity indicator for low margin
        if (ghostData.margin < 0.3) {
            showAmbiguityIndicator(editor, position, ghostData);
        }
    }
    catch (err) {
        console.error('Ghost token update failed:', err);
    }
    finally {
        isAnalyzing = false;
    }
}
/**
 * Show ghost token as faint text after cursor.
 */
function showGhostToken(editor, position, ghostData) {
    const ghostText = ghostData.secondary.token;
    if (!ghostText || ghostText === '\n')
        return; // Don't show newlines as ghosts
    // Create decoration with ghost text
    ghostDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ghostText,
            color: `rgba(150, 150, 150, ${GHOST_OPACITY})`,
            fontStyle: 'italic',
            margin: '0 0 0 2px'
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
    });
    // Position ghost right after cursor
    const range = new vscode.Range(position, position);
    // Add hover message with details
    const decorationOptions = {
        range,
        hoverMessage: new vscode.MarkdownString(`**Ambiguous Prediction** (margin: ${ghostData.margin.toFixed(3)})\n\n` +
            `Also considering: \`${escapeMarkdown(ghostText)}\``)
    };
    editor.setDecorations(ghostDecorationType, [decorationOptions]);
}
/**
 * Show ambiguity underline when margin is low.
 */
function showAmbiguityIndicator(editor, position, ghostData) {
    // Color based on margin: red (low/confused) -> yellow -> green (high/confident)
    const t = Math.max(0, Math.min(1, ghostData.margin / 0.3));
    const r = Math.floor((1 - t) * 255);
    const g = Math.floor(t * 200 + 55);
    const color = `rgba(${r}, ${g}, 0, 0.6)`;
    ambiguityDecorationType = vscode.window.createTextEditorDecorationType({
        borderColor: color,
        borderStyle: 'solid',
        borderWidth: '0 0 2px 0',
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });
    // Underline the word/char before cursor
    const lineText = editor.document.lineAt(position.line).text;
    let startChar = position.character;
    // Find word boundary before cursor
    while (startChar > 0 && /\w/.test(lineText[startChar - 1])) {
        startChar--;
    }
    const range = new vscode.Range(new vscode.Position(position.line, startChar), position);
    const decorationOptions = {
        range,
        hoverMessage: new vscode.MarkdownString(`**Model Uncertainty**\n\n` +
            `Top prediction: \`${escapeMarkdown(ghostData.primary.token)}\`\n` +
            `Alternative: \`${escapeMarkdown(ghostData.secondary.token)}\`\n` +
            `Margin: ${ghostData.margin.toFixed(3)} (lower = more uncertain)`)
    };
    editor.setDecorations(ambiguityDecorationType, [decorationOptions]);
}
/**
 * Escape markdown in token text.
 */
function escapeMarkdown(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\n/g, '\\n');
}
/**
 * Cleanup on deactivate.
 */
function deactivateGhostToken() {
    if (ghostTimeout) {
        clearTimeout(ghostTimeout);
    }
}
