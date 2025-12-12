import * as assert from 'assert';
import * as vscode from 'vscode';
import { PythonParser } from '../../../parsers/pythonParser';
import { DocType } from '../../../models/types';


class MockTextDocument {
    content: string;
    uri: { fsPath: string };
    fileName: string;
    languageId: string;
    lineCount: number;

    constructor(content: string) {
        this.content = content;
        this.uri = { fsPath: '/test/file.py' };
        this.fileName = 'file.py';
        this.languageId = 'python';
        this.lineCount = content.split('\n').length;
    }

    getText(): string {
        return this.content;
    }

    positionAt(offset: number): vscode.Position {
        return new vscode.Position(0, 0);
    }

    offsetAt(position: vscode.Position): number {
        return 0;
    }

    validateRange(range: vscode.Range): vscode.Range {
        return range;
    }

    lineAt(line: number | vscode.Position): vscode.TextLine {
        return {
            lineNumber: 0,
            text: '',
            range: new vscode.Range(0, 0, 0, 0),
            rangeIncludingLineBreak: new vscode.Range(0, 0, 0, 0),
            firstNonWhitespaceCharacterIndex: 0,
            isEmptyOrWhitespace: false
        } as vscode.TextLine;
    }
}

suite('PythonParser Tests', () => {
    let parser: PythonParser;

    setup(() => {
        parser = new PythonParser();
    });

    test('should identify Python files', () => {
        const doc = {
            languageId: 'python',
            fileName: 'test.py'
        };
        // Internal check simulation if needed, or just rely on class property
        assert.strictEqual(parser.languageId, 'python');
    });

    test('should parse complex multi-line signature with unions', () => {
        const content = `
    def autocontrast(
        image: Image.Image,
        cutoff: float | tuple[float, float] = 0,
        ignore: int | Sequence[int] | None = None,
        mask: Image.Image | None = None,
        preserve_tone: bool = False,
    ) -> Image.Image:
        """
        Maximize (normalize) image contrast.

        :param image: The image to process.
        :param cutoff: Cutoff percentage.
        :param ignore: Values to ignore.
        :param mask: Mask image.
        :param preserve_tone: Preserve image tone.
        :return: An image.
        """
        pass
        `;
        const document = new MockTextDocument(content);
        return parser.parseDocCodePairs(document as any).then(pairs => {
            assert.strictEqual(pairs.length, 1);
            const pair = pairs[0];

            // Check drift reasons - should be empty if code matches docs
            assert.strictEqual(pair.driftReasons.length, 0, 'Should not have drift reasons');

            // Verify code params extraction
            const codeParams = pair.codeSignature.parameters;
            assert.strictEqual(codeParams.length, 5, 'Should find 5 parameters in code');
            assert.strictEqual(codeParams[0].name, 'image');
            assert.strictEqual(codeParams[1].name, 'cutoff');
            assert.strictEqual(codeParams[2].name, 'ignore');
            assert.strictEqual(codeParams[3].name, 'mask');
            assert.strictEqual(codeParams[4].name, 'preserve_tone');
        });
    });

    test('should parse Sphinx-style docstrings (:param name:)', () => {
        const docContent = `"""
        Resizes an image.

        :param image: The image to resize.
        :param size: The target size.
        :return: The resized image.
        """`;

        const parsed = parser.parseDocumentation(docContent, DocType.PyDoc);

        assert.strictEqual(parsed.params.length, 2, 'Should find 2 parameters');
        assert.strictEqual(parsed.params[0].name, 'image');
        assert.strictEqual(parsed.params[1].name, 'size');
    });

    test('should parse NumPy-style docstrings', () => {
        const docContent = `"""
        Resizes an image.

        Parameters
        ----------
        image : Image
            The image to resize.
        size : tuple
            The target size.
        """`;

        const parsed = parser.parseDocumentation(docContent, DocType.PyDoc);

        assert.strictEqual(parsed.params.length, 2, 'Should find 2 parameters');
        assert.strictEqual(parsed.params[0].name, 'image');
        assert.strictEqual(parsed.params[0].type, 'Image');
        assert.strictEqual(parsed.params[1].name, 'size');
        assert.strictEqual(parsed.params[1].type, 'tuple');
    });

    test('should parse Google-style docstrings (Args:)', () => {
        const docContent = `"""
        Resizes an image.

        Args:
            image: The image to resize.
            size: The target size.
        """`;

        const parsed = parser.parseDocumentation(docContent, DocType.PyDoc);

        assert.strictEqual(parsed.params.length, 2, 'Should find 2 parameters');
        assert.strictEqual(parsed.params[0].name, 'image');
    });
});
