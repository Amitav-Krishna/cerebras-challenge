/**
 * Demo Mode - FULL automation
 * 
 * Fast typing with pauses for feature reveals
 */

import * as vscode from 'vscode';

let isRunning = false;
let abortController: AbortController | null = null;

interface DemoScene {
  action: 'type' | 'pause' | 'highlight' | 'ghost' | 'saliency' | 'clear_highlights' | 'mode';
  text?: string;
  delay?: number;
  charDelay?: number;
  highlights?: Array<{
    line: number;
    startChar: number;
    endChar: number;
    color: 'green' | 'yellow' | 'orange' | 'red';
    tooltip?: string;
  }>;
  ghost?: {
    line: number;
    afterChar: number;
    text: string;
    tooltip: string;
  };
  saliency?: Array<{
    line: number;
    startChar: number;
    endChar: number;
    intensity: 'low' | 'medium' | 'high';
    tooltip: string;
  }>;
  mode?: 'baseline' | 'entropy' | 'ghost' | 'saliency' | 'focus';
  desc?: string;
}

// Fast typing, pauses for feature reveals
const DEMO_SCENES: DemoScene[] = [
  // 5 second delay before starting
  { action: 'pause', delay: 5000, desc: 'Demo starting in 5 seconds...' },
  
  // ========== PART 1: HUD DEMO ==========
  { action: 'mode', mode: 'baseline', desc: 'PART 1: Cerebras HUD Demo' },
  
  // Type quickly
  { action: 'type', text: "def calculate(x, y):\n    return x / y", delay: 100, charDelay: 50 },
  { action: 'pause', delay: 800 },
  
  // PAUSE before showing entropy highlight
  { action: 'mode', mode: 'entropy', desc: 'Frame 3-4: Without type hints, model is uncertain' },
  { action: 'pause', delay: 2000 },
  
  // RED highlights
  { action: 'highlight', 
    highlights: [
      { line: 0, startChar: 14, endChar: 15, color: 'red', tooltip: 'Uncertain: no type hint' },
      { line: 0, startChar: 17, endChar: 18, color: 'red', tooltip: 'Uncertain: no type hint' },
    ],
    desc: 'Red = model very confused (no type hints)' 
  },
  { action: 'pause', delay: 4000 },
  
  // Orange highlight
  { action: 'highlight',
    highlights: [
      { line: 0, startChar: 14, endChar: 15, color: 'red' },
      { line: 0, startChar: 17, endChar: 18, color: 'red' },
      { line: 1, startChar: 14, endChar: 15, color: 'orange', tooltip: 'Ambiguous: int or float division?' },
    ],
    desc: 'Orange = somewhat uncertain'
  },
  { action: 'pause', delay: 4000 },
  
  // Type next function quickly
  { action: 'clear_highlights' },
  { action: 'type', text: "\n\ndef combine(a, b):\n    return a ", delay: 100, charDelay: 45 },
  
  // PAUSE before ghost appears
  { action: 'mode', mode: 'ghost', desc: 'Frame 6: Writing a combination function' },
  { action: 'pause', delay: 2500 },
  
  // Ghost token (line 4 is "    return a ")
  { action: 'ghost', 
    ghost: { 
      line: 4, 
      afterChar: 14, 
      text: '+ b', 
      tooltip: 'Ghost: model predicts "+ b" (addition)' 
    },
    desc: 'Ghost suggests addition'
  },
  { action: 'pause', delay: 5000 },
  
  // User choice - clear ghost first, then type
  { action: 'clear_highlights', desc: 'Ghost disappears as user types' },
  { action: 'mode', mode: 'ghost', desc: 'Frame 7: User KNOWS they need subtraction' },
  { action: 'type', text: '- b  # User chooses - not +', delay: 100, charDelay: 70 },
  { action: 'pause', delay: 2000 },
  
  // Type type hints version quickly
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline', desc: 'Frame 5: Adding type hints for clarity' },
  { action: 'pause', delay: 800 },
  
  { action: 'type', text: '\n\n# With type hints - model is confident:', delay: 100, charDelay: 40 },
  { action: 'type', text: '\ndef calculate(x: int, y: int) -> int:\n    return x / y', delay: 100, charDelay: 50 },
  { action: 'pause', delay: 500 },
  
  // PAUSE before green highlights
  { action: 'mode', mode: 'entropy', desc: 'Frame 5: With types, entropy decreases' },
  { action: 'pause', delay: 2000 },
  
  // GREEN highlights
  { action: 'highlight',
    highlights: [
      { line: 6, startChar: 14, endChar: 15, color: 'green', tooltip: 'Confident: int type specified' },
      { line: 6, startChar: 22, endChar: 23, color: 'green', tooltip: 'Confident: int type specified' },
      { line: 6, startChar: 28, endChar: 31, color: 'green', tooltip: 'Confident: return type int' },
      { line: 7, startChar: 14, endChar: 15, color: 'green', tooltip: 'Confident: int division' },
    ],
    desc: 'Green = model confident with types!'
  },
  { action: 'pause', delay: 5000 },
  
  // Type analyze function quickly
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline', desc: 'Frame 11: Low entropy state' },
  { action: 'pause', delay: 1500 },
  
  { action: 'type', text: '\n\ndef analyze(data):\n    result = []\n    for item in data:\n        if item > 0:\n            result.append(item * 2)\n    return result', delay: 50, charDelay: 35 },
  { action: 'pause', delay: 500 },
  
  // Saliency (no extra pause needed - it's the finale)
  { action: 'mode', mode: 'saliency', desc: 'Frame 8: Saliency Lens' },
  { action: 'pause', delay: 800 },
  
  { action: 'saliency',
    saliency: [
      { line: 13, startChar: 10, endChar: 16, intensity: 'high', tooltip: 'HIGH saliency: determines return value' },
      { line: 12, startChar: 12, endChar: 20, intensity: 'medium', tooltip: 'MEDIUM saliency: filters items' },
      { line: 11, startChar: 8, endChar: 12, intensity: 'low', tooltip: 'LOW saliency: loop variable' },
    ],
    desc: 'Saliency shows influential tokens'
  },
  { action: 'pause', delay: 5000 },
  
  // ========== END ==========
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline', desc: 'Demo Complete - Cerebras HUD: See the model think' },
];

