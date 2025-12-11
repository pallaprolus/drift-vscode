import * as assert from 'assert';
import * as vscode from 'vscode';
import { PythonParser } from '../../../parsers/pythonParser';
import { DocType } from '../../../models/types';

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
