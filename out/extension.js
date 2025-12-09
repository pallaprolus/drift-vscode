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
const workspaceScanner_1 = require("./analyzers/workspaceScanner");
const dashboardProvider_1 = require("./providers/dashboardProvider");
const decorationProvider_1 = require("./providers/decorationProvider");
const codeLensProvider_1 = require("./providers/codeLensProvider");
const stateManager_1 = require("./providers/stateManager");
const helpers_1 = require("./utils/helpers");
const logger_1 = require("./utils/logger");
let scanner;
let dashboardProvider;
let decorationProvider;
let codeLensProvider;
let stateManager;
/**
 * Extension activation
 */
async function activate(context) {
    logger_1.DriftLogger.initialize('Drift');
    logger_1.DriftLogger.log('Drift extension activated');
    // Load configuration
    const config = loadConfig();
    // Initialize state manager
    stateManager = new stateManager_1.StateManager();
    await stateManager.initialize();
    // Initialize components
    scanner = new workspaceScanner_1.WorkspaceScanner(config);
    dashboardProvider = new dashboardProvider_1.DriftDashboardProvider();
    decorationProvider = new decorationProvider_1.DecorationProvider();
    codeLensProvider = new codeLensProvider_1.DriftCodeLensProvider(stateManager);
    // Register the tree view
    const treeView = vscode.window.createTreeView('driftDashboard', {
        treeDataProvider: dashboardProvider,
        showCollapseAll: true
    });
    // Register CodeLens provider
    const codeLensDisposable = vscode.languages.registerCodeLensProvider([
        { language: 'typescript' },
        { language: 'javascript' },
        { language: 'typescriptreact' },
        { language: 'javascriptreact' },
        { language: 'python' }
    ], codeLensProvider);
    // Register commands
    registerCommands(context);
    // Register event listeners
    registerEventListeners(context, config);
    // Add disposables
    context.subscriptions.push(treeView, codeLensDisposable, { dispose: () => decorationProvider.dispose() });
    // Initial scan of open documents
    await scanOpenDocuments();
    // Check for welcome message - Disabled until feedback form is ready
    // checkWelcomeMessage(context);
    // Send activation ping (telemetry)
    sendActivationPing(context);
    logger_1.DriftLogger.log('Drift extension ready');
}
/**
 * Load configuration from VS Code settings
 */
