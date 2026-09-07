import * as vscode from 'vscode';
import { WorkspaceScanner } from './analyzers/workspaceScanner';
import { DriftDashboardProvider } from './providers/dashboardProvider';
import { DecorationProvider } from './providers/decorationProvider';
import { DriftCodeLensProvider } from './providers/codeLensProvider';
import { QuickFixProvider } from './providers/quickFixProvider';
import { StateManager } from './providers/stateManager';
import { DriftConfig, DocCodePair, DriftType } from './models/types';
import { debounce } from './utils/helpers';
import { SemanticAnalyzer, ANTHROPIC_KEY_SECRET, DEFAULT_ANTHROPIC_MODEL } from './analyzers/semanticAnalyzer';
import { generateReport, ReportFormat } from './reports/reportGenerator';
import * as path from 'path';
import * as os from 'os';

import { DriftLogger } from './utils/logger';

let scanner: WorkspaceScanner;
let dashboardProvider: DriftDashboardProvider;
let decorationProvider: DecorationProvider;
let codeLensProvider: DriftCodeLensProvider;
let stateManager: StateManager;
let semanticAnalyzer: SemanticAnalyzer;

/**
 * Small API returned from activate() for integration tests and other extensions.
 */
export interface DriftApi {
    getAllResults(): DocCodePair[];
    exportReport(format: ReportFormat, target: vscode.Uri): Promise<void>;
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<DriftApi> {
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
    codeLensProvider = new DriftCodeLensProvider(stateManager, () => loadConfig().aiProvider !== 'off');
    semanticAnalyzer = new SemanticAnalyzer(context.secrets, () => {
        const c = loadConfig();
        return { provider: c.aiProvider, model: c.aiModel };
    });

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
            { language: 'python' },
            { language: 'go' },
            { language: 'rust' },
            { language: 'java' },
            { language: 'markdown' }
        ],
        codeLensProvider
    );

    // Register commands
    registerCommands(context);

    // Register event listeners
    registerEventListeners(context, config);

    // Register QuickFix provider
    const quickFixProvider = new QuickFixProvider(scanner);
    const quickFixSelector = [
        { language: 'typescript', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
        { language: 'python', scheme: 'file' },
        { language: 'java', scheme: 'file' },
        { language: 'go', scheme: 'file' },
        { language: 'rust', scheme: 'file' }
    ];

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            quickFixSelector,
            quickFixProvider,
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

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

    return {
        getAllResults: () => scanner.getAllResults(),
        exportReport: (format, target) => writeReport(format, scanner.getAllResults(), target)
    };
}

/**
 * Generate a report for the given pairs and write it to disk.
 */
