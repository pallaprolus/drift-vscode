import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type DriftStatus = 'Synced' | 'Drifted' | 'Untracked';

interface DriftState {
    [filePath: string]: {
        [symbolName: string]: string; // hash
    };
}

export class DriftManager {
    private state: DriftState = {};
    private stateFilePath: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.initializeState();
    }

    private initializeState() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const driftDir = path.join(rootPath, '.drift');
        this.stateFilePath = path.join(driftDir, 'state.json');

        if (!fs.existsSync(driftDir)) {
            fs.mkdirSync(driftDir);
        }

        if (fs.existsSync(this.stateFilePath)) {
            try {
                const content = fs.readFileSync(this.stateFilePath, 'utf-8');
                this.state = JSON.parse(content);
            } catch (e) {
                console.error('Failed to load drift state:', e);
                this.state = {};
            }
        }
    }

    private saveState() {
        if (this.stateFilePath) {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
        }
    }

    public calculateHash(text: string): string {
        // Normalize: remove whitespace to avoid formatting false positives
        const normalized = text.replace(/\s+/g, '');
        return crypto.createHash('sha256').update(normalized).digest('hex');
    }

    public getDriftStatus(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): DriftStatus {
        const filePath = vscode.workspace.asRelativePath(document.uri);
        const symbolName = symbol.name;

        // Get the function/class body text
        // We assume the symbol range covers the entire definition
        const bodyText = document.getText(symbol.range);
        const currentHash = this.calculateHash(bodyText);

        const fileState = this.state[filePath];
        if (!fileState || !fileState[symbolName]) {
            return 'Untracked';
        }

        const storedHash = fileState[symbolName];
        return currentHash === storedHash ? 'Synced' : 'Drifted';
    }

    public updateState(document: vscode.TextDocument, symbol: vscode.DocumentSymbol) {
        const filePath = vscode.workspace.asRelativePath(document.uri);
        const symbolName = symbol.name;
        const bodyText = document.getText(symbol.range);
        const currentHash = this.calculateHash(bodyText);

        if (!this.state[filePath]) {
            this.state[filePath] = {};
        }

        this.state[filePath][symbolName] = currentHash;
        this.saveState();
    }
}
