/**
 * Demo Mode FAST - For debugging
 * 
 * Same demo but 2x faster. Use this to test without waiting.
 */

import * as vscode from 'vscode';

let isRunning = false;
let abortController: AbortController | null = null;
let terminal1: vscode.Terminal | null = null;
let terminal2: vscode.Terminal | null = null;

interface DemoScene {
  action: 'type' | 'pause' | 'highlight' | 'ghost' | 'saliency' | 'clear_highlights' | 'mode' | 'terminal_create' | 'terminal_type' | 'terminal_show';
  text?: string;
  terminalId?: 1 | 2;
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

// FAST VERSION - all delays halved
const DEMO_SCENES: DemoScene[] = [
  // 2.5 second delay before starting (half of 5)
  { action: 'pause', delay: 2500, desc: 'Demo starting...' },
  
  // ========== PART 1: HUD DEMO ==========
  { action: 'mode', mode: 'baseline', desc: 'PART 1: HUD Demo' },
  { action: 'type', text: "def calculate(x, y):\n    return x / y", delay: 50, charDelay: 40 },
  { action: 'pause', delay: 400 },
  
  { action: 'mode', mode: 'entropy', desc: 'High uncertainty' },
  { action: 'pause', delay: 200 },
  
  { action: 'highlight', 
    highlights: [
      { line: 0, startChar: 14, endChar: 15, color: 'red', tooltip: 'No type hint' },
      { line: 0, startChar: 17, endChar: 18, color: 'red', tooltip: 'No type hint' },
    ],
  },
  { action: 'pause', delay: 1250 },
  
  { action: 'highlight',
    highlights: [
      { line: 0, startChar: 14, endChar: 15, color: 'red' },
      { line: 0, startChar: 17, endChar: 18, color: 'red' },
      { line: 1, startChar: 14, endChar: 15, color: 'orange', tooltip: 'Ambiguous division' },
    ],
  },
  { action: 'pause', delay: 1250 },
  
  { action: 'clear_highlights' },
  { action: 'type', text: "\n\ndef combine(a, b):\n    return a ", delay: 50, charDelay: 35 },
  { action: 'mode', mode: 'ghost' },
  { action: 'pause', delay: 150 },
  
  { action: 'ghost', 
    ghost: { line: 5, afterChar: 14, text: '+ b', tooltip: 'Ghost: + b' },
  },
  { action: 'pause', delay: 1500 },
  
  { action: 'mode', mode: 'ghost' },
  { action: 'type', text: '- b', delay: 50, charDelay: 50 },
  { action: 'pause', delay: 1000 },
  
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline' },
  { action: 'pause', delay: 400 },
  
  { action: 'type', text: '\n\n# With types:', delay: 50, charDelay: 30 },
  { action: 'type', text: '\ndef calculate(x: int, y: int) -> int:\n    return x / y', delay: 50, charDelay: 35 },
  { action: 'pause', delay: 250 },
  
  { action: 'mode', mode: 'entropy' },
  { action: 'highlight',
    highlights: [
      { line: 6, startChar: 14, endChar: 15, color: 'green' },
      { line: 6, startChar: 22, endChar: 23, color: 'green' },
      { line: 6, startChar: 28, endChar: 31, color: 'green' },
      { line: 7, startChar: 14, endChar: 15, color: 'green' },
    ],
  },
  { action: 'pause', delay: 1500 },
  
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline' },
  { action: 'pause', delay: 1000 },
  
  { action: 'type', text: '\n\ndef analyze(data):\n    result = []\n    for item in data:\n        if item > 0:\n            result.append(item * 2)\n    return result', delay: 25, charDelay: 25 },
  { action: 'pause', delay: 250 },
  
  { action: 'mode', mode: 'saliency' },
  { action: 'pause', delay: 250 },
  
  { action: 'saliency',
    saliency: [
      { line: 13, startChar: 10, endChar: 16, intensity: 'high', tooltip: 'High influence' },
      { line: 12, startChar: 12, endChar: 20, intensity: 'medium', tooltip: 'Medium influence' },
      { line: 11, startChar: 8, endChar: 12, intensity: 'low', tooltip: 'Low influence' },
    ],
  },
  { action: 'pause', delay: 1000 },
  
  { action: 'type', text: '\n\n# Gold underline = influences predictions', delay: 50, charDelay: 25 },
  { action: 'pause', delay: 1250 },
  
  // ========== PART 2: TERMINALS ==========
  { action: 'clear_highlights' },
  { action: 'mode', mode: 'baseline' },
  { action: 'pause', delay: 500 },
  
  { action: 'terminal_create', terminalId: 1 },
  { action: 'pause', delay: 400 },
  { action: 'terminal_type', terminalId: 1, text: 'If you want to go fast, go alone.', delay: 50, charDelay: 30 },
  { action: 'pause', delay: 1000 },
  
  { action: 'terminal_create', terminalId: 2 },
  { action: 'pause', delay: 600 },
  { action: 'terminal_type', terminalId: 2, text: 'If you want to go far, go together.', delay: 50, charDelay: 30 },
  { action: 'pause', delay: 1000 },
  
  { action: 'terminal_show', terminalId: 1 },
  { action: 'pause', delay: 250 },
  { action: 'terminal_show', terminalId: 2 },
  { action: 'pause', delay: 750 },
  
  { action: 'terminal_show', terminalId: 1 },
  { action: 'terminal_type', terminalId: 1, text: '\nHeads Up: Think, Together.', delay: 50, charDelay: 25 },
  { action: 'pause', delay: 1000 },
  
  { action: 'mode', mode: 'baseline', desc: 'Demo Complete' },
];

export function activateDemoModeFast(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cerebrasHud.startDemoFast', startDemo),
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
  
  vscode.window.showInformationMessage('🎬 Starting FAST Demo (2x speed)...');
  
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
    
    if (terminal1) { terminal1.dispose(); terminal1 = null; }
    if (terminal2) { terminal2.dispose(); terminal2 = null; }
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
    
    switch (scene.action) {
      case 'type':
        if (scene.text) {
          await typewrite(editor, signal, scene.text, scene.charDelay || 40);
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
        
      case 'terminal_create':
        if (scene.terminalId === 1) {
          terminal1 = vscode.window.createTerminal('Terminal 1');
          terminal1.show();
        } else if (scene.terminalId === 2) {
          terminal2 = vscode.window.createTerminal('Terminal 2');
          terminal2.show();
        }
        if (scene.delay) await sleep(scene.delay);
        break;
        
      case 'terminal_type':
        const term = scene.terminalId === 1 ? terminal1 : terminal2;
        if (term && scene.text) {
          for (const char of scene.text) {
            if (signal.aborted) throw new Error('ABORTED');
            term.sendText(char, false);
            await sleep(scene.charDelay || 30);
          }
        }
        if (scene.delay) await sleep(scene.delay);
        break;
        
      case 'terminal_show':
        const termShow = scene.terminalId === 1 ? terminal1 : terminal2;
        if (termShow) termShow.show();
        if (scene.delay) await sleep(scene.delay);
        break;
    }
  }
  
  vscode.window.showInformationMessage('✨ Fast Demo Complete!');
}

async function typewrite(
  editor: vscode.TextEditor, 
  signal: AbortSignal, 
  text: string, 
  charDelay: number
): Promise<void> {
  for (const char of text) {
    if (signal.aborted) throw new Error('ABORTED');
    await editor.edit(editBuilder => { editBuilder.insert(editor.selection.active, char); });
    await sleep(charDelay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivateDemoModeFast(): void {
  stopDemo();
}
