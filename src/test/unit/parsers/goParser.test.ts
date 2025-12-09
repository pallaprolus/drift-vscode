import * as assert from 'assert';
import * as vscode from 'vscode';
import { GoParser } from '../../../parsers/goParser';
import { DocType } from '../../../models/types';

suite('GoParser Tests', () => {
    let parser: GoParser;

    setup(() => {
        parser = new GoParser();
    });

    test('should identify Go files', () => {
        assert.strictEqual(parser.languageId, 'go');
        assert.deepStrictEqual(parser.fileExtensions, ['.go']);
    });

    test('should parse simple function with docs', async () => {
        const content = `
// CalculateSum adds two integers
func CalculateSum(a int, b int) int {
    return a + b
}`;
        // Mock TextDocument
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.go'),
            lineCount: 5,
            lineAt: (line: number) => ({
                text: content.split('\n')[line],
                lineNumber: line,
                range: new vscode.Range(line, 0, line, content.split('\n')[line].length)
            })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        assert.strictEqual(pairs[0].docType, DocType.GoDoc);
        assert.ok(pairs[0].docContent.includes('CalculateSum adds two integers'));
        assert.strictEqual(pairs[0].codeSignature.name, 'CalculateSum');
        assert.strictEqual(pairs[0].codeSignature.parameters.length, 2);
        assert.strictEqual(pairs[0].codeSignature.parameters[0].name, 'a');
        assert.strictEqual(pairs[0].codeSignature.parameters[0].type, 'int');
    });

    test('should parse grouped parameters', async () => {
        const content = `
// Process processes inputs
func Process(x, y int, z string) {
}`;
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.go'),
            lineCount: 4,
            lineAt: (line: number) => ({ text: content.split('\n')[line] })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        const params = pairs[0].codeSignature.parameters;

        assert.strictEqual(params.length, 3);
        assert.strictEqual(params[0].name, 'x');
        assert.strictEqual(params[0].type, 'int');
        assert.strictEqual(params[1].name, 'y');
        assert.strictEqual(params[1].type, 'int');
        assert.strictEqual(params[2].name, 'z');
        assert.strictEqual(params[2].type, 'string');
    });

    test('should ignore functions without docs', async () => {
        const content = `
func Undocumented() {
}`;
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.go'),
            lineCount: 3,
            lineAt: (line: number) => ({ text: content.split('\n')[line] })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);
        assert.strictEqual(pairs.length, 0);
    });
});
