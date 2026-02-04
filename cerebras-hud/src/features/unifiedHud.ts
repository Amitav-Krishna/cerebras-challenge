/**
 * Unified HUD - The E-Scooter
 * 
 * Combines entropy, ghost, saliency into one cohesive visual system.
 * Uses existing API endpoints, transforms data for mockup-style rendering.
 * 
 * CHANGES:
 * - Real-time: 50ms debounce
 * - Ghost: Blue, small, positioned beneath token
 * - Saliency: HIGHLY visible (underlines + glow)
 * - Precomputed mode: Loads from JSON for instant demo
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { analyze } from '../api/client';
import { fetchGhost, fetchSaliency } from '../api/hudClient';
import { FileProbs, TokenProb } from '../types/logprobs';
import { GhostResponse, SaliencyResponse } from '../types/hud';
import { PRECOMPUTED_DATA } from '../precomputed-data';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface RankColor {
  bg: string;
  bar: string;
  border: string;
}

const RANK_COLORS: Record<string, RankColor> = {
  confident: { bg: 'rgba(76, 175, 80, 0.25)',   bar: '#4CAF50', border: '#4CAF50' },
  unsure:    { bg: 'rgba(255, 193, 7, 0.3)',    bar: '#FFC107', border: '#FFC107' },
  confused:  { bg: 'rgba(255, 87, 34, 0.35)',   bar: '#FF5722', border: '#FF5722' },
  lost:      { bg: 'rgba(244, 67, 54, 0.4)',    bar: '#F44336', border: '#F44336' },
};

const LOGPROB_RANGES = {
  confident: { min: -Infinity, max: -0.5 },
  unsure:    { min: -0.5, max: -1.5 },
  confused:  { min: -1.5, max: -3.0 },
  lost:      { min: -3.0, max: Infinity },
};

const DEBOUNCE_MS = 50;

// ============================================================================
// STATE
// ============================================================================

let tokenDecorationTypes: vscode.TextEditorDecorationType[] = [];
let ghostDecorationType: vscode.TextEditorDecorationType | null = null;
let currentWordDecorationType: vscode.TextEditorDecorationType | null = null;
let saliencyDecorationTypes: vscode.TextEditorDecorationType[] = [];
let timeout: ReturnType<typeof setTimeout> | null = null;
let isAnalyzing = false;
let hudEnabled = true;
let precomputedData: any = null;
let usePrecomputed = false;

// Demo mode state
type DemoMode = 'normal' | 'baseline' | 'entropy' | 'ghost' | 'saliency' | 'focus';
let demoMode: DemoMode = 'normal';

// Scripted demo state
let scriptedHighlightDecorations: vscode.TextEditorDecorationType[] = [];
let scriptedGhostDecoration: vscode.TextEditorDecorationType | null = null;
let scriptedSaliencyDecorations: vscode.TextEditorDecorationType[] = [];

// ============================================================================
// PRECOMPUTED DATA
// ============================================================================

let extensionContext: vscode.ExtensionContext | undefined;

function loadPrecomputedData(): void {
  try {
    // First try embedded data
    if (PRECOMPUTED_DATA && PRECOMPUTED_DATA.code) {
      precomputedData = PRECOMPUTED_DATA;
      usePrecomputed = true;
      console.log('Unified HUD: Loaded embedded precomputed data');
      return;
    }
    
    // Fallback to file system
    const possiblePaths = [
      path.join(path.dirname(__dirname), 'precomputed.json'),
      path.join(__dirname, '..', 'precomputed.json'),
      path.join(process.cwd(), 'precomputed.json'),
      '/home/amitav-krishna/codage/projets/cerebras-challenge/cerebras-hud/precomputed.json',
      extensionContext ? path.join(extensionContext.extensionPath, 'out', 'precomputed.json') : '',
      extensionContext ? path.join(extensionContext.extensionPath, 'precomputed.json') : ''
    ].filter(p => p);
    
    for (const precomputedPath of possiblePaths) {
      console.log('Checking for precomputed.json at:', precomputedPath);
      if (fs.existsSync(precomputedPath)) {
        const data = JSON.parse(fs.readFileSync(precomputedPath, 'utf-8'));
        precomputedData = data;
        usePrecomputed = true;
        console.log('Unified HUD: Loaded precomputed data from:', precomputedPath);
        console.log('Precomputed code sample:', data.code?.substring(0, 50));
        return;
      }
    }
    
    console.log('Unified HUD: precomputed.json not found in any location');
    usePrecomputed = false;
  } catch (err) {
    console.error('Unified HUD: Error loading precomputed data:', err);
    usePrecomputed = false;
  }
}

function getPrecomputedGhost(line: number, char: number): GhostResponse | null {
  if (!usePrecomputed || !precomputedData?.ghosts) return null;
  const key = `${line}:${char}`;
  return precomputedData.ghosts[key] || null;
}

function getPrecomputedSaliency(line: number, char: number): SaliencyResponse | null {
  if (!usePrecomputed || !precomputedData?.saliencies) return null;
  const key = `${line}:${char}`;
  return precomputedData.saliencies[key] || null;
}

function getPrecomputedTokenRanks(): any[] | null {
  if (!usePrecomputed || !precomputedData?.token_ranks) return null;
  return precomputedData.token_ranks;
}

// ============================================================================
// ACTIVATION
// ============================================================================

export function activateUnifiedHud(context: vscode.ExtensionContext): void {
  console.log('Unified HUD: Activating...');
  console.log('Extension path:', context.extensionPath);
  console.log('Extension URI:', context.extensionUri?.toString());
  
  extensionContext = context;
  loadPrecomputedData();
  
  context.subscriptions.push(
    vscode.commands.registerCommand('cerebrasHud.toggleHud', toggleHud),
    vscode.commands.registerCommand('cerebrasHud.setDemoMode', setDemoMode),
    vscode.commands.registerCommand('cerebrasHud.scriptedHighlight', scriptedHighlight),
    vscode.commands.registerCommand('cerebrasHud.scriptedGhost', scriptedGhost),
    vscode.commands.registerCommand('cerebrasHud.scriptedSaliency', scriptedSaliency),
    vscode.commands.registerCommand('cerebrasHud.clearScriptedDemo', clearScriptedDemo)
  );
  
  updateHud();
  
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => debouncedUpdate()),
    vscode.window.onDidChangeActiveTextEditor(() => updateHud()),
    vscode.window.onDidChangeTextEditorSelection(() => debouncedUpdate())
  );
  
  console.log('Unified HUD: Activated');
}

function toggleHud(): void {
  hudEnabled = !hudEnabled;
  vscode.window.showInformationMessage(
    `Cerebras HUD: ${hudEnabled ? 'Enabled' : 'Disabled'}`
  );
  
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (hudEnabled) {
      updateHud();
    } else {
      clearDecorations(editor);
    }
  }
}

function setDemoMode(mode: string): void {
  demoMode = mode as DemoMode;
  console.log('Demo mode set to:', mode);
  
  // Force refresh
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    clearDecorations(editor);
    updateHud();
  }
}

function debouncedUpdate(): void {
  if (!hudEnabled) return;
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => updateHud(), DEBOUNCE_MS);
}

async function updateHud(): Promise<void> {
  if (!hudEnabled) return;
  if (isAnalyzing) return;
  
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (editor.document.languageId !== 'python') return;
  
  isAnalyzing = true;
  
  try {
    const document = editor.document;
    const code = document.getText();
    const uri = document.uri.toString();
    const position = editor.selection.active;
    
    // Normalize line endings and trim for comparison
    const normalizedCode = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    const normalizedPrecomputed = precomputedData?.code?.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    
    console.log('Precomputed available:', usePrecomputed);
    console.log('Code length:', normalizedCode.length, 'Precomputed length:', normalizedPrecomputed?.length);
    console.log('Match:', normalizedCode === normalizedPrecomputed);
    console.log('Current code:', JSON.stringify(normalizedCode.substring(0, 100)));
    console.log('Precomputed:', JSON.stringify(normalizedPrecomputed?.substring(0, 100)));
    
    // Determine what to render based on demo mode
    const showEntropy = demoMode !== 'baseline' && demoMode !== 'focus';
    const showGhost = demoMode === 'ghost' || demoMode === 'entropy' || demoMode === 'normal';
    const showSaliency = demoMode === 'saliency';
    const showSidebar = demoMode !== 'baseline' && demoMode !== 'focus';
    
    // In demo mode, ALWAYS use precomputed data (no API calls)
    const isDemoMode = demoMode !== 'normal';
    
    if (isDemoMode && usePrecomputed) {
      // DEMO MODE: Use precomputed data regardless of code match
      clearDecorations(editor);
      if (showEntropy) renderTokenHighlightsFromPrecomputed(editor);
      if (showSidebar) renderSidebarFromPrecomputed(editor);
      if (showGhost) renderGhostFromPrecomputed(editor, position);
      if (showSaliency) renderSaliencyFromPrecomputed(editor, position);
    } else if (usePrecomputed && normalizedCode === normalizedPrecomputed) {
      // NORMAL MODE: Code matches precomputed
      clearDecorations(editor);
      if (showEntropy) renderTokenHighlightsFromPrecomputed(editor);
      if (showSidebar) renderSidebarFromPrecomputed(editor);
      if (showGhost) renderGhostFromPrecomputed(editor, position);
      if (showSaliency) renderSaliencyFromPrecomputed(editor, position);
    } else {
      // FALLBACK: Live API calls
      const [analysis, ghostData, saliencyData] = await Promise.all([
        analyze(code, uri),
        fetchGhost(code, uri, position.line + 1, position.character),
        fetchSaliency(code, uri, position.line + 1, position.character)
      ]);
      
      clearDecorations(editor);
      if (showEntropy) renderTokenHighlights(editor, analysis);
      if (showSidebar) renderSidebar(editor, analysis);
      if (showGhost) renderGhost(editor, position, ghostData);
      if (showSaliency) renderSaliency(editor, saliencyData);
    }
    
  } catch (err) {
    console.error('HUD update failed:', err);
  } finally {
    isAnalyzing = false;
  }
}

// ============================================================================
// RENDER - LIVE MODE
// ============================================================================

function renderTokenHighlights(editor: vscode.TextEditor, analysis: FileProbs): void {
  const decorationsByRank: Record<string, vscode.DecorationOptions[]> = {
    confident: [],
    unsure: [],
    confused: [],
    lost: []
  };
  
  for (const line of analysis.lines) {
    const lineText = editor.document.lineAt(line.line_number - 1).text;
    let searchPos = 0;
    
    for (const tok of line.tokens) {
      if (tok.logprob === 0) continue;
      if (!tok.token.trim()) continue;
      
      const category = logprobToCategory(tok.logprob);
      const trimmed = tok.token.trim();
      const tokenPos = lineText.indexOf(trimmed, searchPos);
      
      if (tokenPos >= 0) {
        const range = new vscode.Range(
          line.line_number - 1,
          tokenPos,
          line.line_number - 1,
          tokenPos + trimmed.length
        );
        
        decorationsByRank[category].push({
          range,
          hoverMessage: createTokenHover(tok, category)
        });
        
        searchPos = tokenPos + trimmed.length;
      }
    }
  }
  
  for (const [category, decorations] of Object.entries(decorationsByRank)) {
    if (decorations.length === 0) continue;
    
    const color = RANK_COLORS[category].bg;
    const rulerColor = RANK_COLORS[category].bar;
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      overviewRulerColor: rulerColor,
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });
    
    editor.setDecorations(decorationType, decorations);
    tokenDecorationTypes.push(decorationType);
  }
}

function renderSidebar(editor: vscode.TextEditor, analysis: FileProbs): void {
  const lineScores = new Map<number, number>();
  
  for (const line of analysis.lines) {
    if (line.tokens.length === 0) continue;
    
    const meaningfulTokens = line.tokens.filter(t => t.logprob !== 0);
    if (meaningfulTokens.length === 0) continue;
    
    const avgLogprob = meaningfulTokens.reduce((sum, t) => sum + t.logprob, 0) / meaningfulTokens.length;
    lineScores.set(line.line_number - 1, avgLogprob);
  }
  
  for (const [lineNum, avgLogprob] of lineScores) {
    const category = logprobToCategory(avgLogprob);
    const color = RANK_COLORS[category].bar;
    
    const svg = createColoredBarSvg(color);
    const svgBase64 = Buffer.from(svg).toString('base64');
    const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${svgBase64}`);
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: uri,
      gutterIconSize: 'contain'
    });
    
    const range = new vscode.Range(lineNum, 0, lineNum, 0);
    editor.setDecorations(decorationType, [{ range }]);
    tokenDecorationTypes.push(decorationType);
  }
}

function renderGhost(
  editor: vscode.TextEditor, 
  position: vscode.Position,
  ghostData: GhostResponse | null
): void {
  // DEMO MODE: Always show ghost if there's an alternative prediction
  if (!ghostData) return;
  
  const ghostText = ghostData.secondary.token;
  if (!ghostText || ghostText === '\n' || ghostText.startsWith('\n')) return;
  
  // Don't show if secondary is same as primary
  if (ghostText.trim() === ghostData.primary.token.trim()) return;
  
  const displayText = ghostText.trim() || ghostText;
  const primaryText = ghostData.primary.token.trim();
  
  // Find the current word at cursor
  const lineText = editor.document.lineAt(position.line).text;
  let wordStart = position.character;
  let wordEnd = position.character;
  
  // Find word boundaries
  while (wordStart > 0 && /\w/.test(lineText[wordStart - 1])) {
    wordStart--;
  }
  while (wordEnd < lineText.length && /\w/.test(lineText[wordEnd])) {
    wordEnd++;
  }
  
  const currentWord = lineText.substring(wordStart, wordEnd);
  if (!currentWord) return;
  
  // HIGHLIGHT the token being replaced (yellow background)
  currentWordDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 235, 59, 0.4)',
    borderColor: 'rgba(255, 235, 59, 0.8)',
    borderStyle: 'solid',
    borderWidth: '1px'
  });
  
  const wordRange = new vscode.Range(position.line, wordStart, position.line, wordEnd);
  editor.setDecorations(currentWordDecorationType, [{
    range: wordRange,
    hoverMessage: new vscode.MarkdownString(`Current word: \`${currentWord}\``)
  }]);
  tokenDecorationTypes.push(currentWordDecorationType);
  
  // GHOST at RIGHT END of line - ALWAYS VISIBLE (no fading)
  // Format: "word → ghost"
  const lineEnd = lineText.length;
  const ghostDisplay = `${currentWord} → ${displayText}`;
  
  ghostDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: ghostDisplay,
      color: 'rgba(150, 150, 150, 0.8)',  // GREY, always visible
      fontStyle: 'italic',
      margin: '0 0 0 20px'  // Space from end of line
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
  });
  
  // Position at END of line
  const range = new vscode.Range(position.line, lineEnd, position.line, lineEnd);
  
  const hoverText = `**Ghost Token** (Alternative)\n\nPosition: \`${currentWord}\`\nTop: \`${primaryText}\`\nAlt: \`${displayText}\`\nMargin: ${ghostData.margin.toFixed(3)}`;
  
  editor.setDecorations(ghostDecorationType, [{
    range,
    hoverMessage: new vscode.MarkdownString(hoverText)
  }]);
}

function renderSaliency(editor: vscode.TextEditor, saliencyData: SaliencyResponse | null): void {
  if (!saliencyData?.tokens.length) return;
  
  const topTokens = saliencyData.tokens
    .filter(t => t.klDivergence > 0.001)
    .sort((a, b) => b.klDivergence - a.klDivergence)
    .slice(0, 5);
  
  if (topTokens.length === 0) return;
  
  const maxKL = topTokens[0].klDivergence;
  
  for (const token of topTokens) {
    if (token.line < 1 || token.line > editor.document.lineCount) continue;
    
    const lineText = editor.document.lineAt(token.line - 1).text;
    const tokenLength = token.tokenText.length;
    
    if (token.character < 0 || token.character + tokenLength > lineText.length) continue;
    
    const range = new vscode.Range(
      token.line - 1,
      token.character,
      token.line - 1,
      token.character + tokenLength
    );
    
    // HIGHLY VISIBLE: Gold underline + glow
    const intensity = token.klDivergence / maxKL;
    const glowOpacity = 0.3 + (intensity * 0.5);
    const borderAlpha = 0.6 + intensity * 0.4;
    const bgAlpha = 0.1 + intensity * 0.15;
    const blurRadius = 4 + intensity * 6;
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      borderColor: `rgba(255, 215, 0, ${borderAlpha})`,
      borderStyle: 'solid',
      borderWidth: '0 0 2px 0',
      backgroundColor: `rgba(255, 215, 0, ${bgAlpha})`
    });
    
    const hoverText = `**SALIENT TOKEN**\n\nToken: \`${token.tokenText}\`\nSaliency: ${token.klDivergence.toFixed(4)}\n\nThis token significantly influences the model's prediction!`;
    
    editor.setDecorations(decorationType, [{
      range,
      hoverMessage: new vscode.MarkdownString(hoverText)
    }]);
    
    saliencyDecorationTypes.push(decorationType);
  }
}

// ============================================================================
// RENDER - PRECOMPUTED MODE
// ============================================================================

function renderTokenHighlightsFromPrecomputed(editor: vscode.TextEditor): void {
  const tokenRanks = getPrecomputedTokenRanks();
  if (!tokenRanks) return;
  
  const decorationsByRank: Record<string, vscode.DecorationOptions[]> = {
    confident: [],
    unsure: [],
    confused: [],
    lost: []
  };
  
  const code = editor.document.getText();
  const lines = code.split('\n');
  
  let currentLine = 0;
  let lineStartPos = 0;
  
  for (const tok of tokenRanks) {
    while (currentLine < lines.length && tok.position >= lineStartPos + lines[currentLine].length + 1) {
      lineStartPos += lines[currentLine].length + 1;
      currentLine++;
    }
    
    if (currentLine >= lines.length) break;
    
    const charInLine = tok.position - lineStartPos;
    const tokenLength = tok.token.length;
    
    let category = 'confident';
    if (tok.rank >= 5) category = 'lost';
    else if (tok.rank >= 4) category = 'confused';
    else if (tok.rank >= 2) category = 'unsure';
    
    const range = new vscode.Range(currentLine, charInLine, currentLine, charInLine + tokenLength);
    
    decorationsByRank[category].push({
      range,
      hoverMessage: new vscode.MarkdownString(`Rank: ${tok.rank}, Logprob: ${tok.logprob.toFixed(3)}`)
    });
  }
  
  for (const [category, decorations] of Object.entries(decorationsByRank)) {
    if (decorations.length === 0) continue;
    
    const color = RANK_COLORS[category].bg;
    const rulerColor = RANK_COLORS[category].bar;
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      overviewRulerColor: rulerColor,
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });
    
    editor.setDecorations(decorationType, decorations);
    tokenDecorationTypes.push(decorationType);
  }
}

function renderSidebarFromPrecomputed(editor: vscode.TextEditor): void {
  const tokenRanks = getPrecomputedTokenRanks();
  if (!tokenRanks) return;
  
  const code = editor.document.getText();
  const lines = code.split('\n');
  const lineScores: number[] = new Array(lines.length).fill(0);
  const lineCounts: number[] = new Array(lines.length).fill(0);
  
  let currentLine = 0;
  let lineStartPos = 0;
  
  for (const tok of tokenRanks) {
    while (currentLine < lines.length && tok.position >= lineStartPos + lines[currentLine].length + 1) {
      lineStartPos += lines[currentLine].length + 1;
      currentLine++;
    }
    
    if (currentLine < lines.length) {
      lineScores[currentLine] += tok.logprob;
      lineCounts[currentLine]++;
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    if (lineCounts[i] === 0) continue;
    
    const avgLogprob = lineScores[i] / lineCounts[i];
    const category = logprobToCategory(avgLogprob);
    const color = RANK_COLORS[category].bar;
    
    const svg = createColoredBarSvg(color);
    const svgBase64 = Buffer.from(svg).toString('base64');
    const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${svgBase64}`);
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: uri,
      gutterIconSize: 'contain'
    });
    
    const range = new vscode.Range(i, 0, i, 0);
    editor.setDecorations(decorationType, [{ range }]);
    tokenDecorationTypes.push(decorationType);
  }
}

function renderGhostFromPrecomputed(editor: vscode.TextEditor, position: vscode.Position): void {
  const ghostData = getPrecomputedGhost(position.line + 1, position.character);
  
  // DEMO MODE: Always show ghost if there's an alternative prediction
  if (!ghostData) return;
  
  const ghostText = ghostData.secondary.token;
  if (!ghostText || ghostText === '\n' || ghostText.startsWith('\n')) return;
  
  // Don't show if secondary is same as primary
  if (ghostText.trim() === ghostData.primary.token.trim()) return;
  
  const displayText = ghostText.trim() || ghostText;
  
  // Find the current word at cursor
  const lineText = editor.document.lineAt(position.line).text;
  let wordStart = position.character;
  let wordEnd = position.character;
  
  while (wordStart > 0 && /\w/.test(lineText[wordStart - 1])) {
    wordStart--;
  }
  while (wordEnd < lineText.length && /\w/.test(lineText[wordEnd])) {
    wordEnd++;
  }
  
  const currentWord = lineText.substring(wordStart, wordEnd);
  if (!currentWord) return;
  
  // HIGHLIGHT the token being replaced
  currentWordDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 235, 59, 0.4)',
    borderColor: 'rgba(255, 235, 59, 0.8)',
    borderStyle: 'solid',
    borderWidth: '1px'
  });
  
  const wordRange = new vscode.Range(position.line, wordStart, position.line, wordEnd);
  editor.setDecorations(currentWordDecorationType, [{
    range: wordRange,
    hoverMessage: new vscode.MarkdownString(`Current: \`${currentWord}\``)
  }]);
  tokenDecorationTypes.push(currentWordDecorationType);
  
  // GHOST at RIGHT END - ALWAYS VISIBLE, GREY
  const lineEnd = lineText.length;
  const ghostDisplay = `${currentWord} → ${displayText}`;
  
  ghostDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: ghostDisplay,
      color: 'rgba(150, 150, 150, 0.8)',
      fontStyle: 'italic',
      margin: '0 0 0 20px'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
  });
  
  const range = new vscode.Range(position.line, lineEnd, position.line, lineEnd);
  
  editor.setDecorations(ghostDecorationType, [{
    range,
    hoverMessage: new vscode.MarkdownString(`Ghost: ${displayText}`)
  }]);
}

function renderSaliencyFromPrecomputed(editor: vscode.TextEditor, position: vscode.Position): void {
  const saliencyData = getPrecomputedSaliency(position.line + 1, position.character);
  if (!saliencyData?.tokens.length) return;
  
  const topTokens = saliencyData.tokens
    .filter(t => t.klDivergence > 0.001)
    .sort((a, b) => b.klDivergence - a.klDivergence)
    .slice(0, 5);
  
  if (topTokens.length === 0) return;
  
  const maxKL = topTokens[0].klDivergence;
  
  for (const token of topTokens) {
    if (token.line < 1 || token.line > editor.document.lineCount) continue;
    
    const lineText = editor.document.lineAt(token.line - 1).text;
    const tokenLength = token.tokenText.length;
    
    if (token.character < 0 || token.character + tokenLength > lineText.length) continue;
    
    const range = new vscode.Range(
      token.line - 1,
      token.character,
      token.line - 1,
      token.character + tokenLength
    );
    
    const intensity = token.klDivergence / maxKL;
    const borderAlpha = 0.6 + intensity * 0.4;
    const bgAlpha = 0.1 + intensity * 0.15;
    
    const decorationType = vscode.window.createTextEditorDecorationType({
      borderColor: `rgba(255, 215, 0, ${borderAlpha})`,
      borderStyle: 'solid',
      borderWidth: '0 0 2px 0',
      backgroundColor: `rgba(255, 215, 0, ${bgAlpha})`
    });
    
    const hoverText = `**SALIENT** ${token.tokenText}: ${token.klDivergence.toFixed(4)}`;
    
    editor.setDecorations(decorationType, [{
      range,
      hoverMessage: new vscode.MarkdownString(hoverText)
    }]);
    
    saliencyDecorationTypes.push(decorationType);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function logprobToCategory(logprob: number): string {
  if (logprob >= LOGPROB_RANGES.confident.min && logprob < LOGPROB_RANGES.confident.max) {
    return 'confident';
  } else if (logprob >= LOGPROB_RANGES.unsure.min && logprob < LOGPROB_RANGES.unsure.max) {
    return 'unsure';
  } else if (logprob >= LOGPROB_RANGES.confused.min && logprob < LOGPROB_RANGES.confused.max) {
    return 'confused';
  } else {
    return 'lost';
  }
}

function createColoredBarSvg(color: string): string {
  return `<svg width="6" height="16" xmlns="http://www.w3.org/2000/svg">
    <rect width="6" height="16" fill="${color}" rx="1"/>
  </svg>`;
}

function createTokenHover(tok: TokenProb, category: string): vscode.MarkdownString {
  const indicators: Record<string, string> = {
    confident: 'OK',
    unsure: '??',
    confused: '!',
    lost: 'XX'
  };
  
  const text = `${indicators[category] || ''} ${category.toUpperCase()} | Token: ${tok.token} | Logprob: ${tok.logprob.toFixed(3)}`;
  return new vscode.MarkdownString(text);
}

function clearDecorations(editor: vscode.TextEditor): void {
  for (const dt of tokenDecorationTypes) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  tokenDecorationTypes = [];
  
  for (const dt of saliencyDecorationTypes) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  saliencyDecorationTypes = [];
  
  if (ghostDecorationType) {
    editor.setDecorations(ghostDecorationType, []);
    ghostDecorationType.dispose();
    ghostDecorationType = null;
  }
  
  if (currentWordDecorationType) {
    editor.setDecorations(currentWordDecorationType, []);
    currentWordDecorationType.dispose();
    currentWordDecorationType = null;
  }
}

// ============================================================================
// SCRIPTED DEMO COMMANDS
// ============================================================================

const SCRIPTED_COLORS = {
  green: { bg: 'rgba(76, 175, 80, 0.4)', bar: '#4CAF50' },
  yellow: { bg: 'rgba(255, 193, 7, 0.4)', bar: '#FFC107' },
  orange: { bg: 'rgba(255, 152, 0, 0.45)', bar: '#FF9800' },
  red: { bg: 'rgba(244, 67, 54, 0.5)', bar: '#F44336' },
};

function scriptedHighlight(highlights: Array<{
  line: number;
  startChar: number;
  endChar: number;
  color: 'green' | 'yellow' | 'orange' | 'red';
  tooltip?: string;
}>): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // Clear existing scripted highlights
  for (const dt of scriptedHighlightDecorations) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  scriptedHighlightDecorations = [];
  
  // Group by color
  const byColor: Record<string, typeof highlights> = { green: [], yellow: [], orange: [], red: [] };
  for (const h of highlights) {
    byColor[h.color].push(h);
  }
  
  // Create decorations for each color
  for (const [color, items] of Object.entries(byColor)) {
    if (items.length === 0) continue;
    
    const colorDef = SCRIPTED_COLORS[color as keyof typeof SCRIPTED_COLORS];
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: colorDef.bg,
      overviewRulerColor: colorDef.bar,
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });
    
    const decorations: vscode.DecorationOptions[] = items.map(h => ({
      range: new vscode.Range(h.line, h.startChar, h.line, h.endChar),
      hoverMessage: h.tooltip ? new vscode.MarkdownString(h.tooltip) : undefined
    }));
    
    editor.setDecorations(decorationType, decorations);
    scriptedHighlightDecorations.push(decorationType);
  }
}

function scriptedGhost(ghost: {
  line: number;
  afterChar: number;
  text: string;
  tooltip: string;
}): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // Clear existing ghost
  if (scriptedGhostDecoration) {
    editor.setDecorations(scriptedGhostDecoration, []);
    scriptedGhostDecoration.dispose();
    scriptedGhostDecoration = null;
  }
  
  scriptedGhostDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: ghost.text,
      color: 'rgba(150, 150, 150, 0.9)',
      fontStyle: 'italic'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
  });
  
  const range = new vscode.Range(ghost.line, ghost.afterChar, ghost.line, ghost.afterChar);
  editor.setDecorations(scriptedGhostDecoration, [{
    range,
    hoverMessage: new vscode.MarkdownString(ghost.tooltip)
  }]);
}

function scriptedSaliency(saliency: Array<{
  line: number;
  startChar: number;
  endChar: number;
  intensity: 'low' | 'medium' | 'high';
  tooltip: string;
}>): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // Clear existing saliency
  for (const dt of scriptedSaliencyDecorations) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  scriptedSaliencyDecorations = [];
  
  const intensityColors = {
    low: { border: 'rgba(255, 215, 0, 0.4)', bg: 'rgba(255, 215, 0, 0.05)' },
    medium: { border: 'rgba(255, 215, 0, 0.7)', bg: 'rgba(255, 215, 0, 0.12)' },
    high: { border: 'rgba(255, 215, 0, 1.0)', bg: 'rgba(255, 215, 0, 0.2)' },
  };
  
  for (const s of saliency) {
    const colors = intensityColors[s.intensity];
    const decorationType = vscode.window.createTextEditorDecorationType({
      borderColor: colors.border,
      borderStyle: 'solid',
      borderWidth: '0 0 3px 0',
      backgroundColor: colors.bg
    });
    
    const range = new vscode.Range(s.line, s.startChar, s.line, s.endChar);
    editor.setDecorations(decorationType, [{
      range,
      hoverMessage: new vscode.MarkdownString(s.tooltip)
    }]);
    
    scriptedSaliencyDecorations.push(decorationType);
  }
}

function clearScriptedDemo(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // Clear scripted highlights
  for (const dt of scriptedHighlightDecorations) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  scriptedHighlightDecorations = [];
  
  // Clear scripted ghost
  if (scriptedGhostDecoration) {
    editor.setDecorations(scriptedGhostDecoration, []);
    scriptedGhostDecoration.dispose();
    scriptedGhostDecoration = null;
  }
  
  // Clear scripted saliency
  for (const dt of scriptedSaliencyDecorations) {
    editor.setDecorations(dt, []);
    dt.dispose();
  }
  scriptedSaliencyDecorations = [];
}

export function deactivateUnifiedHud(): void {
  if (timeout) clearTimeout(timeout);
  const editor = vscode.window.activeTextEditor;
  if (editor) clearDecorations(editor);
}
