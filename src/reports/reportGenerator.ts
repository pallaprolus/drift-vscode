import { DocCodePair, DriftSeverity, GitPairInfo } from '../models/types';

export type ReportFormat = 'markdown' | 'html' | 'json';

export interface ReportOptions {
    workspaceName: string;
    workspaceRoot: string;
    generatedAt?: Date;
    /** Minimum drift score to include */
    threshold?: number;
    /** Include reviewed pairs */
    includeReviewed?: boolean;
    /** Optional git info keyed by pair id */
    gitInfo?: Map<string, GitPairInfo>;
}

export interface ReportSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    files: number;
}

export function severityFromScore(score: number): DriftSeverity {
    if (score >= 0.8) {
        return DriftSeverity.Critical;
    }
    if (score >= 0.6) {
        return DriftSeverity.High;
    }
    if (score >= 0.4) {
        return DriftSeverity.Medium;
    }
    return DriftSeverity.Low;
}

const SEVERITY_ICON: Record<DriftSeverity, string> = {
    [DriftSeverity.Critical]: '🔴',
    [DriftSeverity.High]: '🟠',
    [DriftSeverity.Medium]: '🟡',
    [DriftSeverity.Low]: '⚪'
};

const SEVERITY_ORDER: DriftSeverity[] = [
    DriftSeverity.Critical,
    DriftSeverity.High,
    DriftSeverity.Medium,
    DriftSeverity.Low
];

/**
 * Filter and sort pairs for reporting.
 */
export function selectReportPairs(pairs: DocCodePair[], options: ReportOptions): DocCodePair[] {
    const threshold = options.threshold ?? 0;
    return pairs
        .filter(p => p.driftScore > 0 && p.driftScore >= threshold)
        .filter(p => options.includeReviewed || !p.isReviewed)
        .sort((a, b) => b.driftScore - a.driftScore || a.filePath.localeCompare(b.filePath));
}

export function summarize(pairs: DocCodePair[]): ReportSummary {
    const summary: ReportSummary = { total: pairs.length, critical: 0, high: 0, medium: 0, low: 0, files: 0 };
    const files = new Set<string>();
    for (const pair of pairs) {
        files.add(pair.filePath);
        switch (severityFromScore(pair.driftScore)) {
            case DriftSeverity.Critical: summary.critical++; break;
            case DriftSeverity.High: summary.high++; break;
            case DriftSeverity.Medium: summary.medium++; break;
            default: summary.low++;
        }
    }
    summary.files = files.size;
    return summary;
}

function relativePath(filePath: string, root: string): string {
    if (root && filePath.startsWith(root)) {
        const rel = filePath.slice(root.length).replace(/^[\\/]/, '');
        return rel || filePath;
    }
    return filePath;
}

