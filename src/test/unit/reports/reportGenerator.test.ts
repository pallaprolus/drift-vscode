import * as assert from 'assert';
import {
    generateMarkdownReport,
    generateHtmlReport,
    generateJsonReport,
    selectReportPairs,
    summarize,
    severityFromScore
} from '../../../reports/reportGenerator';
import { CodeType, DocCodePair, DocType, DriftSeverity, DriftType } from '../../../models/types';

function pair(overrides: Partial<DocCodePair> & { name: string; score: number; file?: string }): DocCodePair {
    return {
        id: `id-${overrides.name}`,
        filePath: overrides.file ?? '/repo/src/a.ts',
        docRange: { start: { line: 4 }, end: { line: 8 } } as any,
        docContent: '/** doc */',
        docType: DocType.JSDoc,
        codeRange: { start: { line: 9 }, end: { line: 12 } } as any,
        codeContent: 'function x() {}',
        codeSignature: { name: overrides.name, type: CodeType.Function, parameters: [], modifiers: [], hash: 'h' },
        driftScore: overrides.score,
        driftReasons: overrides.driftReasons ?? [{
            type: DriftType.ParameterRemoved,
            severity: DriftSeverity.High,
            message: `Documented parameter 'x' not found in code | pipe`,
            details: 'The documentation describes a parameter that does not exist'
        }],
        lastAnalyzed: new Date(0),
        isReviewed: overrides.isReviewed ?? false
    };
}

const options = { workspaceName: 'demo', workspaceRoot: '/repo', generatedAt: new Date('2026-01-02T03:04:05Z') };

suite('ReportGenerator', () => {
    test('severityFromScore thresholds', () => {
        assert.strictEqual(severityFromScore(0.9), DriftSeverity.Critical);
        assert.strictEqual(severityFromScore(0.6), DriftSeverity.High);
        assert.strictEqual(severityFromScore(0.4), DriftSeverity.Medium);
        assert.strictEqual(severityFromScore(0.1), DriftSeverity.Low);
    });

    test('selectReportPairs filters, respects threshold and reviewed flag, sorts by score', () => {
        const pairs = [
            pair({ name: 'low', score: 0.2 }),
            pair({ name: 'zero', score: 0 }),
            pair({ name: 'high', score: 0.9 }),
            pair({ name: 'reviewed', score: 0.7, isReviewed: true })
        ];
        assert.deepStrictEqual(selectReportPairs(pairs, options).map(p => p.codeSignature.name), ['high', 'low']);
        assert.deepStrictEqual(selectReportPairs(pairs, { ...options, threshold: 0.5 }).map(p => p.codeSignature.name), ['high']);
        assert.deepStrictEqual(
            selectReportPairs(pairs, { ...options, includeReviewed: true }).map(p => p.codeSignature.name),
            ['high', 'reviewed', 'low']
        );
    });

    test('summarize counts by severity and file', () => {
        const s = summarize([
            pair({ name: 'a', score: 0.9 }),
            pair({ name: 'b', score: 0.65, file: '/repo/src/b.ts' }),
            pair({ name: 'c', score: 0.1, file: '/repo/src/b.ts' })
        ]);
        assert.deepStrictEqual(s, { total: 3, critical: 1, high: 1, medium: 0, low: 1, files: 2 });
    });

    test('markdown report contains summary, relative paths and escaped cells', () => {
        const md = generateMarkdownReport([pair({ name: 'calcTotal', score: 0.9 })], options);
        assert.match(md, /^# Drift Report: demo/);
        assert.match(md, /Generated 2026-01-02T03:04:05.000Z/);
        assert.match(md, /\| Issues \| 1 \|/);
        assert.match(md, /### src\/a\.ts/);
        assert.match(md, /`calcTotal`/);
        assert.match(md, /\| 5 \| 90% \|/, 'line is 1-based');
        assert.match(md, /not found in code \\\| pipe/, 'pipes are escaped');
        assert.match(md, /<details>/);
    });

    test('markdown report handles the empty case', () => {
        const md = generateMarkdownReport([], options);
        assert.match(md, /No documentation drift detected/);
    });

    test('html report is self-contained and escapes content', () => {
        const html = generateHtmlReport([pair({ name: 'a<b', score: 0.5 })], options);
        assert.match(html, /^<!DOCTYPE html>/);
        assert.match(html, /<style>/);
        assert.match(html, /a&lt;b/);
        assert.ok(!html.includes('a<b<'), 'raw symbol must be escaped');
        assert.match(html, /🟡 medium/);
        assert.match(html, /<footer>/);
    });

    test('json report is parseable with the expected shape', () => {
        const gitInfo = new Map([[ 'id-a', { codeChangedInWorkingTree: true, docChangedInWorkingTree: false, codeLastChanged: new Date('2025-06-01T00:00:00Z') } ]]);
        const json = JSON.parse(generateJsonReport([pair({ name: 'a', score: 0.9 })], { ...options, gitInfo }));
        assert.strictEqual(json.tool, 'drift');
        assert.strictEqual(json.workspace, 'demo');
        assert.strictEqual(json.summary.total, 1);
        assert.strictEqual(json.issues[0].file, 'src/a.ts');
        assert.strictEqual(json.issues[0].line, 5);
        assert.strictEqual(json.issues[0].severity, 'critical');
        assert.strictEqual(json.issues[0].reasons[0].type, 'parameter_removed');
        assert.strictEqual(json.issues[0].git.codeChangedInWorkingTree, true);
        assert.strictEqual(json.issues[0].git.codeLastChanged, '2025-06-01T00:00:00.000Z');
    });
});
