import * as assert from 'assert';
import {
    extractCodeBlocks,
    extractCodeReferences,
    analyzeCodeBlock,
    analyzeMarkdown,
    splitArgs,
    isAnalyzableBlock
} from '../../../analyzers/readmeAnalyzer';
import { SymbolIndex } from '../../../analyzers/symbolIndex';
import { CodeType, DriftType } from '../../../models/types';

function makeIndex(entries: { name: string; params: string[]; optional?: string[]; rest?: string }[]): SymbolIndex {
    const index = new SymbolIndex();
    index.addSignatures('/repo/src/lib.ts', entries.map((e, i) => ({
        line: i * 10,
        signature: {
            name: e.name,
            type: CodeType.Function,
            parameters: [
                ...e.params.map(p => ({ name: p, isOptional: false, isRest: false })),
                ...(e.optional ?? []).map(p => ({ name: p, isOptional: true, isRest: false })),
                ...(e.rest ? [{ name: e.rest, isOptional: false, isRest: true }] : [])
            ],
            modifiers: [],
            hash: `hash-${e.name}`
        }
    })));
    return index;
}

suite('ReadmeAnalyzer: extractCodeBlocks', () => {
    test('extracts fenced blocks with language and line numbers', () => {
        const md = [
            '# Title',
            '',
            '```ts',
            'const x = 1;',
            'calculateTotal(1, 2);',
            '```',
            '',
            '~~~python',
            'print("hi")',
            '~~~',
            '```',
            'no language',
            '```'
        ].join('\n');

        const blocks = extractCodeBlocks(md);
        assert.strictEqual(blocks.length, 3);
        assert.strictEqual(blocks[0].language, 'ts');
        assert.strictEqual(blocks[0].startLine, 2);
        assert.strictEqual(blocks[0].endLine, 5);
        assert.strictEqual(blocks[0].content, 'const x = 1;\ncalculateTotal(1, 2);');
        assert.strictEqual(blocks[1].language, 'python');
        assert.strictEqual(blocks[2].language, '');
        assert.ok(isAnalyzableBlock(blocks[0]));
        assert.ok(isAnalyzableBlock(blocks[1]));
        assert.ok(!isAnalyzableBlock(blocks[2]));
    });

    test('does not close a backtick fence with a tilde fence', () => {
        const md = '```js\n~~~\nfoo();\n```';
        const blocks = extractCodeBlocks(md);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].content, '~~~\nfoo();');
    });

    test('ignores an unterminated fence', () => {
        const blocks = extractCodeBlocks('```ts\nfoo();');
        assert.strictEqual(blocks.length, 0);
    });
});

suite('ReadmeAnalyzer: splitArgs / extractCodeReferences', () => {
    test('splits top-level commas only', () => {
        assert.deepStrictEqual(splitArgs('a, fn(b, c), "x,y", [1,2]'), ['a', 'fn(b, c)', '"x,y"', '[1,2]']);
        assert.deepStrictEqual(splitArgs(''), []);
    });

    test('finds calls and declarations with argument lists', () => {
        const refs = extractCodeReferences({
            language: 'ts',
            startLine: 0,
            endLine: 0,
            content: [
                'function calculateTotal(price: number, taxRate: number): number {',
                '  return price * taxRate; // helper(1)',
                '}',
                'const total = calculateTotal(10, 0.2);',
                'api.client.fetchUser(id);',
                'if (total > 1) { console.log(total); }'
            ].join('\n')
        });

        const decl = refs.find(r => r.kind === 'declaration');
        assert.ok(decl);
        assert.strictEqual(decl!.name, 'calculateTotal');
        assert.deepStrictEqual(decl!.args, ['price', 'taxRate']);

        const calls = refs.filter(r => r.kind === 'call').map(r => r.name);
        assert.deepStrictEqual(calls, ['calculateTotal', 'fetchUser']);
        const call = refs.find(r => r.kind === 'call' && r.name === 'calculateTotal');
        assert.deepStrictEqual(call!.args, ['10', '0.2']);
    });

    test('handles python def with self', () => {
        const refs = extractCodeReferences({
            language: 'python',
            startLine: 0,
            endLine: 0,
            content: 'def process(self, item, retries=3):\n    pass'
        });
        assert.strictEqual(refs.length, 1);
        assert.deepStrictEqual(refs[0].args, ['self', 'item', 'retries']);
    });
});

