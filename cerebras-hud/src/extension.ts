import * as vscode from 'vscode';
import { analyze } from './api/client';
import { FileProbs } from './types/logprobs';

// Only show confusion when logprob is below this threshold
const CONFUSION_THRESHOLD = -1.0;
// Debounce delay in ms - wait for typing to pause
const DEBOUNCE_MS = 300;

let decorationTypes: vscode.TextEditorDecorationType[] = [];
let timeout: ReturnType<typeof setTimeout> | null = null;
let isAnalyzing = false;

function clearDecorations(editor: vscode.TextEditor) {
    for (const dt of decorationTypes) {
        editor.setDecorations(dt, []);
        dt.dispose();
    }
    decorationTypes = [];
}

function getColor(logprob: number): string {
    const t = Math.max(0, Math.min(1, (Math.abs(logprob) - 1) / 4));
    const g = Math.floor((1 - t) * 255);
    return `rgba(255, ${g}, 0, 0.4)`;
}

async function highlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Don't start new analysis if one is running
    if (isAnalyzing) return;
    
    isAnalyzing = true;

    try {
        const code = editor.document.getText();
        const uri = editor.document.uri.toString();
        
        // Call API (mock or real)
        const analysis = await analyze(code, uri);
        
        // Clear old decorations
        clearDecorations(editor);
        
        // Apply new decorations
        applyDecorations(editor, analysis);
    } catch (err) {
        console.error('Analysis failed:', err);
    } finally {
        isAnalyzing = false;
    }
}

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

function debouncedHighlight() {
    if (timeout) {
        clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
        highlight();
    }, DEBOUNCE_MS);
}

export function activate(context: vscode.ExtensionContext) {
    highlight();

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(() => debouncedHighlight()),
        vscode.window.onDidChangeActiveTextEditor(() => highlight())
    );
}

export function deactivate() {
    if (timeout) {
        clearTimeout(timeout);
    }
}