async function writeReport(format: ReportFormat, allPairs: DocCodePair[], target: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const config = loadConfig();
    const content = generateReport(format, allPairs, {
        workspaceName: folder?.name ?? 'workspace',
        workspaceRoot: folder?.uri.fsPath ?? '',
        threshold: config.driftThreshold,
        includeReviewed: false,
        gitInfo: scanner.getGitInfo()
    });
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    DriftLogger.log(`Report exported to ${target.fsPath}`);
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
        driftThreshold: config.get('driftThreshold', 0.3),
        scanMarkdown: config.get('scanMarkdown', true),
        markdownPatterns: config.get('markdownPatterns', ['**/README.md', '**/docs/**/*.md']),
        gitEnabled: config.get('git.enabled', true),
        gitStaleDays: config.get('git.staleDays', 30),
        aiProvider: config.get('ai.provider', 'auto'),
        aiModel: config.get('ai.model', DEFAULT_ANTHROPIC_MODEL)
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

    // Export report command
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.exportReport', async (formatArg?: ReportFormat) => {
            const allPairs = scanner.getAllResults();
            if (allPairs.length === 0) {
                const choice = await vscode.window.showInformationMessage(
                    'Drift has no scan results yet. Scan the workspace first?',
                    'Scan Workspace'
                );
                if (choice === 'Scan Workspace') {
                    await vscode.commands.executeCommand('drift.scanWorkspace');
                }
                return;
            }

            let format = formatArg;
            if (!format) {
                const picked = await vscode.window.showQuickPick(
                    [
                        { label: '$(markdown) Markdown', description: 'README-friendly tables (.md)', value: 'markdown' as ReportFormat },
                        { label: '$(browser) HTML', description: 'Self-contained page for sharing (.html)', value: 'html' as ReportFormat },
                        { label: '$(json) JSON', description: 'Machine-readable for CI (.json)', value: 'json' as ReportFormat }
                    ],
                    { title: 'Drift: Export Report', placeHolder: 'Choose a report format' }
                );
                if (!picked) {
                    return;
                }
                format = picked.value;
            }

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            const ext = format === 'markdown' ? 'md' : format;
            const defaultUri = vscode.Uri.file(path.join(workspaceRoot || os.homedir(), `drift-report.${ext}`));

            const target = await vscode.window.showSaveDialog({
                defaultUri,
                title: 'Save Drift report',
                filters: format === 'html'
                    ? { 'HTML': ['html'] }
                    : format === 'json'
                        ? { 'JSON': ['json'] }
                        : { 'Markdown': ['md'] }
            });
            if (!target) {
                return;
            }

            await writeReport(format, allPairs, target);

            const action = await vscode.window.showInformationMessage(
                `Drift report saved to ${path.basename(target.fsPath)}`,
                'Open'
            );
            if (action === 'Open') {
                if (format === 'html') {
                    await vscode.env.openExternal(target);
                } else {
                    await vscode.window.showTextDocument(target);
                }
            }
        })
    );

    // AI semantic analysis for one pair (from CodeLens, hover, or cursor)
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.analyzeSemantic', async (arg?: DocCodePair | { id?: string }) => {
            let pair: DocCodePair | undefined;

            if (arg && 'codeSignature' in arg) {
                pair = arg;
            } else {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pairs = scanner.getResultsForFile(editor.document.uri.fsPath)
                        ?? await scanner.scanDocument(editor.document);
                    const wantedId = arg && 'id' in arg ? arg.id : undefined;
                    const currentLine = editor.selection.active.line;
                    pair = wantedId
                        ? pairs.find(p => p.id === wantedId)
                        : pairs.find(p => p.docRange.start.line <= currentLine && p.codeRange.end.line >= currentLine);
                }
            }

            if (!pair) {
                vscode.window.showWarningMessage('Drift: Place the cursor on a documented function to run an AI check.');
                return;
            }

            await runSemanticAnalysis([pair], `AI check: ${pair.codeSignature.name}`);
        })
    );

    // AI semantic analysis for every documented symbol in the current file
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.analyzeSemanticFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const pairs = scanner.getResultsForFile(editor.document.uri.fsPath)
                ?? await scanner.scanDocument(editor.document);
            const candidates = pairs.filter(p => p.docType !== 'readme' && !p.isReviewed);

            if (candidates.length === 0) {
                vscode.window.showInformationMessage('Drift: No documented symbols to check in this file.');
                return;
            }

            if (candidates.length > 10) {
                const proceed = await vscode.window.showWarningMessage(
                    `Drift will send ${candidates.length} documented symbols to the AI provider. Continue?`,
                    { modal: true },
                    'Continue'
                );
                if (proceed !== 'Continue') {
                    return;
                }
            }

            await runSemanticAnalysis(candidates, `AI check: ${path.basename(editor.document.uri.fsPath)}`);
        })
    );

    // API key management
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.setAnthropicApiKey', async () => {
            const key = await vscode.window.showInputBox({
                title: 'Drift: Anthropic API Key',
                prompt: 'Stored securely in VS Code secret storage. Used only for "AI check" commands.',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'sk-ant-...'
            });
            if (key === undefined) {
                return;
            }
            const trimmed = key.trim();
            if (!trimmed) {
                await context.secrets.delete(ANTHROPIC_KEY_SECRET);
                vscode.window.showInformationMessage('Drift: Anthropic API key cleared.');
                return;
            }
            await context.secrets.store(ANTHROPIC_KEY_SECRET, trimmed);
            vscode.window.showInformationMessage('Drift: Anthropic API key saved.');
            codeLensProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('drift.clearAnthropicApiKey', async () => {
            await context.secrets.delete(ANTHROPIC_KEY_SECRET);
            vscode.window.showInformationMessage('Drift: Anthropic API key cleared.');
        })
    );

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
function registerEventListeners(context: vscode.ExtensionContext, _config: DriftConfig): void {
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
 * Run AI semantic analysis over pairs and merge results into cached scan data.
 */
async function runSemanticAnalysis(pairs: DocCodePair[], title: string): Promise<void> {
    const config = loadConfig();
    if (config.aiProvider === 'off') {
        vscode.window.showWarningMessage('Drift: AI analysis is disabled (drift.ai.provider is "off").');
        return;
    }

    let drifted = 0;
    let checked = 0;
    let lastError: string | undefined;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Drift: ${title}`, cancellable: true },
        async (progress, token) => {
            for (let i = 0; i < pairs.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }
                const pair = pairs[i];
                progress.report({
                    message: pairs.length > 1 ? `${pair.codeSignature.name} (${i + 1}/${pairs.length})` : undefined,
                    increment: (1 / pairs.length) * 100
                });

                try {
                    const result = await semanticAnalyzer.analyzePair(pair, token);
                    checked++;
                    if (result.reasons.length > 0) {
                        drifted++;
                    }
                    mergeSemanticResult(pair, result.reasons);
                } catch (error) {
                    lastError = error instanceof Error ? error.message : String(error);
                    DriftLogger.error(`Semantic analysis failed for ${pair.codeSignature.name}:`, error);
                    if (pairs.length === 1 || /API key|provider|not found/i.test(lastError)) {
                        break;
                    }
                }
            }
        }
    );

    dashboardProvider.updatePairs(scanner.getAllResults());
    updateDecorationsForVisibleEditors();
    updateCodeLensForVisibleEditors();

    if (lastError && checked === 0) {
        const action = await vscode.window.showErrorMessage(`Drift AI check failed: ${lastError}`, 'Set API Key');
        if (action === 'Set API Key') {
            await vscode.commands.executeCommand('drift.setAnthropicApiKey');
        }
        return;
    }

    if (checked === 1 && pairs.length === 1) {
        const pair = scanner.getResultsForFile(pairs[0].filePath)?.find(p => p.id === pairs[0].id) ?? pairs[0];
        const semantic = pair.driftReasons.find(r => r.type === DriftType.SemanticMismatch);
        if (semantic) {
            const action = await vscode.window.showWarningMessage(
                `Drift: ${semantic.message}`,
                'Show Details',
                'Mark as Reviewed'
            );
            if (action === 'Show Details') {
                await vscode.commands.executeCommand('drift.showDriftDetails', pair);
            } else if (action === 'Mark as Reviewed') {
                await vscode.commands.executeCommand('drift.markAsReviewed', { id: pair.id });
            }
        } else {
            vscode.window.showInformationMessage(`Drift: AI found no semantic drift in "${pair.codeSignature.name}".`);
        }
        return;
    }

    const suffix = lastError ? ` (some checks failed: ${lastError})` : '';
    vscode.window.showInformationMessage(
        `Drift: AI checked ${checked} symbol${checked === 1 ? '' : 's'}, ${drifted} with semantic drift${suffix}`
    );
}

/**
 * Replace any previous AI result on a pair with the new reasons and rescore.
 */
function mergeSemanticResult(pair: DocCodePair, reasons: DocCodePair['driftReasons']): void {
    const filePairs = scanner.getResultsForFile(pair.filePath);
    if (!filePairs) {
        return;
    }

    const updated = filePairs.map(p => {
        if (p.id !== pair.id) {
            return p;
        }
        const kept = p.driftReasons.filter(r => r.type !== DriftType.SemanticMismatch);
        const merged = [...kept, ...reasons];
        return {
            ...p,
            driftReasons: merged,
            driftScore: scanner.getAnalyzer().calculateDriftScore(merged),
            lastAnalyzed: new Date()
        };
    });

    scanner.setResultsForFile(pair.filePath, updated);
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
export async function checkWelcomeMessage(context: vscode.ExtensionContext): Promise<void> {
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
async function sendActivationPing(_context: vscode.ExtensionContext): Promise<void> {
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
