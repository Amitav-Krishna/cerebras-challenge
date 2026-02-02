import * as vscode from 'vscode';
import { analyze } from './api/client';
import { FileProbs } from './types/logprobs';
import { 
    activateEntropyLens, 
    debouncedEntropyHighlight, 
    clearEntropyDecorations,
    deactivateEntropyLens 
} from './features/entropyLens';
import {
    activateGhostToken,
    debouncedGhostUpdate,
    clearGhostDecorations,
    deactivateGhostToken
} from './features/ghostToken';
import {
    activateSaliencyLens,
    debouncedSaliencyUpdate,
    clearSaliencyDecorations,
    deactivateSaliencyLens
} from './features/saliencyLens';

// Legacy configuration (existing logprob highlighting)
const CONFUSION_THRESHOLD = -1.0;
const DEBOUNCE_MS = 300;

// State
let decorationTypes: vscode.TextEditorDecorationType[] = [];
let timeout: ReturnType<typeof setTimeout> | null = null;
let isAnalyzing = false;

/**
 * Get color for logprob-based highlighting (legacy feature).
 */
function getColor(logprob: number): string {
    const t = Math.max(0, Math.min(1, (Math.abs(logprob) - 1) / 4));
    const g = Math.floor((1 - t) * 255);
    return `rgba(255, ${g}, 0, 0.4)`;
}

/**
 * Legacy: Analyze code for logprob-based highlighting.
 */
async function highlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (isAnalyzing) return;
    isAnalyzing = true;

    try {
        const code = editor.document.getText();
        const uri = editor.document.uri.toString();
        
        const analysis = await analyze(code, uri);
        
        clearDecorations(editor);
        applyDecorations(editor, analysis);
    } catch (err) {
        console.error('Analysis failed:', err);
    } finally {
        isAnalyzing = false;
    }
}

/**
 * Legacy: Apply logprob-based decorations.
 */
function applyDecorations(editor: vscode.TextEditor, analysis: FileProbs) {
    for (const line of analysis.lines) {
        const lineText = editor.document.lineAt(line.line_number - 1).text;
        let searchPos = 0;

        for (const tok of line.tokens) {
            if (tok.logprob === 0) continue;
            const trimmed = tok.token.trim();
            if (!trimmed) continue;
            if (tok.logprob >= CONFUSION_THRESHOLD) continue;

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
function clearDecorations(editor: vscode.TextEditor) {
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
    debouncedEntropyHighlight();
    
    // Ghost token feature
    debouncedGhostUpdate();
    
    // Saliency analysis (expensive, only on explicit trigger or pause)
    debouncedSaliencyUpdate();
}

/**
 * Extension activation.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Cerebras HUD: Activating...');
    
    // Initialize legacy highlighting
    highlight();
    
    // Initialize new HUD features
    activateEntropyLens(context);
    activateGhostToken(context);
    activateSaliencyLens(context);
    
    // Register event handlers
    context.subscriptions.push(
        // Combined change handler for both features
        vscode.workspace.onDidChangeTextDocument(() => onDocumentChange()),
        
        // Editor switch handler
        vscode.window.onDidChangeActiveTextEditor(() => {
            highlight();
            debouncedEntropyHighlight();
            debouncedGhostUpdate();
            debouncedSaliencyUpdate();
        }),
        
        // Cursor movement for real-time updates
        vscode.window.onDidChangeTextEditorSelection(() => {
            debouncedEntropyHighlight();
            debouncedGhostUpdate();
            // Note: Saliency only updates on document changes, not cursor moves
        })
    );
    
    console.log('Cerebras HUD: Activated successfully');
}

/**
 * Extension deactivation.
 */
export function deactivate() {
    if (timeout) {
        clearTimeout(timeout);
    }
    
    deactivateEntropyLens();
    deactivateGhostToken();
    deactivateSaliencyLens();
}
