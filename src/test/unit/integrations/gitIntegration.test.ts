import * as assert from 'assert';
import {
    parseBlamePorcelain,
    parseDiffHunks,
    rangesIntersect,
    latestChangeInRange,
    computeGitPairInfo,
    gitReasonsForPair
} from '../../../integrations/gitIntegration';
import { DriftSeverity, DriftType } from '../../../models/types';

const DAY = 24 * 60 * 60;

function blameOutput(entries: { commit: string; line: number; time: number; author?: string }[]): string {
    return entries.map(e => [
        `${e.commit} ${e.line} ${e.line} 1`,
        `author ${e.author ?? 'Dev'}`,
        'author-mail <dev@example.com>',
        `author-time ${e.time}`,
        'author-tz +0000',
        'committer Dev',
        'committer-mail <dev@example.com>',
        `committer-time ${e.time}`,
        'committer-tz +0000',
        'summary Something',
        'filename file.ts',
        '\tcontent line'
    ].join('\n')).join('\n') + '\n';
}

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

suite('GitIntegration: parsing', () => {
    test('parses line-porcelain blame output', () => {
        const out = blameOutput([
            { commit: A, line: 1, time: 1000 },
            { commit: B, line: 2, time: 5000, author: 'Other' },
            { commit: ZERO, line: 3, time: 0 }
        ]);
        const blame = parseBlamePorcelain(out);
        assert.strictEqual(blame.length, 3);
        assert.deepStrictEqual(blame[0], { line: 0, commit: A, time: 1000, author: 'Dev' });
        assert.strictEqual(blame[1].author, 'Other');
        assert.strictEqual(blame[1].time, 5000);
        assert.strictEqual(blame[2].line, 2);
    });

    test('reuses commit metadata for repeated commits', () => {
        // Second occurrence of a commit omits metadata lines in real git output
        const out = [
            `${A} 1 1 2`, 'author Dev', 'committer-time 42', 'filename f', '\tx',
            `${A} 2 2`, '\ty'
        ].join('\n');
        const blame = parseBlamePorcelain(out);
        assert.strictEqual(blame.length, 2);
        assert.strictEqual(blame[1].time, 42);
    });

    test('parses unified diff hunks into 0-based ranges', () => {
        const diff = [
            'diff --git a/f b/f',
            '@@ -10,2 +10,3 @@ function foo',
            '+a', '+b', '+c',
            '@@ -20 +21 @@',
            '+d',
            '@@ -30,2 +31,0 @@',
            '-x', '-y'
        ].join('\n');
        assert.deepStrictEqual(parseDiffHunks(diff), [
            { start: 9, end: 11 },
            { start: 20, end: 20 },
            { start: 30, end: 30 }
        ]);
    });

    test('rangesIntersect and latestChangeInRange', () => {
        const ranges = [{ start: 5, end: 7 }];
        assert.ok(rangesIntersect(7, 10, ranges));
        assert.ok(!rangesIntersect(8, 10, ranges));

        const blame = parseBlamePorcelain(blameOutput([
            { commit: A, line: 1, time: 100 },
            { commit: B, line: 2, time: 900 },
            { commit: ZERO, line: 3, time: 99999 }
        ]));
        assert.strictEqual(latestChangeInRange(blame, 0, 1), 900);
        assert.strictEqual(latestChangeInRange(blame, 2, 2), undefined, 'uncommitted lines are ignored');
    });
});

suite('GitIntegration: pair analysis', () => {
    const docRange = { start: { line: 0 }, end: { line: 3 } };
    const codeRange = { start: { line: 4 }, end: { line: 10 } };

    test('flags code committed long after the docs', () => {
        const docTime = 1_700_000_000;
        const blame = parseBlamePorcelain(blameOutput([
            { commit: A, line: 1, time: docTime },
            { commit: B, line: 6, time: docTime + 45 * DAY }
        ]));
        const info = computeGitPairInfo({ docRange, codeRange }, { blame, workingTreeChanges: [] });
        assert.ok(info.docLastChanged && info.codeLastChanged);
        assert.ok(!info.codeChangedInWorkingTree);

        const reasons = gitReasonsForPair(info, 30);
        assert.strictEqual(reasons.length, 1);
        assert.strictEqual(reasons[0].type, DriftType.GitChange);
        assert.strictEqual(reasons[0].severity, DriftSeverity.Low);
        assert.match(reasons[0].message, /45 days after/);

        assert.strictEqual(gitReasonsForPair(info, 60).length, 0, 'respects staleDays');
    });

    test('escalates severity for very old documentation', () => {
        const t = 1_700_000_000;
        const blame = parseBlamePorcelain(blameOutput([
            { commit: A, line: 1, time: t },
            { commit: B, line: 6, time: t + 200 * DAY }
        ]));
        const info = computeGitPairInfo({ docRange, codeRange }, { blame, workingTreeChanges: [] });
        assert.strictEqual(gitReasonsForPair(info, 30)[0].severity, DriftSeverity.Medium);
    });

    test('flags uncommitted code edits when docs were untouched', () => {
        const info = computeGitPairInfo({ docRange, codeRange }, { blame: [], workingTreeChanges: [{ start: 6, end: 6 }] });
        assert.ok(info.codeChangedInWorkingTree);
        assert.ok(!info.docChangedInWorkingTree);
        const reasons = gitReasonsForPair(info, 30);
        assert.strictEqual(reasons.length, 1);
        assert.match(reasons[0].message, /uncommitted changes/);
    });

    test('does not flag when both docs and code were edited together', () => {
        const info = computeGitPairInfo({ docRange, codeRange }, { blame: [], workingTreeChanges: [{ start: 2, end: 6 }] });
        assert.strictEqual(gitReasonsForPair(info, 30).length, 0);
    });
});
