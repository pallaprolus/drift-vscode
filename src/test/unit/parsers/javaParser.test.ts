import * as assert from 'assert';
import * as vscode from 'vscode';
import { JavaParser } from '../../../parsers/javaParser';
import { DocType } from '../../../models/types';

suite('JavaParser Tests', () => {
    let parser: JavaParser;

    setup(() => {
        parser = new JavaParser();
    });

    test('should identify Java files', () => {
        assert.strictEqual(parser.languageId, 'java');
        assert.deepStrictEqual(parser.fileExtensions, ['.java']);
    });

    test('should parse method with Javadoc', async () => {
        const content = `
/**
 * Calculates sum
 * @param a First number
 * @param b Second number
 * @return The sum
 */
public int calculateSum(int a, int b) {
    return a + b;
}`;
        // Mock TextDocument
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.java'),
            lineCount: 10,
            lineAt: (line: number) => ({
                text: content.split('\n')[line],
                lineNumber: line
            })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        assert.strictEqual(pairs[0].docType, DocType.JavaDoc);
        assert.strictEqual(pairs[0].codeSignature.name, 'calculateSum');
        assert.strictEqual(pairs[0].codeSignature.returnType, 'int');
        assert.strictEqual(pairs[0].codeSignature.parameters.length, 2);
        assert.strictEqual(pairs[0].codeSignature.parameters[0].name, 'a');
        // Type includes 'int'
        assert.strictEqual(pairs[0].codeSignature.parameters[0].type, 'int');
    });

    test('should handle modifiers and annotations', async () => {
        const content = `
/**
 * Process request
 */
@Override
protected final void processRequest(String req) {
}`;
        const document = {
            getText: () => content,
            uri: vscode.Uri.file('/test.java'),
            lineCount: 7,
            lineAt: (line: number) => ({ text: content.split('\n')[line] })
        } as unknown as vscode.TextDocument;

        const pairs = await parser.parseDocCodePairs(document);

        assert.strictEqual(pairs.length, 1);
        const sig = pairs[0].codeSignature;
        assert.strictEqual(sig.name, 'processRequest');
        assert.strictEqual(sig.returnType, 'void');
        assert.ok(sig.modifiers.includes('protected'));
        assert.ok(sig.modifiers.includes('final'));
    });
});