function loadConfig() {
    const config = vscode.workspace.getConfiguration('drift');
    return {
        enableGutterIcons: config.get('enableGutterIcons', true),
        enableInlineDecorations: config.get('enableInlineDecorations', true),
        excludePatterns: config.get('excludePatterns', [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.git/**'
        ]),
        supportedLanguages: config.get('supportedLanguages', [
            'javascript',
            'typescript',
            'javascriptreact',
            'typescriptreact',
            'python'
        ]),
        driftThreshold: config.get('driftThreshold', 0.3)
    };
}
/**
 * Register all commands
 */
function registerCommands(context) {
    // Scan workspace command
    context.subscriptions.push(vscode.commands.registerCommand('drift.scanWorkspace', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Drift: Scanning workspace...',
            cancellable: false
        }, async (progress) => {
            const pairs = await scanner.scanWorkspace(progress);
            dashboardProvider.updatePairs(pairs);
            updateDecorationsForVisibleEditors();
            updateCodeLensForVisibleEditors();
            // Update state manager with scan time
            stateManager.setLastFullScan(new Date());
            await stateManager.saveState();
            const stats = dashboardProvider.getStatistics();
            vscode.window.showInformationMessage(`Drift scan complete: ${stats.total} potential issues found ` +
                `(${stats.critical} critical, ${stats.high} high, ${stats.medium} medium, ${stats.low} low)`);
            vscode.window.showInformationMessage(`Drift scan complete: ${stats.total} potential issues found ` +
                `(${stats.critical} critical, ${stats.high} high, ${stats.medium} medium, ${stats.low} low)`);
            logger_1.DriftLogger.log(`Scan complete: ${pairs.length} doc-code pairs analyzed`);
        });
    }));
    // Scan current file command
    context.subscriptions.push(vscode.commands.registerCommand('drift.scanCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }
        const pairs = await scanner.scanDocument(editor.document);
        // Update dashboard with all results
        const allPairs = scanner.getAllResults();
        dashboardProvider.updatePairs(allPairs);
        // Update decorations and CodeLens
        updateDecorationsForEditor(editor, pairs);
        codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
        const driftPairs = pairs.filter(p => p.driftScore >= loadConfig().driftThreshold);
        if (driftPairs.length > 0) {
            vscode.window.showInformationMessage(`Drift: Found ${driftPairs.length} potential documentation issues in this file`);
        }
        else {
            vscode.window.showInformationMessage('Drift: No documentation issues found in this file');
        }
    }));
    // Mark as reviewed command
    context.subscriptions.push(vscode.commands.registerCommand('drift.markAsReviewed', async (args) => {
        let pairId = args?.id;
        if (!pairId) {
            // Try to get from selection in tree view or current position
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const pairs = scanner.getResultsForFile(editor.document.uri.fsPath);
                if (pairs) {
                    const currentLine = editor.selection.active.line;
                    const pair = pairs.find(p => p.docRange.start.line <= currentLine &&
                        p.codeRange.end.line >= currentLine);
                    if (pair) {
                        pairId = pair.id;
                    }
                }
            }
        }
        if (pairId) {
            dashboardProvider.markAsReviewed(pairId);
            // Get the pair and update state
            const pair = dashboardProvider.getPairById(pairId);
            if (pair) {
                stateManager.markAsReviewed(pair);
                await stateManager.saveState();
            }
            updateDecorationsForVisibleEditors();
            codeLensProvider.refresh();
            vscode.window.showInformationMessage('Documentation marked as reviewed');
        }
    }));
    // Track pair command (from CodeLens)
    context.subscriptions.push(vscode.commands.registerCommand('drift.trackPair', async (pair) => {
        stateManager.updatePairState(pair);
        await stateManager.saveState();
        codeLensProvider.refresh();
        vscode.window.showInformationMessage(`Now tracking drift for "${pair.codeSignature.name}"`);
    }));
    // Review and sync command (from CodeLens)
    context.subscriptions.push(vscode.commands.registerCommand('drift.reviewAndSync', async (pair) => {
        stateManager.markAsReviewed(pair);
        await stateManager.saveState();
        dashboardProvider.markAsReviewed(pair.id);
        updateDecorationsForVisibleEditors();
        codeLensProvider.refresh();
        vscode.window.showInformationMessage(`Documentation for "${pair.codeSignature.name}" marked as synced`);
    }));
    // Show drift details command (from CodeLens)
    context.subscriptions.push(vscode.commands.registerCommand('drift.showDriftDetails', async (pair) => {
        const items = pair.driftReasons.map(reason => ({
            label: `$(warning) ${reason.message}`,
            description: reason.details,
            detail: `Severity: ${reason.severity}`
        }));
        const selected = await vscode.window.showQuickPick(items, {
            title: `Drift Details for ${pair.codeSignature.name}`,
            placeHolder: 'Select an issue to see details'
        });
        if (selected) {
            // Could navigate to specific issue location in future
        }
    }));
    // Show dashboard command
    context.subscriptions.push(vscode.commands.registerCommand('drift.showDashboard', () => {
        vscode.commands.executeCommand('driftDashboard.focus');
    }));
    // Refresh dashboard command
    context.subscriptions.push(vscode.commands.registerCommand('drift.refreshDashboard', async () => {
        await vscode.commands.executeCommand('drift.scanWorkspace');
    }));
    // Share feedback command - Disabled until feedback form is ready
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('drift.shareFeedback', async () => {
    //         const feedbackUrl = 'https://forms.google.com/your-form-link'; // Placeholder
    //         await vscode.env.openExternal(vscode.Uri.parse(feedbackUrl));
    //     })
    // );
    // Go to code command (used in hover messages)
    context.subscriptions.push(vscode.commands.registerCommand('drift.goToCode', async (args) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && args?.line !== undefined) {
            const position = new vscode.Position(args.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }));
}
/**
 * Register event listeners
 */
function registerEventListeners(context, config) {
    // Debounced document change handler
    const debouncedScan = (0, helpers_1.debounce)(async (document) => {
        const pairs = await scanner.scanDocument(document);
        // Update dashboard
        const allPairs = scanner.getAllResults();
        dashboardProvider.updatePairs(allPairs);
        // Update decorations for this document
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
        if (editor) {
            updateDecorationsForEditor(editor, pairs);
            codeLensProvider.updatePairs(document.uri.toString(), pairs);
        }
    }, 1000);
    // Document change listener
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
            debouncedScan(event.document);
        }
    }));
    // Document open listener
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (document) => {
        const pairs = await scanner.scanDocument(document);
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
        if (editor) {
            updateDecorationsForEditor(editor, pairs);
            codeLensProvider.updatePairs(document.uri.toString(), pairs);
        }
    }));
    // Active editor change listener
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor) {
            let pairs = scanner.getResultsForFile(editor.document.uri.fsPath);
            if (!pairs) {
                pairs = await scanner.scanDocument(editor.document);
            }
            updateDecorationsForEditor(editor, pairs);
            codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
        }
    }));
    // Configuration change listener
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('drift')) {
            const newConfig = loadConfig();
            scanner.updateConfig(newConfig);
            updateDecorationsForVisibleEditors();
            codeLensProvider.refresh();
        }
    }));
    // Document save listener
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        const pairs = await scanner.scanDocument(document);
        const allPairs = scanner.getAllResults();
        dashboardProvider.updatePairs(allPairs);
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
        if (editor) {
            updateDecorationsForEditor(editor, pairs);
            codeLensProvider.updatePairs(document.uri.toString(), pairs);
        }
    }));
    // Document close listener - clean up CodeLens
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        codeLensProvider.clearPairs(document.uri.toString());
    }));
}
/**
 * Scan all currently open documents
 */
