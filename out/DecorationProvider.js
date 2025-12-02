"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecorationProvider = void 0;
const vscode = require("vscode");
class DecorationProvider {
    constructor(driftManager) {
        this.driftManager = driftManager;
        this.syncedDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iIzRjYWY1MCI+PHBhdGggZD0iTTEzLjUgMmwtNy41IDcuNS0zLjUtMy41LTEuNSAxLjUgNSA1IDktOXoiLz48L3N2Zz4='),
            gutterIconSize: 'contain',
            overviewRulerColor: 'green',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        this.driftedDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iI2ZmOTgwMCI+PHBhdGggZD0iTTEgMTNoMTRsLTctMTJ6bTAgMWgxNHYxaC0xNHoiLz48L3N2Zz4='),
            gutterIconSize: 'contain',
            textDecoration: 'wavy underline orange',
            overviewRulerColor: 'orange',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }
    updateDecorations(editor) {
        if (!editor) {
            return;
        }
        const document = editor.document;
        // Only process supported languages
        if (document.languageId !== 'typescript' && document.languageId !== 'javascript') {
            return;
        }
        vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)
            .then(symbols => {
            if (!symbols) {
                return;
            }
            const syncedRanges = [];
            const driftedRanges = [];
            const processSymbol = (symbol) => {
                // Check if the symbol has a doc comment (simplified check: look at lines before)
                // For MVP, we'll just check the symbol itself against the manager
                // In a real implementation, we'd parse comments more robustly.
                // Here we assume the symbol range *includes* the doc comment if the provider includes it,
                // or we just decorate the symbol definition line.
                const status = this.driftManager.getDriftStatus(document, symbol);
                const decorationOption = {
                    range: new vscode.Range(symbol.range.start, symbol.range.start), // Gutter icon on the first line
                    hoverMessage: status === 'Drifted' ? '⚠️ Code has changed since this doc was last reviewed.' : 'Documentation is in sync.'
                };
                // If we want to underline the whole block or just the signature:
                // For drifted, let's underline the first line of the definition
                const lineRange = document.lineAt(symbol.range.start.line).range;
                decorationOption.range = lineRange;
                if (status === 'Synced') {
                    syncedRanges.push(decorationOption);
                }
                else if (status === 'Drifted') {
                    driftedRanges.push(decorationOption);
                }
                if (symbol.children) {
                    symbol.children.forEach(processSymbol);
                }
            };
            symbols.forEach(processSymbol);
            editor.setDecorations(this.syncedDecorationType, syncedRanges);
            editor.setDecorations(this.driftedDecorationType, driftedRanges);
        });
    }
}
exports.DecorationProvider = DecorationProvider;
//# sourceMappingURL=DecorationProvider.js.map