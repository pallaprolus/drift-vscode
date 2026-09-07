import { CodeSignature, DocCodePair, SymbolEntry } from '../models/types';

/**
 * In-memory index of code symbols (functions, methods, classes) discovered
 * while parsing the workspace. Used to cross-reference README / Markdown
 * code blocks against the real code.
 */
export class SymbolIndex {
    private byName: Map<string, SymbolEntry[]> = new Map();
    private byFile: Map<string, SymbolEntry[]> = new Map();

    /**
     * Replace all symbols recorded for a file with the given pairs.
     */
    updateFile(filePath: string, pairs: DocCodePair[]): void {
        this.removeFile(filePath);

        const entries: SymbolEntry[] = pairs.map(pair => ({
            name: pair.codeSignature.name,
            filePath,
            line: pair.codeRange.start.line,
            signature: pair.codeSignature
        }));

        this.byFile.set(filePath, entries);
        for (const entry of entries) {
            const key = entry.name.toLowerCase();
            const list = this.byName.get(key) || [];
            list.push(entry);
            this.byName.set(key, list);
        }
    }

    /**
     * Add raw signatures for a file (for files without documentation blocks).
     */
    addSignatures(filePath: string, signatures: { signature: CodeSignature; line: number }[]): void {
        const existing = this.byFile.get(filePath) || [];
        for (const { signature, line } of signatures) {
            if (existing.some(e => e.name === signature.name && e.line === line)) {
                continue;
            }
            const entry: SymbolEntry = { name: signature.name, filePath, line, signature };
            existing.push(entry);
            const key = signature.name.toLowerCase();
            const list = this.byName.get(key) || [];
            list.push(entry);
            this.byName.set(key, list);
        }
        this.byFile.set(filePath, existing);
    }

    removeFile(filePath: string): void {
        const entries = this.byFile.get(filePath);
        if (!entries) {
            return;
        }
        for (const entry of entries) {
            const key = entry.name.toLowerCase();
            const list = (this.byName.get(key) || []).filter(e => e.filePath !== filePath);
            if (list.length === 0) {
                this.byName.delete(key);
            } else {
                this.byName.set(key, list);
            }
        }
        this.byFile.delete(filePath);
    }

    lookup(name: string): SymbolEntry[] {
        return this.byName.get(name.toLowerCase()) || [];
    }

    has(name: string): boolean {
        return this.byName.has(name.toLowerCase());
    }

    allNames(): string[] {
        const names = new Set<string>();
        for (const entries of this.byName.values()) {
            for (const entry of entries) {
                names.add(entry.name);
            }
        }
        return Array.from(names);
    }

    size(): number {
        return this.byName.size;
    }

    isEmpty(): boolean {
        return this.byName.size === 0;
    }

    clear(): void {
        this.byName.clear();
        this.byFile.clear();
    }
}