async function scanOpenDocuments() {
    for (const editor of vscode.window.visibleTextEditors) {
        const pairs = await scanner.scanDocument(editor.document);
        updateDecorationsForEditor(editor, pairs);
        codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
    }
    const allPairs = scanner.getAllResults();
    dashboardProvider.updatePairs(allPairs);
}
/**
 * Update decorations for a specific editor
 */
function updateDecorationsForEditor(editor, pairs) {
    const config = loadConfig();
    decorationProvider.applyDecorations(editor, pairs, {
        enableGutter: config.enableGutterIcons,
        enableInline: config.enableInlineDecorations,
        threshold: config.driftThreshold
    });
}
/**
 * Update decorations for all visible editors
 */
function updateDecorationsForVisibleEditors() {
    for (const editor of vscode.window.visibleTextEditors) {
        const pairs = scanner.getResultsForFile(editor.document.uri.fsPath) || [];
        updateDecorationsForEditor(editor, pairs);
    }
}
/**
 * Update CodeLens for all visible editors
 */
function updateCodeLensForVisibleEditors() {
    for (const editor of vscode.window.visibleTextEditors) {
        const pairs = scanner.getResultsForFile(editor.document.uri.fsPath) || [];
        codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
    }
}
/**
 * Extension deactivation
 */
async function deactivate() {
    // Save any pending state changes
    if (stateManager?.hasPendingChanges()) {
        await stateManager.saveState();
    }
    decorationProvider?.clearAllDecorations();
    logger_1.DriftLogger.log('Drift extension deactivated');
    logger_1.DriftLogger.dispose();
}
/**
 * Check if welcome message should be shown
 */
async function checkWelcomeMessage(context) {
    const hasShownWelcome = context.globalState.get('drift.hasShownWelcome', false);
    if (!hasShownWelcome) {
        const selection = await vscode.window.showInformationMessage('If Drift saves you time, please help me by sharing your story here.', 'Share Feedback', 'Dismiss');
        if (selection === 'Share Feedback') {
            vscode.commands.executeCommand('drift.shareFeedback');
        }
        await context.globalState.update('drift.hasShownWelcome', true);
    }
}
/**
 * Send activation ping (telemetry)
 */
async function sendActivationPing(context) {
    // Check if telemetry is enabled
    if (!vscode.env.isTelemetryEnabled) {
        return;
    }
    // Simple activation ping - replace with actual endpoint
    // const telemetryUrl = 'https://your-telemetry-endpoint.com/activate';
    // try {
    //     await fetch(telemetryUrl, { method: 'POST' });
    // } catch (e) {
    //     // Ignore telemetry errors
    // }
    //     await fetch(telemetryUrl, { method: 'POST' });
    // } catch (e) {
    //     // Ignore telemetry errors
    // }
    logger_1.DriftLogger.log('Telemetry: Activation ping sent (simulated)');
}
//# sourceMappingURL=extension.js.map