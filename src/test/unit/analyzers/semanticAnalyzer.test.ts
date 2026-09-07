import * as assert from 'assert';
import { buildSemanticPrompt, parseSemanticResponse, findingToReasons } from '../../../analyzers/semanticAnalyzer';
import { CodeType, DocCodePair, DocType, DriftSeverity, DriftType } from '../../../models/types';

const pair: DocCodePair = {
    id: '1',
    filePath: '/repo/src/a.ts',
    docRange: {} as any,
    docContent: '/** Returns the user, or throws if missing */',
    docType: DocType.JSDoc,
    codeRange: {} as any,
    codeContent: 'function getUser(id: string): User | undefined { return users.get(id); }',
    codeSignature: { name: 'getUser', type: CodeType.Function, parameters: [], modifiers: [], hash: 'h' },
    driftScore: 0,
    driftReasons: [],
    lastAnalyzed: new Date(),
    isReviewed: false
};

suite('SemanticAnalyzer: prompt and parsing', () => {
    test('prompt includes doc, code and JSON instructions', () => {
        const { system, user } = buildSemanticPrompt(pair);
        assert.match(system, /JSON object/);
        assert.match(user, /Symbol: getUser \(function\)/);
        assert.match(user, /Returns the user, or throws if missing/);
        assert.match(user, /users\.get\(id\)/);
    });

    test('parses a plain JSON response', () => {
        const finding = parseSemanticResponse('{"drifted": true, "confidence": 0.9, "summary": "Doc says it throws", "issues": ["returns undefined instead of throwing"]}');
        assert.ok(finding);
        assert.strictEqual(finding!.drifted, true);
        assert.strictEqual(finding!.confidence, 0.9);
        assert.deepStrictEqual(finding!.issues, ['returns undefined instead of throwing']);
    });

    test('parses JSON wrapped in fences and prose, clamps confidence', () => {
        const finding = parseSemanticResponse('Sure! Here it is:\n```json\n{"drifted": false, "confidence": 7, "summary": "ok", "issues": "nope"}\n```\nDone.');
        assert.ok(finding);
        assert.strictEqual(finding!.drifted, false);
        assert.strictEqual(finding!.confidence, 1);
        assert.deepStrictEqual(finding!.issues, []);
    });

    test('returns null for garbage', () => {
        assert.strictEqual(parseSemanticResponse('no json here'), null);
        assert.strictEqual(parseSemanticResponse(''), null);
        assert.strictEqual(parseSemanticResponse('{not json'), null);
    });

    test('maps findings to reasons by confidence', () => {
        assert.deepStrictEqual(findingToReasons({ drifted: false, confidence: 1, summary: 'fine', issues: [] }, 'X'), []);

        const high = findingToReasons({ drifted: true, confidence: 0.95, summary: 'Doc says it throws', issues: ['a', 'b'] }, 'Anthropic');
        assert.strictEqual(high.length, 1);
        assert.strictEqual(high[0].type, DriftType.SemanticMismatch);
        assert.strictEqual(high[0].severity, DriftSeverity.High);
        assert.strictEqual(high[0].message, 'AI (Anthropic): Doc says it throws');
        assert.match(high[0].details ?? '', /• a\n• b\nConfidence: 95%/);

        const low = findingToReasons({ drifted: true, confidence: 0.3, summary: '', issues: [] }, 'X');
        assert.strictEqual(low[0].severity, DriftSeverity.Low);
        assert.match(low[0].message, /may not match/);
    });
});