suite('ReadmeAnalyzer: analyzeCodeBlock', () => {
    test('reports nothing when the README matches the code', () => {
        const index = makeIndex([{ name: 'calculateTotal', params: ['price', 'taxRate'] }]);
        const result = analyzeCodeBlock({
            language: 'ts', startLine: 0, endLine: 0,
            content: 'const t = calculateTotal(10, 0.2);'
        }, index);
        assert.strictEqual(result.reasons.length, 0);
        assert.strictEqual(result.matched.length, 1);
        assert.strictEqual(result.primarySymbol, 'calculateTotal');
    });

    test('flags an argument count mismatch', () => {
        const index = makeIndex([{ name: 'calculateTotal', params: ['price', 'taxRate', 'discount'] }]);
        const result = analyzeCodeBlock({
            language: 'js', startLine: 0, endLine: 0,
            content: 'calculateTotal(10, 0.2);'
        }, index);
        assert.strictEqual(result.reasons.length, 1);
        assert.strictEqual(result.reasons[0].type, DriftType.ReadmeReference);
        assert.match(result.reasons[0].message, /2 arguments/);
        assert.match(result.reasons[0].details ?? '', /expects 3/);
    });

    test('accepts optional and rest parameters when counting arguments', () => {
        const index = makeIndex([{ name: 'logEvent', params: ['msg'], optional: ['level'], rest: 'extra' }]);
        const ok = analyzeCodeBlock({ language: 'ts', startLine: 0, endLine: 0, content: 'logEvent("a", "b", 1, 2, 3);' }, index);
        assert.strictEqual(ok.reasons.length, 0);
        const tooFew = analyzeCodeBlock({ language: 'ts', startLine: 0, endLine: 0, content: 'logEvent();' }, index);
        assert.strictEqual(tooFew.reasons.length, 1);
    });

    test('flags a renamed symbol via close match', () => {
        const index = makeIndex([{ name: 'formatUserName', params: ['first', 'last'] }]);
        const result = analyzeCodeBlock({
            language: 'ts', startLine: 0, endLine: 0,
            content: 'formatUsrName("a", "b");'
        }, index);
        assert.strictEqual(result.reasons.length, 1);
        assert.match(result.reasons[0].message, /renamed to 'formatUserName'/);
    });

    test('flags a case-only mismatch', () => {
        const index = makeIndex([{ name: 'formatUserName', params: ['first', 'last'] }]);
        const result = analyzeCodeBlock({
            language: 'ts', startLine: 0, endLine: 0,
            content: 'formatUsername("a", "b");'
        }, index);
        assert.strictEqual(result.reasons.length, 1);
        assert.match(result.reasons[0].message, /the code defines 'formatUserName'/);
    });

    test('flags a documented declaration whose signature drifted', () => {
        const index = makeIndex([{ name: 'calculateTotal', params: ['price', 'tax', 'discount'] }]);
        const result = analyzeCodeBlock({
            language: 'ts', startLine: 0, endLine: 0,
            content: 'function calculateTotal(price: number, taxRate: number): number {\n  return 0;\n}'
        }, index);
        assert.strictEqual(result.reasons.length, 1);
        assert.match(result.reasons[0].message, /signature for 'calculateTotal' is out of date/);
        assert.match(result.reasons[0].details ?? '', /'taxrate' not in code/);
        assert.match(result.reasons[0].details ?? '', /'tax', 'discount' not shown in README/);
    });

    test('flags a declaration for a symbol that no longer exists', () => {
        const index = makeIndex([{ name: 'somethingElse', params: [] }]);
        const result = analyzeCodeBlock({
            language: 'python', startLine: 0, endLine: 0,
            content: 'def legacy_handler(event):\n    pass'
        }, index);
        assert.strictEqual(result.reasons.length, 1);
        assert.match(result.reasons[0].message, /'legacy_handler' which was not found/);
    });

    test('ignores unknown calls that look like library code', () => {
        const index = makeIndex([{ name: 'calculateTotal', params: ['a'] }]);
        const result = analyzeCodeBlock({
            language: 'ts', startLine: 0, endLine: 0,
            content: 'const res = await fetch(url);\nconsole.log(JSON.stringify(res));\nsetTimeout(() => {}, 10);'
        }, index);
        assert.strictEqual(result.reasons.length, 0);
    });

    test('analyzeMarkdown only analyzes code-language blocks', () => {
        const index = makeIndex([{ name: 'calculateTotal', params: ['a', 'b'] }]);
        const md = '```bash\ncalculateTotal(1)\n```\n```ts\ncalculateTotal(1);\n```';
        const results = analyzeMarkdown(md, index);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].reasons.length, 1);
    });
});

suite('SymbolIndex', () => {
    test('updates and removes files', () => {
        const index = makeIndex([{ name: 'foo', params: [] }]);
        assert.ok(index.has('FOO'));
        assert.strictEqual(index.lookup('foo').length, 1);
        index.removeFile('/repo/src/lib.ts');
        assert.ok(index.isEmpty());
    });
});
