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
const mockAnalyzer_1 = require("./mock/mockAnalyzer");
// Store decoration types so we can dispose them
let decorationTypes = [];
function clearDecorations(editor) {
    for (const dt of decorationTypes) {
        editor.setDecorations(dt, []);
        dt.dispose();
    }
    decorationTypes = [];
}
// Map logprob (-5 to 0) to color (red to green)
function getColor(logprob) {
    const t = Math.max(0, Math.min(1, (logprob + 5) / 5));
    const r = Math.floor((1 - t) * 255);
    const g = Math.floor(t * 255);
    return `rgba(${r}, ${g}, 50, 0.4)`;
}
function highlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    clearDecorations(editor);
    const code = editor.document.getText();
    const uri = editor.document.uri.toString();
    const analysis = (0, mockAnalyzer_1.analyze)(code, uri);
    for (const line of analysis.lines) {
        const lineText = editor.document.lineAt(line.line_number - 1).text;
        let searchPos = 0;
        for (const tok of line.tokens) {
            if (tok.logprob === 0)
                continue;
            const trimmed = tok.token.trim();
            if (!trimmed)
                continue;
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
function activate(context) {
    highlight();
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => highlight()), vscode.window.onDidChangeActiveTextEditor(() => highlight()));
}
function deactivate() { }