export function activateDemoMode(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cerebrasHud.startDemo', startDemo),
    vscode.commands.registerCommand('cerebrasHud.stopDemo', stopDemo)
  );
}

async function startDemo(): Promise<void> {
  if (isRunning) {
    vscode.window.showInformationMessage('Demo already running');
    return;
  }
  
  isRunning = true;
  abortController = new AbortController();
  
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Please open a Python file first');
    isRunning = false;
    return;
  }
  
  vscode.window.showInformationMessage('🎬 Starting Cerebras HUD Demo...');
  
  try {
    await editor.edit(editBuilder => {
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
      );
      editBuilder.delete(fullRange);
    });
    
    await runScriptedDemo(editor, abortController.signal);
  } catch (err) {
    if ((err as Error).message === 'ABORTED') {
      vscode.window.showInformationMessage('Demo stopped');
    } else {
      console.error('Demo error:', err);
    }
  } finally {
    isRunning = false;
    abortController = null;
    await vscode.commands.executeCommand('cerebrasHud.setDemoMode', 'normal');
    await vscode.commands.executeCommand('cerebrasHud.clearScriptedDemo', undefined);
  }
}

function stopDemo(): void {
  if (abortController) {
    abortController.abort();
  }
  isRunning = false;
}

async function runScriptedDemo(editor: vscode.TextEditor, signal: AbortSignal): Promise<void> {
  for (const scene of DEMO_SCENES) {
    if (signal.aborted) throw new Error('ABORTED');
    
    if (scene.desc) {
      console.log(`[Demo] ${scene.desc}`);
    }
    
    switch (scene.action) {
      case 'type':
        if (scene.text) {
          await typewrite(editor, signal, scene.text, scene.charDelay || 50);
        }
        if (scene.delay) await sleep(scene.delay);
        break;
        
      case 'pause':
        if (scene.delay) await sleep(scene.delay);
        break;
        
      case 'mode':
        if (scene.mode) {
          await vscode.commands.executeCommand('cerebrasHud.setDemoMode', scene.mode);
        }
        break;
        
      case 'highlight':
        if (scene.highlights) {
          await vscode.commands.executeCommand('cerebrasHud.scriptedHighlight', scene.highlights);
        }
        break;
        
      case 'ghost':
        if (scene.ghost) {
          await vscode.commands.executeCommand('cerebrasHud.scriptedGhost', scene.ghost);
        }
        break;
        
      case 'saliency':
        if (scene.saliency) {
          await vscode.commands.executeCommand('cerebrasHud.scriptedSaliency', scene.saliency);
        }
        break;
        
      case 'clear_highlights':
        await vscode.commands.executeCommand('cerebrasHud.clearScriptedDemo', undefined);
        break;
    }
  }
  
  vscode.window.showInformationMessage('✨ Demo Complete!');
}

async function typewrite(
  editor: vscode.TextEditor, 
  signal: AbortSignal, 
  text: string, 
  charDelay: number
): Promise<void> {
  for (const char of text) {
    if (signal.aborted) throw new Error('ABORTED');
    
    await editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, char);
    });
    
    await sleep(charDelay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivateDemoMode(): void {
  stopDemo();
}
