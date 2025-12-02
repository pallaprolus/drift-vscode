"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriftManager = void 0;
const vscode = require("vscode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
class DriftManager {
    constructor(context) {
        this.state = {};
        this.initializeState();
    }
    initializeState() {
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
            }
            catch (e) {
                console.error('Failed to load drift state:', e);
                this.state = {};
            }
        }
    }
    saveState() {
        if (this.stateFilePath) {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
        }
    }
    calculateHash(text) {
        // Normalize: remove whitespace to avoid formatting false positives
        const normalized = text.replace(/\s+/g, '');
        return crypto.createHash('sha256').update(normalized).digest('hex');
    }
    getDriftStatus(document, symbol) {
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
    updateState(document, symbol) {
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
exports.DriftManager = DriftManager;
//# sourceMappingURL=DriftManager.js.map