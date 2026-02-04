"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const unifiedHud_1 = require("./features/unifiedHud");
const demoMode_1 = require("./features/demoMode");
const demoModeFast_1 = require("./features/demoModeFast");
/**
 * Extension activation.
 */
function activate(context) {
    console.log('Cerebras HUD: Activating...');
    // Initialize unified HUD
    (0, unifiedHud_1.activateUnifiedHud)(context);
    // Initialize demo modes
    (0, demoMode_1.activateDemoMode)(context);
    (0, demoModeFast_1.activateDemoModeFast)(context);
    console.log('Cerebras HUD: Activated successfully');
}
/**
 * Extension deactivation.
 */
function deactivate() {
    (0, unifiedHud_1.deactivateUnifiedHud)();
    (0, demoMode_1.deactivateDemoMode)();
    (0, demoModeFast_1.deactivateDemoModeFast)();
}
