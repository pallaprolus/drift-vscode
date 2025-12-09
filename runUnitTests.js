const Mocha = require('mocha');
const path = require('path');
const glob = require('glob');

// Mock VS Code module for unit tests
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (request) {
    if (request === 'vscode') {
        return {
            Range: class {
                constructor(startLine, startChar, endLine, endChar) {
                    this.start = { line: startLine, character: startChar };
                    this.end = { line: endLine, character: endChar };
                }
            },
            Uri: {
                file: (path) => ({ fsPath: path, path: path })
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
