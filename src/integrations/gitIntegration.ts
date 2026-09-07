import { execFile } from 'child_process';
import * as path from 'path';
import { DocCodePair, DriftReason, DriftSeverity, DriftType, GitPairInfo } from '../models/types';

/**
 * A contiguous range of lines (0-based, inclusive) changed in the working tree
 */
export interface LineRange {
    start: number;
    end: number;
}

/**
 * Per-line git blame information
 */
export interface BlameLine {
    /** 0-based line number */
    line: number;
    commit: string;
    /** Unix seconds */
    time: number;
    author: string;
}

export interface FileGitData {
    blame: BlameLine[];
    workingTreeChanges: LineRange[];
}

const ZERO_COMMIT = /^0{40}/;

/**
 * Parse `git blame --line-porcelain` output into per-line entries.
 */
export function parseBlamePorcelain(output: string): BlameLine[] {
    const lines = output.split('\n');
    const result: BlameLine[] = [];
    const commitMeta = new Map<string, { time: number; author: string }>();

    let i = 0;
    while (i < lines.length) {
        const header = lines[i];
        const headerMatch = header.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
        if (!headerMatch) {
            i++;
            continue;
        }

        const commit = headerMatch[1];
        const finalLine = parseInt(headerMatch[3], 10) - 1;
        i++;

        let time = commitMeta.get(commit)?.time ?? 0;
        let author = commitMeta.get(commit)?.author ?? '';

        // Consume metadata lines until the content line (prefixed with a tab)
        while (i < lines.length && !lines[i].startsWith('\t')) {
            const meta = lines[i];
            if (meta.startsWith('committer-time ')) {
                time = parseInt(meta.slice('committer-time '.length), 10);
            } else if (meta.startsWith('author ')) {
                author = meta.slice('author '.length);
            }
            i++;
        }

        // Skip the content line
        i++;

        commitMeta.set(commit, { time, author });
        result.push({ line: finalLine, commit, time, author });
    }

    return result;
}

/**
 * Parse hunks from `git diff -U0` output into 0-based line ranges in the new file.
 */
export function parseDiffHunks(output: string): LineRange[] {
    const ranges: LineRange[] = [];
    const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

    let match: RegExpExecArray | null;
    while ((match = hunkPattern.exec(output)) !== null) {
        const start = parseInt(match[1], 10);
        const count = match[2] === undefined ? 1 : parseInt(match[2], 10);
        if (count === 0) {
            // Pure deletion: mark the line after which content was removed
            ranges.push({ start: Math.max(0, start - 1), end: Math.max(0, start - 1) });
        } else {
            ranges.push({ start: start - 1, end: start - 1 + count - 1 });
        }
    }

    return ranges;
}

/**
 * Whether a 0-based inclusive line range intersects any of the given ranges.
 */
export function rangesIntersect(start: number, end: number, ranges: LineRange[]): boolean {
    return ranges.some(r => r.start <= end && r.end >= start);
}

/**
 * Compute the most recent committed change time (unix seconds) for a range of lines.
 * Uncommitted lines (zero commit) are ignored. Returns undefined if nothing is committed.
 */
export function latestChangeInRange(blame: BlameLine[], start: number, end: number): number | undefined {
    let latest: number | undefined;
    for (const entry of blame) {
        if (entry.line < start || entry.line > end) {
            continue;
        }
        if (ZERO_COMMIT.test(entry.commit)) {
            continue;
        }
        if (latest === undefined || entry.time > latest) {
            latest = entry.time;
        }
    }
    return latest;
}

/**
 * Derive Git metadata for a pair from file-level git data.
 */
export function computeGitPairInfo(
    pair: { docRange: { start: { line: number }; end: { line: number } }; codeRange: { start: { line: number }; end: { line: number } } },
    data: FileGitData
): GitPairInfo {
    const docStart = pair.docRange.start.line;
    const docEnd = pair.docRange.end.line;
    const codeStart = pair.codeRange.start.line;
    const codeEnd = pair.codeRange.end.line;

    const docTime = latestChangeInRange(data.blame, docStart, docEnd);
    const codeTime = latestChangeInRange(data.blame, codeStart, codeEnd);

    return {
        docLastChanged: docTime !== undefined ? new Date(docTime * 1000) : undefined,
        codeLastChanged: codeTime !== undefined ? new Date(codeTime * 1000) : undefined,
        docChangedInWorkingTree: rangesIntersect(docStart, docEnd, data.workingTreeChanges),
        codeChangedInWorkingTree: rangesIntersect(codeStart, codeEnd, data.workingTreeChanges)
    };
}

