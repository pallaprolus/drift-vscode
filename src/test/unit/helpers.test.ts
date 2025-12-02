import * as assert from 'assert';
import { hashContent, calculateSimilarity, extractIdentifiers } from '../../utils/helpers';

suite('Unit Tests: Helpers', () => {
    test('hashContent should generate consistent hashes', () => {
        const content = 'function test() { return true; }';
        const hash1 = hashContent(content);
        const hash2 = hashContent(content);
        assert.strictEqual(hash1, hash2);
    });

    test('hashContent should generate different hashes for different content', () => {
        const hash1 = hashContent('content1');
        const hash2 = hashContent('content2');
        assert.notStrictEqual(hash1, hash2);
    });

    test('calculateSimilarity should return 1 for identical strings', () => {
        const str = 'function test() {}';
        assert.strictEqual(calculateSimilarity(str, str), 1);
    });

    test('calculateSimilarity should return 0 for completely different strings', () => {
        const str1 = 'abc';
        const str2 = 'def';
        assert.strictEqual(calculateSimilarity(str1, str2), 0);
    });

    test('extractIdentifiers should find variable names', () => {
        const code = 'const myVar = 123;';
        const identifiers = extractIdentifiers(code);
        assert.ok(identifiers.includes('myVar'));
        assert.ok(!identifiers.includes('const')); // Keyword
    });
});
