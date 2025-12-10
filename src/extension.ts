import * as vscode from 'vscode';
import { WorkspaceScanner } from './analyzers/workspaceScanner';
import { DriftDashboardProvider } from './providers/dashboardProvider';
import { DecorationProvider } from './providers/decorationProvider';
import { DriftCodeLensProvider } from './providers/codeLensProvider';
import { StateManager } from './providers/stateManager';
import { DriftConfig, DocCodePair } from './models/types';
import { debounce } from './utils/helpers';

import { DriftLogger } from './utils/logger';

let scanner: WorkspaceScanner;
let dashboardProvider: DriftDashboardProvider;
let decorationProvider: DecorationProvider;
let codeLensProvider: DriftCodeLensProvider;
let stateManager: StateManager;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    DriftLogger.initialize('Drift');
    DriftLogger.log('Drift extension activated');

    // Load configuration
    const config = loadConfig();

    // Initialize state manager
    stateManager = new StateManager();
    await stateManager.initialize();

    // Initialize components
    scanner = new WorkspaceScanner(config);
    dashboardProvider = new DriftDashboardProvider();
    decorationProvider = new DecorationProvider();
    codeLensProvider = new DriftCodeLensProvider(stateManager);

    // Register the tree view
    const treeView = vscode.window.createTreeView('driftDashboard', {
        treeDataProvider: dashboardProvider,
        showCollapseAll: true
    });

    // Register CodeLens provider
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        [
            { language: 'typescript' },
            { language: 'javascript' },
            { language: 'typescriptreact' },
            { language: 'javascriptreact' },
            { language: 'python' }
        ],
        codeLensProvider
    );

    // Register commands
    registerCommands(context);

    // Register event listeners
    registerEventListeners(context, config);

    // Add disposables
    context.subscriptions.push(
        treeView,
        codeLensDisposable,
        { dispose: () => decorationProvider.dispose() }
    );

    // Initial scan of open documents
    await scanOpenDocuments();

    // Check for welcome message - Disabled until feedback form is ready
    // checkWelcomeMessage(context);

    // Send activation ping (telemetry)
    sendActivationPing(context);

    DriftLogger.log('Drift extension ready');
}

/**
 * Load configuration from VS Code settings
 */
function loadConfig(): DriftConfig {
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
function registerCommands(context: vscode.ExtensionContext): void {
    // Scan workspace command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.scanWorkspace', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Drift: Scanning workspace...',
                    cancellable: false
                },
                async (progress) => {
                    const pairs = await scanner.scanWorkspace(progress);
                    dashboardProvider.updatePairs(pairs);
                    updateDecorationsForVisibleEditors();
                    updateCodeLensForVisibleEditors();

                    // Update state manager with scan time
                    stateManager.setLastFullScan(new Date());
                    await stateManager.saveState();

                    const stats = dashboardProvider.getStatistics();
                    vscode.window.showInformationMessage(
                        `Drift scan complete: ${stats.total} potential issues found ` +
                        `(${stats.critical} critical, ${stats.high} high, ${stats.medium} medium, ${stats.low} low)`
                    );

                    // Auto-open dashboard based on user feedback
                    vscode.commands.executeCommand('drift.showDashboard');

                    DriftLogger.log(`Scan complete: ${pairs.length} doc-code pairs analyzed`);
                }
            );
        })
    );

    // Scan current file command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.scanCurrentFile', async () => {
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
                vscode.window.showInformationMessage(
                    `Drift: Found ${driftPairs.length} potential documentation issues in this file`
                );
            } else {
                vscode.window.showInformationMessage('Drift: No documentation issues found in this file');
            }
        })
    );

    // Mark as reviewed command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.markAsReviewed', async (args?: { id?: string }) => {
            let pairId = args?.id;

            if (!pairId) {
                // Try to get from selection in tree view or current position
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pairs = scanner.getResultsForFile(editor.document.uri.fsPath);
                    if (pairs) {
                        const currentLine = editor.selection.active.line;
                        const pair = pairs.find(p =>
                            p.docRange.start.line <= currentLine &&
                            p.codeRange.end.line >= currentLine
                        );
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
        })
    );

    // Track pair command (from CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.trackPair', async (pair: DocCodePair) => {
            stateManager.updatePairState(pair);
            await stateManager.saveState();
            codeLensProvider.refresh();
            vscode.window.showInformationMessage(`Now tracking drift for "${pair.codeSignature.name}"`);
        })
    );

    // Review and sync command (from CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.reviewAndSync', async (pair: DocCodePair) => {
            stateManager.markAsReviewed(pair);
            await stateManager.saveState();

            dashboardProvider.markAsReviewed(pair.id);
            updateDecorationsForVisibleEditors();
            codeLensProvider.refresh();

            vscode.window.showInformationMessage(`Documentation for "${pair.codeSignature.name}" marked as synced`);
        })
    );

    // Show drift details command (from CodeLens)
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.showDriftDetails', async (pair: DocCodePair) => {
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
        })
    );

    // Show dashboard command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.showDashboard', () => {
            vscode.commands.executeCommand('driftDashboard.focus');
        })
    );

    // Refresh dashboard command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.refreshDashboard', async () => {
            await vscode.commands.executeCommand('drift.scanWorkspace');
        })
    );

    // Share feedback command - Disabled until feedback form is ready
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('drift.shareFeedback', async () => {
    //         const feedbackUrl = 'https://forms.google.com/your-form-link'; // Placeholder
    //         await vscode.env.openExternal(vscode.Uri.parse(feedbackUrl));
    //     })
    // );

    // Go to code command (used in hover messages)
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.goToCode', async (args?: { line?: number }) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && args?.line !== undefined) {
                const position = new vscode.Position(args.line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            }
        })
    );
}

