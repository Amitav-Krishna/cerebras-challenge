import * as vscode from 'vscode';
import { 
  activateUnifiedHud, 
  deactivateUnifiedHud 
} from './features/unifiedHud';
import {
  activateDemoMode,
  deactivateDemoMode
} from './features/demoMode';
import {
  activateDemoModeFast,
  deactivateDemoModeFast
} from './features/demoModeFast';

/**
 * Extension activation.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Cerebras HUD: Activating...');
  
  // Initialize unified HUD
  activateUnifiedHud(context);
  
  // Initialize demo modes
  activateDemoMode(context);
  activateDemoModeFast(context);
  
  console.log('Cerebras HUD: Activated successfully');
}

/**
 * Extension deactivation.
 */
export function deactivate() {
  deactivateUnifiedHud();
  deactivateDemoMode();
  deactivateDemoModeFast();
}
