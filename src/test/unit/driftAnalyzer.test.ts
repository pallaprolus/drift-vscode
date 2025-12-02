import * as assert from 'assert';
import { DriftAnalyzer } from '../../analyzers/driftAnalyzer';
import {
    DocCodePair,
    DocType,
    CodeType,
    LanguageParser,
    ParsedDoc,
    CodeSignature,
    DriftType
} from '../../models/types';

// Mock Parser
class MockParser implements LanguageParser {
    languageId = 'mock';
    fileExtensions = ['.mock'];

    parseDocCodePairs(document: any): Promise<DocCodePair[]> {
        throw new Error('Method not implemented.');
    }

    parseDocumentation(content: string, docType: DocType): ParsedDoc {
        // Simple JSON parsing for testing
        try {
            return JSON.parse(content);
        } catch (e) {
            return {
                description: content,
                params: [],
                tags: []
            };
        }
    }

    extractCodeSignature(content: string, range: any): CodeSignature {
        throw new Error('Method not implemented.');
    }
}

suite('Unit Tests: DriftAnalyzer', () => {
    let analyzer: DriftAnalyzer;
    let parser: MockParser;

    setup(() => {
        analyzer = new DriftAnalyzer();
        parser = new MockParser();
    });

    test('should detect parameter mismatch', () => {
        const pair: DocCodePair = {
            id: '1',
            filePath: 'test.ts',
            docRange: {} as any,
            docContent: JSON.stringify({
                description: 'Test function',
                params: [{ name: 'oldParam', type: 'string', description: 'Old param', isOptional: false }],
                tags: []
            }),
            docType: DocType.JSDoc,
            codeRange: {} as any,
            codeContent: 'function test(newParam: string) {}',
            codeSignature: {
                name: 'test',
                type: CodeType.Function,
                parameters: [{ name: 'newParam', type: 'string', isOptional: false, isRest: false }],
                modifiers: [],
                hash: 'hash'
            },
            driftScore: 0,
            driftReasons: [],
            lastAnalyzed: new Date(),
            isReviewed: false
        };

        const result = analyzer.analyzePair(pair, parser);

        assert.ok(result.driftReasons.length > 0);
        const removed = result.driftReasons.find(r => r.type === DriftType.ParameterRemoved);
        const added = result.driftReasons.find(r => r.type === DriftType.ParameterAdded);

        assert.ok(removed, 'Should detect removed parameter');
        assert.ok(added, 'Should detect added parameter');
    });

    test('should detect return type mismatch', () => {
        const pair: DocCodePair = {
            id: '2',
            filePath: 'test.ts',
            docRange: {} as any,
            docContent: JSON.stringify({
                description: 'Test function',
                params: [],
                returns: { type: 'string', description: 'Returns string' },
                tags: []
            }),
            docType: DocType.JSDoc,
            codeRange: {} as any,
            codeContent: 'function test(): number { return 1; }',
            codeSignature: {
                name: 'test',
                type: CodeType.Function,
                parameters: [],
                returnType: 'number',
                modifiers: [],
                hash: 'hash'
            },
            driftScore: 0,
            driftReasons: [],
            lastAnalyzed: new Date(),
            isReviewed: false
        };

        const result = analyzer.analyzePair(pair, parser);

        assert.ok(result.driftReasons.length > 0);
        const mismatch = result.driftReasons.find(r => r.type === DriftType.ReturnTypeMismatch);
        assert.ok(mismatch, 'Should detect return type mismatch');
    });

    test('should detect parameter rename (close match)', () => {
        const pair: DocCodePair = {
            id: '3',
            filePath: 'test.ts',
            docRange: {} as any,
            docContent: JSON.stringify({
                description: 'Test function',
                params: [{ name: 'userId', type: 'string', description: 'User ID', isOptional: false }],
                tags: []
            }),
            docType: DocType.JSDoc,
            codeRange: {} as any,
            codeContent: 'function test(user_id: string) {}',
            codeSignature: {
                name: 'test',
                type: CodeType.Function,
                parameters: [{ name: 'user_id', type: 'string', isOptional: false, isRest: false }],
                modifiers: [],
                hash: 'hash'
            },
            driftScore: 0,
            driftReasons: [],
            lastAnalyzed: new Date(),
            isReviewed: false
        };

        const result = analyzer.analyzePair(pair, parser);

        const renamed = result.driftReasons.find(r => r.type === DriftType.ParameterRenamed);
        assert.ok(renamed, 'Should detect parameter rename');
    });
});