function groupByFile(pairs: DocCodePair[]): Map<string, DocCodePair[]> {
    const map = new Map<string, DocCodePair[]>();
    for (const pair of pairs) {
        const list = map.get(pair.filePath) || [];
        list.push(pair);
        map.set(pair.filePath, list);
    }
    return map;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeMarkdownCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function pct(score: number): string {
    return `${Math.round(score * 100)}%`;
}

/**
 * Generate a Markdown report.
 */
export function generateMarkdownReport(allPairs: DocCodePair[], options: ReportOptions): string {
    const pairs = selectReportPairs(allPairs, options);
    const summary = summarize(pairs);
    const generatedAt = options.generatedAt ?? new Date();
    const lines: string[] = [];

    lines.push(`# Drift Report: ${options.workspaceName}`);
    lines.push('');
    lines.push(`Generated ${generatedAt.toISOString()} by [Drift](https://marketplace.visualstudio.com/items?itemName=pallaprolus.drift)`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Issues | ${summary.total} |`);
    lines.push(`| Files affected | ${summary.files} |`);
    lines.push(`| 🔴 Critical | ${summary.critical} |`);
    lines.push(`| 🟠 High | ${summary.high} |`);
    lines.push(`| 🟡 Medium | ${summary.medium} |`);
    lines.push(`| ⚪ Low | ${summary.low} |`);
    lines.push('');

    if (pairs.length === 0) {
        lines.push('No documentation drift detected. ✓');
        lines.push('');
        return lines.join('\n');
    }

    lines.push('## Issues by File');
    lines.push('');

    for (const [filePath, filePairs] of groupByFile(pairs)) {
        const rel = relativePath(filePath, options.workspaceRoot);
        lines.push(`### ${rel}`);
        lines.push('');
        lines.push('| Severity | Symbol | Line | Score | Issues |');
        lines.push('|----------|--------|------|-------|--------|');
        for (const pair of filePairs) {
            const severity = severityFromScore(pair.driftScore);
            const issues = pair.driftReasons.map(r => escapeMarkdownCell(r.message)).join('<br>');
            const status = pair.isReviewed ? ' (reviewed)' : '';
            lines.push(`| ${SEVERITY_ICON[severity]} ${severity}${status} | \`${escapeMarkdownCell(pair.codeSignature.name)}\` | ${pair.docRange.start.line + 1} | ${pct(pair.driftScore)} | ${issues} |`);
        }
        lines.push('');

        // Details with reason descriptions
        for (const pair of filePairs) {
            const detailed = pair.driftReasons.filter(r => r.details);
            if (detailed.length === 0) {
                continue;
            }
            lines.push(`<details><summary><code>${escapeHtml(pair.codeSignature.name)}</code> details</summary>`);
            lines.push('');
            for (const reason of detailed) {
                lines.push(`- **${reason.message}**  `);
                lines.push(`  ${reason.details}`);
            }
            const git = options.gitInfo?.get(pair.id);
            if (git && (git.docLastChanged || git.codeLastChanged)) {
                lines.push(`- Git: docs last changed ${git.docLastChanged?.toISOString().slice(0, 10) ?? 'n/a'}, code last changed ${git.codeLastChanged?.toISOString().slice(0, 10) ?? 'n/a'}`);
            }
            lines.push('');
            lines.push('</details>');
            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * Generate a self-contained HTML report.
 */
export function generateHtmlReport(allPairs: DocCodePair[], options: ReportOptions): string {
    const pairs = selectReportPairs(allPairs, options);
    const summary = summarize(pairs);
    const generatedAt = options.generatedAt ?? new Date();

    const rows: string[] = [];
    for (const [filePath, filePairs] of groupByFile(pairs)) {
        const rel = escapeHtml(relativePath(filePath, options.workspaceRoot));
        rows.push(`<section class="file"><h3>${rel}</h3><table><thead><tr><th>Severity</th><th>Symbol</th><th>Line</th><th>Score</th><th>Issues</th></tr></thead><tbody>`);
        for (const pair of filePairs) {
            const severity = severityFromScore(pair.driftScore);
            const issues = pair.driftReasons.map(r => {
                const details = r.details ? `<div class="details">${escapeHtml(r.details)}</div>` : '';
                return `<div class="issue"><span class="msg">${escapeHtml(r.message)}</span>${details}</div>`;
            }).join('');
            const git = options.gitInfo?.get(pair.id);
            const gitLine = git && (git.docLastChanged || git.codeLastChanged)
                ? `<div class="git">docs ${git.docLastChanged?.toISOString().slice(0, 10) ?? 'n/a'} · code ${git.codeLastChanged?.toISOString().slice(0, 10) ?? 'n/a'}</div>`
                : '';
            const reviewed = pair.isReviewed ? ' <span class="reviewed">reviewed</span>' : '';
            rows.push(`<tr class="sev-${severity}"><td><span class="badge ${severity}">${SEVERITY_ICON[severity]} ${severity}</span>${reviewed}</td><td><code>${escapeHtml(pair.codeSignature.name)}</code></td><td>${pair.docRange.start.line + 1}</td><td>${pct(pair.driftScore)}</td><td>${issues}${gitLine}</td></tr>`);
        }
        rows.push('</tbody></table></section>');
    }

    const empty = pairs.length === 0 ? '<p class="empty">No documentation drift detected. ✓</p>' : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drift Report: ${escapeHtml(options.workspaceName)}</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --card: #f6f8fa; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d; --card: #161b22; } }
  body { margin: 0; padding: 2rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: var(--muted); margin-bottom: 2rem; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 2rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; }
  .stat .label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat .value { font-size: 1.6rem; font-weight: 600; }
  section.file { margin-bottom: 2rem; }
  h3 { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  .badge { white-space: nowrap; font-weight: 600; text-transform: capitalize; }
  .reviewed { color: var(--muted); font-size: 0.8rem; margin-left: 0.4rem; }
  .issue { margin-bottom: 0.35rem; }
  .issue .details, .git { color: var(--muted); font-size: 0.82rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--card); padding: 0.1rem 0.3rem; border-radius: 4px; }
  .empty { background: var(--card); border: 1px solid var(--border); padding: 1rem; border-radius: 8px; }
  footer { color: var(--muted); font-size: 0.8rem; margin-top: 3rem; }
</style>
</head>
<body>
<main>
  <h1>Drift Report</h1>
  <div class="meta">${escapeHtml(options.workspaceName)} · generated ${generatedAt.toISOString()}</div>
  <div class="summary">
    <div class="stat"><div class="label">Issues</div><div class="value">${summary.total}</div></div>
    <div class="stat"><div class="label">Files</div><div class="value">${summary.files}</div></div>
    <div class="stat"><div class="label">🔴 Critical</div><div class="value">${summary.critical}</div></div>
    <div class="stat"><div class="label">🟠 High</div><div class="value">${summary.high}</div></div>
    <div class="stat"><div class="label">🟡 Medium</div><div class="value">${summary.medium}</div></div>
    <div class="stat"><div class="label">⚪ Low</div><div class="value">${summary.low}</div></div>
  </div>
  ${empty}
  ${rows.join('\n')}
  <footer>Generated by <a href="https://marketplace.visualstudio.com/items?itemName=pallaprolus.drift">Drift - Documentation Sync Detector</a></footer>
</main>
</body>
</html>
`;
}

/**
 * Generate a machine-readable JSON report.
 */
export function generateJsonReport(allPairs: DocCodePair[], options: ReportOptions): string {
    const pairs = selectReportPairs(allPairs, options);
    const summary = summarize(pairs);
    const generatedAt = options.generatedAt ?? new Date();

    const issues = pairs.map(pair => {
        const git = options.gitInfo?.get(pair.id);
        return {
            id: pair.id,
            file: relativePath(pair.filePath, options.workspaceRoot),
            symbol: pair.codeSignature.name,
            symbolType: pair.codeSignature.type,
            docType: pair.docType,
            line: pair.docRange.start.line + 1,
            codeLine: pair.codeRange.start.line + 1,
            score: Math.round(pair.driftScore * 1000) / 1000,
            severity: severityFromScore(pair.driftScore),
            reviewed: pair.isReviewed,
            reasons: pair.driftReasons.map(r => ({
                type: r.type,
                severity: r.severity,
                message: r.message,
                details: r.details
            })),
            git: git ? {
                docLastChanged: git.docLastChanged?.toISOString(),
                codeLastChanged: git.codeLastChanged?.toISOString(),
                codeChangedInWorkingTree: git.codeChangedInWorkingTree,
                docChangedInWorkingTree: git.docChangedInWorkingTree
            } : undefined
        };
    });

    return JSON.stringify({
        tool: 'drift',
        workspace: options.workspaceName,
        generatedAt: generatedAt.toISOString(),
        summary,
        issues
    }, null, 2);
}

export function generateReport(format: ReportFormat, pairs: DocCodePair[], options: ReportOptions): string {
    switch (format) {
        case 'html': return generateHtmlReport(pairs, options);
        case 'json': return generateJsonReport(pairs, options);
        default: return generateMarkdownReport(pairs, options);
    }
}

export { SEVERITY_ORDER };
