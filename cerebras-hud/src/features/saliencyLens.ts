/**
 * Saliency Lens Feature (M4)
 * 
 * Shows which tokens in your code most influence the model's next prediction.
 * Uses perturbation-based analysis: "If I delete this token, does the 
 * model's prediction change significantly?"
 * 
 * High KL divergence = that token was "salient" (important)
 */

import * as vscode from 'vscode';
import { fetchSaliency } from '../api/hudClient';
import { SaliencyToken } from '../types/hud';

// Configuration
const SALIENCY_DEBOUNCE_MS = 500;     // Wait longer (expensive operation)
const MAX_DISPLAY_TOKENS = 5;         // Show top N most salient
const KL_THRESHOLD = 0.05;            // Min KL to be considered salient

// State
let saliencyDecorationTypes: vscode.TextEditorDecorationType[] = [];
let connectorDecorationType: vscode.TextEditorDecorationType | null = null;
let saliencyTimeout: ReturnType<typeof setTimeout> | null = null;
let isAnalyzing = false;
let saliencyEnabled = false;          // Off by default (expensive)

/**
 * Initialize the saliency lens.
 */
export function activateSaliencyLens(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('cerebrasHud.toggleSaliency', toggleSaliency),
        vscode.commands.registerCommand('cerebrasHud.runSaliencyAnalysis', runSaliencyNow)
    );
}

function toggleSaliency(): void {
    saliencyEnabled = !saliencyEnabled;
    vscode.window.showInformationMessage(
        `Saliency Lens: ${saliencyEnabled ? 'Enabled (auto)' : 'Disabled'}`
    );
    
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        if (saliencyEnabled) {
            debouncedSaliencyUpdate();
        } else {
            clearSaliencyDecorations(editor);
        }
    }
}

function runSaliencyNow(): void {
    saliencyEnabled = true;
    debouncedSaliencyUpdate();
    vscode.window.showInformationMessage('Running saliency analysis...');
}

/**
 * Debounced saliency update.
 */
export function debouncedSaliencyUpdate(): void {
    if (!saliencyEnabled) return;
    
    if (saliencyTimeout) {
        clearTimeout(saliencyTimeout);
    }
    saliencyTimeout = setTimeout(() => {
        updateSaliency();
    }, SALIENCY_DEBOUNCE_MS);
}

/**
 * Clear saliency decorations.
 */
export function clearSaliencyDecorations(editor: vscode.TextEditor): void {
    for (const dt of saliencyDecorationTypes) {
        editor.setDecorations(dt, []);
        dt.dispose();
    }
    saliencyDecorationTypes = [];
    
    if (connectorDecorationType) {
        editor.setDecorations(connectorDecorationType, []);
        connectorDecorationType.dispose();
        connectorDecorationType = null;
    }
}

/**
 * Main saliency update function.
 */
async function updateSaliency(): Promise<void> {
    if (!saliencyEnabled) return;
    if (isAnalyzing) return;
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    isAnalyzing = true;
    
    // Show progress indicator
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: 'Analyzing token saliency...'
    }, async () => {
        try {
            const document = editor.document;
            const uri = document.uri.toString();
            const position = editor.selection.active;
            
            // Fetch saliency data
            const saliencyData = await fetchSaliency(
                document.getText(),
                uri,
                position.line + 1,
                position.character
            );
            
            if (!saliencyData || !saliencyData.tokens.length) return;
            
            // Clear old decorations
            clearSaliencyDecorations(editor);
            
            // Show salient tokens
            showSaliencyHighlights(editor, position, saliencyData.tokens);
            
        } catch (err) {
            console.error('Saliency analysis failed:', err);
        } finally {
            isAnalyzing = false;
        }
    });
}

/**
 * Show saliency highlights on tokens.
 */
