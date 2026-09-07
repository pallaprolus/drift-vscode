import { DriftReason, DriftSeverity, DriftType, MarkdownCodeBlock, SymbolEntry } from '../models/types';
import { findClosestMatch } from '../utils/helpers';
import { SymbolIndex } from './symbolIndex';

/**
 * A reference to a code symbol found inside a Markdown code block
 */
export interface CodeBlockReference {
    name: string;
    /** Kind of reference: a call site or a declaration shown in the docs */
    kind: 'call' | 'declaration';
    /** Argument / parameter names as they appear in the code block */
    args: string[];
    /** Line offset inside the code block (0 = first content line) */
    lineOffset: number;
}

/**
 * Result of analyzing a single Markdown code block
 */
export interface CodeBlockAnalysis {
    block: MarkdownCodeBlock;
    reasons: DriftReason[];
    /** The symbols this block was matched against (may be empty) */
    matched: SymbolEntry[];
    /** Name of the primary symbol this block documents */
    primarySymbol?: string;
}

const CODE_LANGUAGES = new Set([
    'ts', 'typescript', 'js', 'javascript', 'jsx', 'tsx',
    'py', 'python', 'go', 'golang', 'rust', 'rs', 'java'
]);

const CALL_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'def', 'fn', 'func',
    'new', 'typeof', 'await', 'async', 'print', 'println', 'console', 'log', 'require',
    'import', 'from', 'export', 'class', 'super', 'this', 'self', 'throw', 'raise',
    'assert', 'sizeof', 'match', 'let', 'const', 'var', 'yield', 'elif', 'else',
    'with', 'try', 'except', 'lambda', 'Some', 'Ok', 'Err', 'None', 'String', 'Vec',
    'Box', 'Promise', 'Array', 'Object', 'Number', 'Boolean', 'Map', 'Set', 'Error',
    'Date', 'JSON', 'Math', 'parseInt', 'parseFloat', 'len', 'range', 'str', 'int',
    'float', 'list', 'dict', 'set', 'tuple', 'isinstance', 'main', 'make', 'append',
    'fmt', 'Println', 'Printf', 'Sprintf', 'Errorf', 'push', 'pop', 'map', 'filter',
    'reduce', 'forEach', 'then', 'resolve', 'reject', 'get', 'set', 'has', 'delete',
    'toString', 'valueOf', 'join', 'split', 'trim', 'slice', 'splice', 'indexOf',
    'includes', 'keys', 'values', 'entries', 'unwrap', 'expect', 'clone', 'iter',
    'collect', 'into', 'as_ref', 'to_string', 'format', 'panic', 'vec', 'describe',
    'it', 'test', 'expect', 'toBe', 'toEqual', 'beforeEach', 'afterEach', 'System',
    'out', 'println', 'printf', 'valueOf', 'equals', 'hashCode', 'Integer', 'Long'
]);

/**
 * Extract fenced code blocks from Markdown content.
 * Handles ``` and ~~~ fences with optional language tags.
 */
export function extractCodeBlocks(markdown: string): MarkdownCodeBlock[] {
    const lines = markdown.split(/\r?\n/);
    const blocks: MarkdownCodeBlock[] = [];

    let inBlock = false;
    let fence = '';
    let language = '';
    let startLine = 0;
    let buffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!inBlock) {
            const open = trimmed.match(/^(`{3,}|~{3,})\s*([\w+#.-]*)/);
            if (open) {
                inBlock = true;
                fence = open[1];
                language = (open[2] || '').toLowerCase();
                startLine = i;
                buffer = [];
            }
            continue;
        }

        // Closing fence must use the same character and be at least as long
        if (trimmed.startsWith(fence[0]) && new RegExp(`^${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(trimmed)) {
            blocks.push({
                language,
                content: buffer.join('\n'),
                startLine,
                endLine: i
            });
            inBlock = false;
            continue;
        }

        buffer.push(line);
    }

    return blocks;
}

/**
 * Whether a fenced block should be analyzed (has a language we understand).
 */
export function isAnalyzableBlock(block: MarkdownCodeBlock): boolean {
    return CODE_LANGUAGES.has(block.language);
}

/**
 * Split an argument list on top-level commas (ignores nested parens/brackets/strings).
 */
export function splitArgs(argString: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    let quote: string | null = null;

    for (let i = 0; i < argString.length; i++) {
        const ch = argString[i];

        if (quote) {
            current += ch;
            if (ch === quote && argString[i - 1] !== '\\') {
                quote = null;
            }
            continue;
        }

        if (ch === '"' || ch === '\'' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
            depth--;
        }

        if (ch === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }

    if (current.trim().length > 0) {
        args.push(current.trim());
    }

    return args;
}

/**
 * Extract the balanced content between the parenthesis starting at `openIndex`.
 * Returns null if no balanced close is found.
 */
function extractParenContent(text: string, openIndex: number): string | null {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return text.slice(openIndex + 1, i);
            }
        }
    }
    return null;
}

