import * as vscode from 'vscode';
import { DocCodePair, DocType, DriftType } from '../models/types';
import { StateManager } from './stateManager';

/**
 * Provides CodeLens actions above documentation blocks
 */
export class DriftCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    
    private pairs: Map<string, DocCodePair[]> = new Map();
    private stateManager: StateManager;
    private aiEnabled: () => boolean;
    
    constructor(stateManager: StateManager, aiEnabled: () => boolean = () => false) {
        this.stateManager = stateManager;
        this.aiEnabled = aiEnabled;
    }
    
    /**
     * Update pairs for a document
     */
    updatePairs(uri: string, pairs: DocCodePair[]): void {
        this.pairs.set(uri, pairs);
        this._onDidChangeCodeLenses.fire();
    }
    
    /**
     * Clear pairs for a document
     */
    clearPairs(uri: string): void {
        this.pairs.delete(uri);
        this._onDidChangeCodeLenses.fire();
    }
    
    /**
     * Refresh all CodeLenses
     */
    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
    
    /**
     * Provide CodeLenses for a document
     */
    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const documentPairs = this.pairs.get(document.uri.toString());
        if (!documentPairs) {
            return [];
        }
        
        const codeLenses: vscode.CodeLens[] = [];
        const aiEnabled = this.aiEnabled();
        
        for (const pair of documentPairs) {
            // README code blocks: only surface the drift summary
            if (pair.docType === DocType.ReadmeCodeBlock) {
                if (pair.driftScore > 0 && !pair.isReviewed) {
                    const mdRange = new vscode.Range(pair.docRange.start.line, 0, pair.docRange.start.line, 0);
                    codeLenses.push(new vscode.CodeLens(mdRange, {
                        title: `$(warning) ${Math.round(pair.driftScore * 100)}% drift: ${pair.driftReasons[0]?.message ?? 'out of sync with code'}`,
                        tooltip: pair.driftReasons.map(r => r.message).join('\n'),
                        command: 'drift.showDriftDetails',
                        arguments: [pair]
                    }));
                    codeLenses.push(new vscode.CodeLens(mdRange, {
                        title: '$(check) Mark as Reviewed',
                        command: 'drift.markAsReviewed',
                        arguments: [{ id: pair.id }]
                    }));
                }
                continue;
            }

            const status = this.stateManager.getTrackingStatus(pair);
            const range = new vscode.Range(
                pair.docRange.start.line,
                0,
                pair.docRange.start.line,
                0
            );
            
            // Create CodeLens based on status
            if (status === 'untracked') {
                // Untracked: Show "Track Drift" button
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(eye) Track Drift',
                    tooltip: 'Start tracking this documentation for drift',
                    command: 'drift.trackPair',
                    arguments: [pair]
                }));
            } else if (status === 'drifted' || pair.driftScore > 0) {
                // Drifted: Show "Review & Sync" button
                codeLenses.push(new vscode.CodeLens(range, {
                    title: `$(sync) Review & Sync`,
                    tooltip: 'Mark documentation as reviewed and sync with current code',
                    command: 'drift.reviewAndSync',
                    arguments: [pair]
                }));
                
                // Also show drift score
                if (pair.driftScore > 0) {
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: `$(warning) ${Math.round(pair.driftScore * 100)}% drift detected`,
                        tooltip: pair.driftReasons.map(r => r.message).join('\n'),
                        command: 'drift.showDriftDetails',
                        arguments: [pair]
                    }));
                }
            } else if (status === 'synced') {
                // Synced: Show green checkmark
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(check) Synced',
                    tooltip: 'Documentation is in sync with code',
                    command: ''
                }));
            }

            if (aiEnabled && !pair.isReviewed) {
                const hasAiResult = pair.driftReasons.some(r => r.type === DriftType.SemanticMismatch);
                codeLenses.push(new vscode.CodeLens(range, {
                    title: hasAiResult ? '$(sparkle) AI: drift found' : '$(sparkle) AI Check',
                    tooltip: hasAiResult
                        ? 'AI detected semantic drift. Click to re-run the check.'
                        : 'Ask an AI model whether this documentation still describes the code',
                    command: 'drift.analyzeSemantic',
                    arguments: [pair]
                }));
            }
        }
        
        return codeLenses;
    }
    
    /**
     * Resolve CodeLens (optional - for lazy loading of commands)
     */
    resolveCodeLens(
        codeLens: vscode.CodeLens,
        _token: vscode.CancellationToken
    ): vscode.CodeLens {
        return codeLens;
    }
}
