import * as vscode from 'vscode';
import { WorkspaceScanner } from '../analyzers/workspaceScanner';
import { DocCodePair, DriftReason } from '../models/types';

/**
 * Provides Code Actions (Quick Fixes) for detected drift issues
 */
export class QuickFixProvider implements vscode.CodeActionProvider {
    private scanner: WorkspaceScanner;

    constructor(scanner: WorkspaceScanner) {
        this.scanner = scanner;
    }

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        // Get drift results for this file
        const pairs = this.scanner.getResultsForFile(document.uri.fsPath);
        if (!pairs) {
            return [];
        }

        // Find the pair that contains the cursor/selection
        const pair = pairs.find(p =>
            (p.docRange.contains(range.start) || p.codeRange.contains(range.start)) ||
            (range.intersection(new vscode.Range(p.docRange.start, p.codeRange.end)))
        );

        if (!pair || pair.driftReasons.length === 0) {
            return [];
        }

        const actions: vscode.CodeAction[] = [];

        // Generate fixes for each drift reason
        for (const reason of pair.driftReasons) {
            if (reason.message.includes('not documented')) {
                // Handle "Parameter 'x' is not documented"
                const match = reason.message.match(/Parameter '(\w+)' is not documented/);
                if (match) {
                    const paramName = match[1];
                    const action = this.createAddParamAction(document, pair, paramName);
                    if (action) actions.push(action);
                }
            } else if (reason.message.includes('not found in code')) {
                // Handle "Documented parameter 'x' not found in code"
                const match = reason.message.match(/Documented parameter '(\w+)' not found in code/);
                if (match) {
                    const paramName = match[1];
                    const action = this.createRemoveParamAction(document, pair, paramName);
                    if (action) actions.push(action);
                }
            } else if (reason.message.includes('Return type')) {
                // Sync return type
                const action = this.createSyncReturnTypeAction(document, pair);
                if (action) actions.push(action);
            }
        }

        return actions;
    }

    /**
     * Create action to add a missing parameter
     */
    private createAddParamAction(document: vscode.TextDocument, pair: DocCodePair, paramName: string): vscode.CodeAction | null {
        const action = new vscode.CodeAction(`Add missing parameter '${paramName}'`, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();

        // Determine where to insert
        // Simple heuristic: append to end of doc block, before the closing */ or """
        const docLines = pair.docContent.split('\n');
        const lastLineIndex = pair.docRange.end.line;
        const lastLineText = document.lineAt(lastLineIndex).text;

        // Determine format based on language/doc style
        // This is a simplified logic. In real world, we'd check the parser type.
        // For MVP, checking content or file extension.

        let insertText = '';
        let insertPosition: vscode.Position;

        if (document.languageId === 'python') {
            // Python Docstring
            // Insert before the closing quotes
            insertText = `    :param ${paramName}: description\n`;
            // Locate indentation of the closing quotes
            const closingMatch = lastLineText.match(/(\s*)("""|''')/);
            if (closingMatch) {
                insertPosition = new vscode.Position(lastLineIndex, closingMatch.index || 0);
                insertText = closingMatch[1] + `:param ${paramName}: \n`; // Match indentation roughly
            } else {
                // Single line or weird format
                insertPosition = pair.docRange.end;
                insertText = `\n    :param ${paramName}: `;
            }
        } else {
            // JSDoc / JavaDoc / GoDoc / RustDoc
            if (document.languageId === 'go') {
                insertText = `// ${paramName}: \n`;
                insertPosition = pair.docRange.end.translate(0, 1); // Go docs are usually strictly lines. append new line
                // Go is special, docRange might encompass multiple // lines.
                // We typically append to the last line.
                // Actually Go doesn't have a standard param tag... mostly conventionally "param x description"
                return null; // Go Quick Fix not supported yet
            } else if (document.languageId === 'rust') {
                insertText = `/// * \`${paramName}\` - \n`;
                insertPosition = pair.docRange.end.translate(0, 1); // Append new line?
                // Rust is /// ... 
                // We need to insert a new line with ///
                const indent = document.lineAt(pair.docRange.start.line).firstNonWhitespaceCharacterIndex;
                const indentStr = ' '.repeat(indent);
                insertText = `\n${indentStr}/// * \`${paramName}\` - `;
                insertPosition = pair.docRange.end;
            } else {
                // JS/TS/Java (JSDoc styles)
                // Insert before '*/'
                const closingMatch = lastLineText.match(/(\s*)\*\//);
                if (closingMatch) {
                    // Multi-line JSDoc
                    insertPosition = new vscode.Position(lastLineIndex, closingMatch.index || 0);
                    // Try to match indentation of previous lines
                    // Assume ' * @param...'
                    insertText = ` * @param ${paramName} \n${closingMatch[1]}`;
                } else {
                    // Single line /** ... */
                    // Convert to multi-line? Or append?
                    // For now, fail safe or simple append
                    return null;
                }
            }
        }

        action.edit.insert(document.uri, insertPosition, insertText);
        return action;
    }

    /**
     * Create action to remove a stale parameter
     */
    private createRemoveParamAction(document: vscode.TextDocument, pair: DocCodePair, paramName: string): vscode.CodeAction | null {
        const action = new vscode.CodeAction(`Remove stale parameter '${paramName}'`, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();

        // Find the line containing the param
        const lines = pair.docContent.split('\n');
        let lineIndexToDelete = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Naive check: contains @param paramName or :param paramName
            if ((line.includes(`@param ${paramName}`) || line.includes(`:param ${paramName}`) || line.includes(paramName)) &&
                (line.includes('@param') || line.includes(':param') || line.includes('///'))) {
                lineIndexToDelete = i;
                break;
            }
        }

        if (lineIndexToDelete !== -1) {
            const rangeToDelete = document.lineAt(pair.docRange.start.line + lineIndexToDelete).rangeIncludingLineBreak;
            action.edit.delete(document.uri, rangeToDelete);
            return action;
        }

        return null;
    }

    /**
     * Create action to sync return type
     */
    private createSyncReturnTypeAction(document: vscode.TextDocument, pair: DocCodePair): vscode.CodeAction | null {
        // Placeholder for return type sync
        return null;
    }
}
