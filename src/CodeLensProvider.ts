import * as vscode from 'vscode';
import { DriftManager } from './DriftManager';

export class DriftCodeLensProvider implements vscode.CodeLensProvider {
    private driftManager: DriftManager;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(driftManager: DriftManager) {
        this.driftManager = driftManager;
    }

    public refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        if (document.languageId !== 'typescript' && document.languageId !== 'javascript') {
            return [];
        }

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
        if (!symbols) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];

        const processSymbol = (symbol: vscode.DocumentSymbol) => {
            const status = this.driftManager.getDriftStatus(document, symbol);
            const range = new vscode.Range(symbol.range.start, symbol.range.start);

            if (status === 'Untracked') {
                const command: vscode.Command = {
                    title: 'Track Drift',
                    command: 'drift.track',
                    arguments: [document, symbol]
                };
                codeLenses.push(new vscode.CodeLens(range, command));
            } else if (status === 'Drifted') {
                const command: vscode.Command = {
                    title: 'Review & Sync',
                    command: 'drift.sync',
                    arguments: [document, symbol]
                };
                codeLenses.push(new vscode.CodeLens(range, command));
            }

            if (symbol.children) {
                symbol.children.forEach(processSymbol);
            }
        };

        symbols.forEach(processSymbol);
        return codeLenses;
    }
}