/**
 * Register event listeners
 */
function registerEventListeners(context: vscode.ExtensionContext, config: DriftConfig): void {
    // Debounced document change handler
    const debouncedScan = debounce(async (document: vscode.TextDocument) => {
        const pairs = await scanner.scanDocument(document);

        // Update dashboard
        const allPairs = scanner.getAllResults();
        dashboardProvider.updatePairs(allPairs);

        // Update decorations for this document
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === document.uri.toString()
        );
        if (editor) {
            updateDecorationsForEditor(editor, pairs);
            codeLensProvider.updatePairs(document.uri.toString(), pairs);
        }
    }, 1000);

    // Document change listener
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length > 0) {
                debouncedScan(event.document);
            }
        })
    );

    // Document open listener
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            const pairs = await scanner.scanDocument(document);
            const editor = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() === document.uri.toString()
            );
            if (editor) {
                updateDecorationsForEditor(editor, pairs);
                codeLensProvider.updatePairs(document.uri.toString(), pairs);
            }
        })
    );

    // Active editor change listener
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor) {
                let pairs = scanner.getResultsForFile(editor.document.uri.fsPath);
                if (!pairs) {
                    pairs = await scanner.scanDocument(editor.document);
                }
                updateDecorationsForEditor(editor, pairs);
                codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
            }
        })
    );

    // Configuration change listener
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('drift')) {
                const newConfig = loadConfig();
                scanner.updateConfig(newConfig);
                updateDecorationsForVisibleEditors();
                codeLensProvider.refresh();
            }
        })
    );

    // Document save listener
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const pairs = await scanner.scanDocument(document);
            const allPairs = scanner.getAllResults();
            dashboardProvider.updatePairs(allPairs);

            const editor = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() === document.uri.toString()
            );
            if (editor) {
                updateDecorationsForEditor(editor, pairs);
                codeLensProvider.updatePairs(document.uri.toString(), pairs);
            }
        })
    );

    // Document close listener - clean up CodeLens
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            codeLensProvider.clearPairs(document.uri.toString());
        })
    );
}

/**
 * Scan all currently open documents
 */
async function scanOpenDocuments(): Promise<void> {
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
function updateDecorationsForEditor(editor: vscode.TextEditor, pairs: DocCodePair[]): void {
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
function updateDecorationsForVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        const pairs = scanner.getResultsForFile(editor.document.uri.fsPath) || [];
        updateDecorationsForEditor(editor, pairs);
    }
}

/**
 * Update CodeLens for all visible editors
 */
function updateCodeLensForVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        const pairs = scanner.getResultsForFile(editor.document.uri.fsPath) || [];
        codeLensProvider.updatePairs(editor.document.uri.toString(), pairs);
    }
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    // Save any pending state changes
    if (stateManager?.hasPendingChanges()) {
        await stateManager.saveState();
    }

    decorationProvider?.clearAllDecorations();
    DriftLogger.log('Drift extension deactivated');
    DriftLogger.dispose();
}

/**
 * Check if welcome message should be shown
 */
async function checkWelcomeMessage(context: vscode.ExtensionContext): Promise<void> {
    const hasShownWelcome = context.globalState.get<boolean>('drift.hasShownWelcome', false);

    if (!hasShownWelcome) {
        const selection = await vscode.window.showInformationMessage(
            'If Drift saves you time, please help me by sharing your story here.',
            'Share Feedback',
            'Dismiss'
        );

        if (selection === 'Share Feedback') {
            vscode.commands.executeCommand('drift.shareFeedback');
        }

        await context.globalState.update('drift.hasShownWelcome', true);
    }
}

/**
 * Send activation ping (telemetry)
 */
async function sendActivationPing(context: vscode.ExtensionContext): Promise<void> {
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

    DriftLogger.log('Telemetry: Activation ping sent (simulated)');
}