function showSaliencyHighlights(
    editor: vscode.TextEditor,
    cursorPosition: vscode.Position,
    tokens: SaliencyToken[]
): void {
    // Filter and sort by KL divergence
    const salientTokens = tokens
        .filter(t => t.klDivergence >= KL_THRESHOLD)
        .sort((a, b) => b.klDivergence - a.klDivergence)
        .slice(0, MAX_DISPLAY_TOKENS);
    
    if (salientTokens.length === 0) return;
    
    // Max KL for normalization
    const maxKL = salientTokens[0].klDivergence;
    
    // Create decorations for each salient token
    const connectorRanges: vscode.Range[] = [];
    
    for (const token of salientTokens) {
        // Convert to 0-indexed
        const line = token.line - 1;
        const char = token.character;
        
        // Skip if out of range
        if (line < 0 || line >= editor.document.lineCount) continue;
        
        const lineText = editor.document.lineAt(line).text;
        const tokenLength = token.tokenText.length;
        
        // Validate position
        if (char < 0 || char + tokenLength > lineText.length) continue;
        
        // Create highlight
        const range = new vscode.Range(
            new vscode.Position(line, char),
            new vscode.Position(line, char + tokenLength)
        );
        
        // Color intensity based on KL divergence
        const intensity = token.klDivergence / maxKL;
        const color = klToColor(intensity);
        
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            borderColor: color.replace('0.4)', '1.0)'),
            borderStyle: 'solid',
            borderWidth: '1px',
            overviewRulerColor: color,
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        
        const decorationOptions: vscode.DecorationOptions = {
            range,
            hoverMessage: new vscode.MarkdownString(
                `**Saliency: ${token.klDivergence.toFixed(3)}**\n\n` +
                `This token significantly influences the model's prediction.\n\n` +
                `If removed, the next-token distribution would change substantially.`
            )
        };
        
        editor.setDecorations(decorationType, [decorationOptions]);
        saliencyDecorationTypes.push(decorationType);
        
        // Add to connector ranges
        connectorRanges.push(range);
    }
    
    // Draw subtle connector lines from salient tokens to cursor
    if (connectorRanges.length > 0) {
        drawConnectors(editor, cursorPosition, connectorRanges);
    }
}

/**
 * Draw subtle connector lines to cursor.
 */
function drawConnectors(
    editor: vscode.TextEditor,
    cursorPosition: vscode.Position,
    tokenRanges: vscode.Range[]
): void {
    // This creates a "radar" effect showing which tokens matter
    connectorDecorationType = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: 'rgba(100, 100, 255, 0.3)',
        overviewRulerLane: vscode.OverviewRulerLane.Right
    });
    
    // Use cursor position as end of connector
    const cursorRange = new vscode.Range(cursorPosition, cursorPosition);
    
    editor.setDecorations(connectorDecorationType, [
        cursorRange,
        ...tokenRanges
    ]);
}

/**
 * Convert KL intensity to color.
 * Low (0.0) = blue/cyan, High (1.0) = purple/magenta
 */
function klToColor(intensity: number): string {
    // Clamp
    const t = Math.max(0, Math.min(1, intensity));
    
    // Blue -> Cyan -> Purple -> Magenta
    if (t < 0.33) {
        // Blue to Cyan
        const localT = t * 3;
        const r = 0;
        const g = Math.floor(localT * 200);
        const b = 255;
        return `rgba(${r}, ${g}, ${b}, 0.4)`;
    } else if (t < 0.66) {
        // Cyan to Purple
        const localT = (t - 0.33) * 3;
        const r = Math.floor(localT * 180);
        const g = 200 - Math.floor(localT * 150);
        const b = 255;
        return `rgba(${r}, ${g}, ${b}, 0.4)`;
    } else {
        // Purple to Magenta
        const localT = (t - 0.66) * 3;
        const r = 180 + Math.floor(localT * 75);
        const g = 50 - Math.floor(localT * 50);
        const b = 255;
        return `rgba(${r}, ${g}, ${b}, 0.4)`;
    }
}

/**
 * Cleanup on deactivate.
 */
export function deactivateSaliencyLens(): void {
    if (saliencyTimeout) {
        clearTimeout(saliencyTimeout);
    }
}