/**
 * Normalize a parameter fragment ("name: type = default") to just the name.
 */
function paramName(fragment: string): string {
    const cleaned = fragment
        .replace(/^\.\.\./, '')
        .replace(/^\*+/, '')
        .replace(/^(mut|ref|final|const)\s+/, '')
        .trim();
    const match = cleaned.match(/^([A-Za-z_$][\w$]*)/);
    return match ? match[1] : cleaned;
}

/**
 * Extract call sites and declarations from a code block.
 */
export function extractCodeReferences(block: MarkdownCodeBlock): CodeBlockReference[] {
    const refs: CodeBlockReference[] = [];
    const lines = block.content.split('\n');

    const declPattern = /\b(?:function|def|fn|func)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
    const callPattern = /(?<![\w$.])(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*\(/g;

    for (let lineOffset = 0; lineOffset < lines.length; lineOffset++) {
        const rawLine = lines[lineOffset];
        // Strip line comments so we don't match commentary
        const line = rawLine.replace(/\/\/.*$|#.*$/, '');

        const declaredOnLine = new Set<string>();

        let match: RegExpExecArray | null;
        declPattern.lastIndex = 0;
        while ((match = declPattern.exec(line)) !== null) {
            const name = match[1];
            const parenIndex = match.index + match[0].length - 1;
            const inner = extractParenContent(line, parenIndex);
            const args = inner === null ? [] : splitArgs(inner).map(paramName).filter(Boolean);
            declaredOnLine.add(name);
            refs.push({ name, kind: 'declaration', args, lineOffset });
        }

        callPattern.lastIndex = 0;
        while ((match = callPattern.exec(line)) !== null) {
            const name = match[1];
            if (declaredOnLine.has(name) || CALL_KEYWORDS.has(name)) {
                continue;
            }
            // Skip things immediately preceded by declaration keywords (handled above)
            const before = line.slice(0, match.index).trimEnd();
            if (/\b(?:function|def|fn|func|class|new)$/.test(before)) {
                continue;
            }
            const parenIndex = match.index + match[0].length - 1;
            const inner = extractParenContent(line, parenIndex);
            const args = inner === null ? [] : splitArgs(inner);
            refs.push({ name, kind: 'call', args, lineOffset });
        }
    }

    return refs;
}

/**
 * Analyze a single code block against the symbol index.
 */
export function analyzeCodeBlock(block: MarkdownCodeBlock, index: SymbolIndex): CodeBlockAnalysis {
    const reasons: DriftReason[] = [];
    const matched: SymbolEntry[] = [];
    const seen = new Set<string>();

    const refs = extractCodeReferences(block);
    const allNames = index.allNames();
    let primarySymbol: string | undefined;

    for (const ref of refs) {
        const key = `${ref.kind}:${ref.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const entries = index.lookup(ref.name);

        if (entries.length === 0) {
            // Only report unknown *declarations* or calls that look like project
            // symbols (close match to something in the index) to keep noise low.
            const closest = allNames.length > 0
                ? findClosestMatch(ref.name.toLowerCase(), allNames.map(n => n.toLowerCase()))
                : null;

            if (closest && closest.distance > 0 && closest.distance <= 2 && ref.name.length >= 4) {
                const original = allNames.find(n => n.toLowerCase() === closest.match) || closest.match;
                reasons.push({
                    type: DriftType.ReadmeReference,
                    severity: DriftSeverity.High,
                    message: `README references '${ref.name}' which may have been renamed to '${original}'`,
                    details: `No symbol named '${ref.name}' exists in the workspace, but '${original}' does`
                });
                if (!primarySymbol) {
                    primarySymbol = ref.name;
                }
            } else if (ref.kind === 'declaration' && ref.name.length >= 3) {
                reasons.push({
                    type: DriftType.ReadmeReference,
                    severity: DriftSeverity.Medium,
                    message: `README documents '${ref.name}' which was not found in the workspace`,
                    details: `The code block declares '${ref.name}' but no matching function or method exists in scanned files`
                });
                if (!primarySymbol) {
                    primarySymbol = ref.name;
                }
            }
            continue;
        }

        if (!primarySymbol) {
            primarySymbol = ref.name;
        }
        for (const entry of entries) {
            if (!matched.includes(entry)) {
                matched.push(entry);
            }
        }

        // Compare against the exact-case match when present, else the first entry
        const entry = entries.find(e => e.name === ref.name) ?? entries[0];
        if (entry.name !== ref.name) {
            reasons.push({
                type: DriftType.ReadmeReference,
                severity: DriftSeverity.Medium,
                message: `README references '${ref.name}' but the code defines '${entry.name}'`,
                details: `Only the letter case differs (see ${shortPath(entry.filePath)}:${entry.line + 1})`
            });
        }
        const codeParams = entry.signature.parameters.filter(
            p => !['self', 'cls'].includes(p.name.toLowerCase())
        );
        const requiredCount = codeParams.filter(p => !p.isOptional && !p.isRest && p.defaultValue === undefined).length;
        const hasRest = codeParams.some(p => p.isRest);
        const maxCount = hasRest ? Infinity : codeParams.length;

        if (ref.kind === 'declaration') {
            const docParams = ref.args.filter(a => !['self', 'cls'].includes(a.toLowerCase()));
            const codeNames = codeParams.map(p => p.name.toLowerCase());
            const docNames = docParams.map(p => p.toLowerCase());

            const missingInCode = docNames.filter(n => !codeNames.includes(n));
            const missingInDoc = codeNames.filter(n => !docNames.includes(n));

            if (missingInCode.length > 0 || missingInDoc.length > 0) {
                const details: string[] = [];
                if (missingInCode.length > 0) {
                    details.push(`README shows parameter(s) ${missingInCode.map(n => `'${n}'`).join(', ')} not in code`);
                }
                if (missingInDoc.length > 0) {
                    details.push(`code has parameter(s) ${missingInDoc.map(n => `'${n}'`).join(', ')} not shown in README`);
                }
                reasons.push({
                    type: DriftType.ReadmeReference,
                    severity: DriftSeverity.High,
                    message: `README signature for '${entry.name}' is out of date`,
                    details: `${details.join('; ')} (see ${shortPath(entry.filePath)}:${entry.line + 1})`
                });
            }
        } else {
            const argCount = ref.args.length;
            // Keyword args (python) / spread args make counting unreliable; only
            // flag clear-cut arity mismatches.
            const hasSpread = ref.args.some(a => a.startsWith('...') || a.startsWith('*'));
            if (!hasSpread && (argCount < requiredCount || argCount > maxCount)) {
                reasons.push({
                    type: DriftType.ReadmeReference,
                    severity: DriftSeverity.Medium,
                    message: `README calls '${entry.name}' with ${argCount} argument${argCount === 1 ? '' : 's'}`,
                    details: `Code expects ${describeArity(requiredCount, maxCount)} (see ${shortPath(entry.filePath)}:${entry.line + 1})`
                });
            }
        }
    }

    return { block, reasons, matched, primarySymbol };
}

function describeArity(required: number, max: number): string {
    if (max === Infinity) {
        return `at least ${required}`;
    }
    if (required === max) {
        return `${required}`;
    }
    return `${required} to ${max}`;
}

function shortPath(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts.slice(-2).join('/');
}

/**
 * Analyze every analyzable code block in a Markdown document.
 */
export function analyzeMarkdown(markdown: string, index: SymbolIndex): CodeBlockAnalysis[] {
    return extractCodeBlocks(markdown)
        .filter(isAnalyzableBlock)
        .map(block => analyzeCodeBlock(block, index));
}
