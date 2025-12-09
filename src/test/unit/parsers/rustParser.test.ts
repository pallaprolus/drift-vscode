import * as assert from 'assert';
import * as vscode from 'vscode';
import { RustParser } from '../../../parsers/rustParser';
import { DocType } from '../../../models/types';

suite('RustParser Tests', () => {
    let parser: RustParser;

    setup(() => {
        parser = new RustParser();
    });

    test('should identify Rust files', () => {
        assert.strictEqual(parser.languageId, 'rust');
        assert.deepStrictEqual(parser.fileExtensions, ['.rs']);
    });

    test('should parse function with doc comments', async () => {
        const content = `
/// Calculates the factorial of a number
///
/// # Arguments
///
/// * \`n\` - The number to calculate factorial for
fn factorial(n: u64) -> u64 {
    if n == 0 { 1 } else { n * factorial(n - 1) }
}`;
        // Mock TextDocument
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.rs'),
            lineCount: 9,
            lineAt: (line: number) => ({
                text: content.split('\n')[line],
                lineNumber: line
            })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        assert.strictEqual(pairs[0].docType, DocType.RustDoc);
        assert.ok(pairs[0].docContent.includes('Calculates the factorial'));
        assert.strictEqual(pairs[0].codeSignature.name, 'factorial');
        // Args usually get parsed into description by BaseParser, but let's check signature extraction
        assert.strictEqual(pairs[0].codeSignature.parameters.length, 1);
        assert.strictEqual(pairs[0].codeSignature.parameters[0].name, 'n');
        assert.strictEqual(pairs[0].codeSignature.parameters[0].type, 'u64');
        assert.strictEqual(pairs[0].codeSignature.returnType, 'u64');
    });

    test('should parse public function with pub modifier', async () => {
        const content = `
/// Public function
pub fn process() {
}`;
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.rs'),
            lineCount: 4,
            lineAt: (line: number) => ({ text: content.split('\n')[line] })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        assert.strictEqual(pairs[0].codeSignature.name, 'process');
        assert.ok(pairs[0].codeSignature.modifiers.includes('public'));
    });

    test('should skip attribute lines', async () => {
        const content = `
/// Function with attribute
#[no_mangle]
pub extern "C" fn exported_function() {
}`;
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.rs'),
            lineCount: 5,
            lineAt: (line: number) => ({ text: content.split('\n')[line] })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        assert.ok(pairs[0].docContent.includes('Function with attribute'));
        assert.strictEqual(pairs[0].codeSignature.name, 'exported_function');
    });
});
