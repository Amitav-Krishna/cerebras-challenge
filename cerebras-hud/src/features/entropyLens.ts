/**
 * Entropy Lens Feature
 * 
 * Renders a heatmap overlay showing model uncertainty.
 * Higher entropy (uncertainty) = warmer colors (yellow -> red).
 */

import * as vscode from 'vscode';
import { fetchEntropy } from '../api/hudClient';
import { entropyToColor } from '../utils/metrics';

// Configuration
const ENTROPY_HIGH_THRESHOLD = 2.0;   // bits - show strong color
const ENTROPY_WINDOW_SIZE = 100;      // chars to highlight before cursor
const DEBOUNCE_MS = 150;              // wait for typing pause

// State
let entropyDecorationType: vscode.TextEditorDecorationType | null = null;
let entropyTimeout: ReturnType<typeof setTimeout> | null = null;
let isAnalyzing = false;

/**
 * Initialize the entropy lens.
 */
export function activateEntropyLens(context: vscode.ExtensionContext): void {
    // Register command to toggle
    context.subscriptions.push(
        vscode.commands.registerCommand('cerebrasHud.toggleEntropy', toggleEntropy)
    );
    
    // Initial highlight
    debouncedEntropyHighlight();
}

/**
 * Debounced entropy highlighting.
 */
export function debouncedEntropyHighlight(): void {
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
export function clearEntropyDecorations(editor: vscode.TextEditor): void {
    if (entropyDecorationType) {
        editor.setDecorations(entropyDecorationType, []);
        entropyDecorationType.dispose();
        entropyDecorationType = null;
    }
}

let entropyEnabled = true;

function toggleEntropy(): void {
    entropyEnabled = !entropyEnabled;
    vscode.window.showInformationMessage(
        `Entropy Lens: ${entropyEnabled ? 'Enabled' : 'Disabled'}`
    );
    
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        if (entropyEnabled) {
            highlightEntropy();
        } else {
            clearEntropyDecorations(editor);
        }
    }
}

/**
 * Main entropy highlighting function.
 */
async function highlightEntropy(): Promise<void> {
    if (!entropyEnabled) return;
    if (isAnalyzing) return;
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    isAnalyzing = true;
    
    try {
        const document = editor.document;
        const uri = document.uri.toString();
        
        // Get cursor position
        const position = editor.selection.active;
        const cursorLine = position.line;
        const cursorChar = position.character;
        
        // Fetch entropy data
        const entropyData = await fetchEntropy(
            document.getText(),
            uri,
            cursorLine + 1,  // API uses 1-indexed
            cursorChar
        );
        
        if (!entropyData) return;
        
        // Clear old decorations
        clearEntropyDecorations(editor);
        
        // Apply new decoration
        applyEntropyDecoration(editor, entropyData.entropy, position);
        
    } catch (err) {
        console.error('Entropy highlighting failed:', err);
    } finally {
        isAnalyzing = false;
    }
}

/**
 * Apply entropy heatmap decoration across multiple lines.
 */
function applyEntropyDecoration(
    editor: vscode.TextEditor,
    entropy: number,
    cursorPosition: vscode.Position
): void {
    const document = editor.document;
    const color = entropyToColor(entropy);
    
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
        } else {
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

let statusBarItem: vscode.StatusBarItem | null = null;

function updateStatusBar(entropy: number): void {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
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
export function deactivateEntropyLens(): void {
    if (entropyTimeout) {
        clearTimeout(entropyTimeout);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
