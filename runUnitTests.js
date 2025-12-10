const Mocha = require('mocha');
const path = require('path');
const glob = require('glob');

// Mock VS Code module for unit tests
const Module = require('module');
const originalRequire = Module.prototype.require;

class MockPosition {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
    translate(lineDelta, charDelta) {
        return new MockPosition(this.line + (lineDelta || 0), this.character + (charDelta || 0));
    }
}

class MockRange {
    constructor(startLineOrPos, startCharOrPos, endLine, endChar) {
        if (typeof startLineOrPos === 'object') {
            this.start = startLineOrPos;
            this.end = startCharOrPos;
        } else {
            this.start = new MockPosition(startLineOrPos, startCharOrPos);
            this.end = new MockPosition(endLine, endChar);
        }
    }
    contains(thing) {
        if (!thing) return false;
        const line = thing.line !== undefined ? thing.line : (thing.start ? thing.start.line : undefined);
        if (line === undefined) return false;

        return line >= this.start.line && line <= this.end.line;
    }
    intersection(range) {
        // Mock intersection: just return a range to satisfy types, or undefined if totally disjoint for realism?
        // for valid test, we usually want it to match.
        // Let's implement basic line overlap check
        const startMax = Math.max(this.start.line, range.start.line);
        const endMin = Math.min(this.end.line, range.end.line);
        if (startMax > endMin) return undefined;

        return new MockRange(startMax, 0, endMin, 0); // Simplified
    }
}

Module.prototype.require = function (request) {
    if (request === 'vscode') {
        return {
            Position: MockPosition,
            Range: MockRange,
            Uri: {
                file: (path) => ({ fsPath: path, path: path })
            },
            CodeAction: class {
                constructor(title, kind) { this.title = title; this.kind = kind; }
            },
            CodeActionKind: { QuickFix: 'quick-fix' },
            WorkspaceEdit: class {
                constructor() { this.edits = []; }
                insert(uri, pos, text) { this.edits.push({ type: 'insert', uri, pos, text }); }
                delete(uri, range) { this.edits.push({ type: 'delete', uri, range }); }
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

async function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, 'out/test/unit');

    try {
        const files = await glob.glob('**/*.test.js', { cwd: testsRoot });

        console.log('Found unit tests:', files);

        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        mocha.run(failures => {
            process.exit(failures > 0 ? 1 : 0);
        });
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
