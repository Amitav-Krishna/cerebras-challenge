import * as vscode from 'vscode';
import { analyze } from './mock/mockAnalyzer';

// Store decoration types so we can dispose them
let decorationTypes: vscode.TextEditorDecorationType[] = [];

function clearDecorations(editor: vscode.TextEditor) {
    for (const dt of decorationTypes) {
        editor.setDecorations(dt, []);
        dt.dispose();
    }
    decorationTypes = [];
}

// Map logprob (-5 to 0) to color (red to green)
function getColor(logprob: number): string {
    const t = Math.max(0, Math.min(1, (logprob + 5) / 5));
    const r = Math.floor((1 - t) * 255);
    const g = Math.floor(t * 255);
    return `rgba(${r}, ${g}, 50, 0.4)`;
}

function highlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    clearDecorations(editor);

    const code = editor.document.getText();
    const uri = editor.document.uri.toString();
    const analysis = analyze(code, uri);

    for (const line of analysis.lines) {
        const lineText = editor.document.lineAt(line.line_number - 1).text;
        let searchPos = 0;

        for (const tok of line.tokens) {
            if (tok.logprob === 0) continue;

            const trimmed = tok.token.trim();
            if (!trimmed) continue;

            // Find this token at or after current position
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

export function activate(context: vscode.ExtensionContext) {
    highlight();

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(() => highlight()),
        vscode.window.onDidChangeActiveTextEditor(() => highlight())
    );
}

export function deactivate() {}