/**
 * Turn Git metadata into drift reasons.
 *
 * - Code edited in the working tree while docs untouched -> Medium
 * - Code committed more recently than docs by more than `staleDays` -> Low/Medium
 */
export function gitReasonsForPair(info: GitPairInfo, staleDays: number): DriftReason[] {
    const reasons: DriftReason[] = [];

    if (info.codeChangedInWorkingTree && !info.docChangedInWorkingTree) {
        reasons.push({
            type: DriftType.GitChange,
            severity: DriftSeverity.Medium,
            message: 'Code has uncommitted changes but documentation was not touched',
            details: 'The implementation was edited in the working tree; review the documentation before committing'
        });
    }

    if (info.codeLastChanged && info.docLastChanged) {
        const deltaDays = (info.codeLastChanged.getTime() - info.docLastChanged.getTime()) / (1000 * 60 * 60 * 24);
        if (deltaDays > staleDays) {
            const rounded = Math.round(deltaDays);
            reasons.push({
                type: DriftType.GitChange,
                severity: rounded > staleDays * 4 ? DriftSeverity.Medium : DriftSeverity.Low,
                message: `Code was last committed ${rounded} day${rounded === 1 ? '' : 's'} after the documentation`,
                details: `Documentation last changed ${formatDate(info.docLastChanged)}, code last changed ${formatDate(info.codeLastChanged)}`
            });
        }
    }

    return reasons;
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Runs git commands and caches per-file results.
 */
export class GitTracker {
    private cache: Map<string, { key: string; data: FileGitData }> = new Map();
    private repoRootCache: Map<string, string | null> = new Map();

    /**
     * Return the repository root for a file, or null if not in a git repo.
     */
    async getRepoRoot(filePath: string): Promise<string | null> {
        const dir = path.dirname(filePath);
        if (this.repoRootCache.has(dir)) {
            return this.repoRootCache.get(dir) ?? null;
        }

        try {
            const out = await this.runGit(['rev-parse', '--show-toplevel'], dir);
            const root = out.trim();
            this.repoRootCache.set(dir, root);
            return root;
        } catch {
            this.repoRootCache.set(dir, null);
            return null;
        }
    }

    /**
     * Fetch blame + working-tree diff data for a file.
     * `contentKey` should change whenever the file content changes (e.g. a hash).
     */
    async getFileData(filePath: string, contentKey: string): Promise<FileGitData | null> {
        const cached = this.cache.get(filePath);
        if (cached && cached.key === contentKey) {
            return cached.data;
        }

        const root = await this.getRepoRoot(filePath);
        if (!root) {
            return null;
        }

        try {
            const [blameOut, diffOut] = await Promise.all([
                this.runGit(['blame', '--line-porcelain', '-w', '--', filePath], root).catch(() => ''),
                this.runGit(['diff', '-U0', '--no-color', 'HEAD', '--', filePath], root).catch(() => '')
            ]);

            const data: FileGitData = {
                blame: parseBlamePorcelain(blameOut),
                workingTreeChanges: parseDiffHunks(diffOut)
            };

            this.cache.set(filePath, { key: contentKey, data });
            return data;
        } catch {
            return null;
        }
    }

    /**
     * Compute git-derived drift reasons for a pair.
     */
    async analyzePair(pair: DocCodePair, contentKey: string, staleDays: number): Promise<{ info: GitPairInfo; reasons: DriftReason[] } | null> {
        const data = await this.getFileData(pair.filePath, contentKey);
        if (!data) {
            return null;
        }
        const info = computeGitPairInfo(pair, data);
        return { info, reasons: gitReasonsForPair(info, staleDays) };
    }

    invalidate(filePath: string): void {
        this.cache.delete(filePath);
    }

    clear(): void {
        this.cache.clear();
        this.repoRootCache.clear();
    }

    private runGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}
