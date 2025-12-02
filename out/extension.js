"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const DriftManager_1 = require("./DriftManager");
const DecorationProvider_1 = require("./DecorationProvider");
const CodeLensProvider_1 = require("./CodeLensProvider");
function activate(context) {
    console.log('Drift extension is now active!');
    const driftManager = new DriftManager_1.DriftManager(context);
    const decorationProvider = new DecorationProvider_1.DecorationProvider(driftManager);
    const codeLensProvider = new CodeLensProvider_1.DriftCodeLensProvider(driftManager);
    // Register CodeLens Provider
    context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ language: 'typescript' }, { language: 'javascript' }], codeLensProvider));
    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('drift.track', (document, symbol) => {
        driftManager.updateState(document, symbol);
        codeLensProvider.refresh();
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
            decorationProvider.updateDecorations(vscode.window.activeTextEditor);
        }
        vscode.window.showInformationMessage(`Tracking drift for ${symbol.name}`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('drift.sync', (document, symbol) => {
        driftManager.updateState(document, symbol);
        codeLensProvider.refresh();
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
            decorationProvider.updateDecorations(vscode.window.activeTextEditor);
        }
        vscode.window.showInformationMessage(`Synced drift for ${symbol.name}`);
    }));
    // Event Listeners
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
            decorationProvider.updateDecorations(vscode.window.activeTextEditor);
            codeLensProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            decorationProvider.updateDecorations(editor);
            codeLensProvider.refresh();
        }
    }));
    // Initial update
    if (vscode.window.activeTextEditor) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map