"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriftCodeLensProvider = void 0;
const vscode = require("vscode");
class DriftCodeLensProvider {
    constructor(driftManager) {
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
        this.driftManager = driftManager;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
    async provideCodeLenses(document, token) {
        if (document.languageId !== 'typescript' && document.languageId !== 'javascript') {
            return [];
        }
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
        if (!symbols) {
            return [];
        }
        const codeLenses = [];
        const processSymbol = (symbol) => {
            const status = this.driftManager.getDriftStatus(document, symbol);
            const range = new vscode.Range(symbol.range.start, symbol.range.start);
            if (status === 'Untracked') {
                const command = {
                    title: 'Track Drift',
                    command: 'drift.track',
                    arguments: [document, symbol]
                };
                codeLenses.push(new vscode.CodeLens(range, command));
            }
            else if (status === 'Drifted') {
                const command = {
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
exports.DriftCodeLensProvider = DriftCodeLensProvider;
//# sourceMappingURL=CodeLensProvider.js.map