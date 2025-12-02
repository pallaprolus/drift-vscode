import * as vscode from 'vscode';
import { DriftManager } from './DriftManager';
import { DecorationProvider } from './DecorationProvider';
import { DriftCodeLensProvider } from './CodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Drift extension is now active!');

    const driftManager = new DriftManager(context);
    const decorationProvider = new DecorationProvider(driftManager);
    const codeLensProvider = new DriftCodeLensProvider(driftManager);

    // Register CodeLens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [{ language: 'typescript' }, { language: 'javascript' }],
            codeLensProvider
        )
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('drift.track', (document: vscode.TextDocument, symbol: vscode.DocumentSymbol) => {
            driftManager.updateState(document, symbol);
            codeLensProvider.refresh();
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
                decorationProvider.updateDecorations(vscode.window.activeTextEditor);
            }
            vscode.window.showInformationMessage(`Tracking drift for ${symbol.name}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('drift.sync', (document: vscode.TextDocument, symbol: vscode.DocumentSymbol) => {
            driftManager.updateState(document, symbol);
            codeLensProvider.refresh();
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
                decorationProvider.updateDecorations(vscode.window.activeTextEditor);
            }
            vscode.window.showInformationMessage(`Synced drift for ${symbol.name}`);
        })
    );

    // Event Listeners
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
                decorationProvider.updateDecorations(vscode.window.activeTextEditor);
                codeLensProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                decorationProvider.updateDecorations(editor);
                codeLensProvider.refresh();
            }
        })
    );

    // Initial update
    if (vscode.window.activeTextEditor) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}

export function deactivate() { }
