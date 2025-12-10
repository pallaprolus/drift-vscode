import * as vscode from 'vscode';
import { DocCodePair, DriftSeverity } from '../models/types';

/**
 * Provides decorations for documentation drift indicators
 */
export class DecorationProvider {
    private gutterDecorationType: vscode.TextEditorDecorationType;
    private inlineDecorationTypes: Map<DriftSeverity, vscode.TextEditorDecorationType>;
    private activeDecorations: Map<string, vscode.TextEditorDecorationType[]> = new Map();

    constructor() {
        // Create gutter decoration type
        this.gutterDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.getIconPath('warning'),
            gutterIconSize: 'contain'
        });

        // Create inline decoration types for different severities
        this.inlineDecorationTypes = new Map([
            [DriftSeverity.Critical, vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                border: '1px solid rgba(255, 0, 0, 0.3)',
                borderRadius: '3px',
                overviewRulerColor: 'rgba(255, 0, 0, 0.8)',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            })],
            [DriftSeverity.High, vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 165, 0, 0.1)',
                border: '1px solid rgba(255, 165, 0, 0.3)',
                borderRadius: '3px',
                overviewRulerColor: 'rgba(255, 165, 0, 0.8)',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            })],
            [DriftSeverity.Medium, vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.05)',
                border: '1px solid rgba(255, 255, 0, 0.2)',
                borderRadius: '3px'
            })],
            [DriftSeverity.Low, vscode.window.createTextEditorDecorationType({
                // No visible decoration for low drift, just gutter if enabled
                // or maybe a very subtle underline
                textDecoration: 'underline dotted rgba(150, 150, 150, 0.5)'
            })]
        ]);
    }

    /**
     * Apply decorations for a list of doc-code pairs
     */
    applyDecorations(editor: vscode.TextEditor, pairs: DocCodePair[], config: { enableGutter: boolean; enableInline: boolean; threshold: number }): void {
        // Clear existing decorations for this editor
        this.clearDecorations(editor);

        const gutterRanges: vscode.DecorationOptions[] = [];
        const inlineRanges: Map<DriftSeverity, vscode.DecorationOptions[]> = new Map([
            [DriftSeverity.Critical, []],
            [DriftSeverity.High, []],
            [DriftSeverity.Medium, []],
            [DriftSeverity.Low, []]
        ]);

        for (const pair of pairs) {
            // Skip if below threshold or already reviewed
            if (pair.driftScore < config.threshold || pair.isReviewed) {
                continue;
            }

            // Determine severity based on drift score
            const severity = this.getSeverityFromScore(pair.driftScore);

            // Create hover message
            const hoverMessage = this.createHoverMessage(pair);

            // Add gutter decoration
            if (config.enableGutter) {
                gutterRanges.push({
                    range: new vscode.Range(pair.docRange.start, pair.docRange.start),
                    hoverMessage
                });
            }

            // Add inline decoration
            if (config.enableInline) {
                const inlineRange = inlineRanges.get(severity);
                if (inlineRange) {
                    // Place decoration at the end of the line
                    const line = editor.document.lineAt(pair.docRange.start.line);
                    inlineRange.push({
                        range: new vscode.Range(line.range.end, line.range.end),
                        hoverMessage
                    });
                }
            }
        }

        // Apply gutter decorations
        if (config.enableGutter && gutterRanges.length > 0) {
            editor.setDecorations(this.gutterDecorationType, gutterRanges);
            this.trackDecoration(editor.document.uri.toString(), this.gutterDecorationType);
        }

        // Apply inline decorations by severity
        if (config.enableInline) {
            for (const [severity, ranges] of inlineRanges) {
                if (ranges.length > 0) {
                    const decorationType = this.inlineDecorationTypes.get(severity);
                    if (decorationType) {
                        editor.setDecorations(decorationType, ranges);
                        this.trackDecoration(editor.document.uri.toString(), decorationType);
                    }
                }
            }
        }
    }

    /**
     * Clear decorations for an editor
     */
    clearDecorations(editor: vscode.TextEditor): void {
        const uri = editor.document.uri.toString();
        const decorations = this.activeDecorations.get(uri);

        if (decorations) {
            for (const decoration of decorations) {
                editor.setDecorations(decoration, []);
            }
            this.activeDecorations.delete(uri);
        }
    }

    /**
     * Clear all decorations across all editors
     */
    clearAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.clearDecorations(editor);
        }
        this.activeDecorations.clear();
    }

    /**
     * Track a decoration for later cleanup
     */
    private trackDecoration(uri: string, decoration: vscode.TextEditorDecorationType): void {
        const existing = this.activeDecorations.get(uri) || [];
        if (!existing.includes(decoration)) {
            existing.push(decoration);
        }
        this.activeDecorations.set(uri, existing);
    }

    /**
     * Get severity level from drift score
     */
    private getSeverityFromScore(score: number): DriftSeverity {
        if (score >= 0.8) return DriftSeverity.Critical;
        if (score >= 0.6) return DriftSeverity.High;
        if (score >= 0.4) return DriftSeverity.Medium;
        return DriftSeverity.Low;
    }

    /**
     * Create hover message for a drift warning
     */
    private createHoverMessage(pair: DocCodePair): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        const severity = this.getSeverityFromScore(pair.driftScore);
        const icon = this.getSeverityIcon(severity);

        md.appendMarkdown(`## ${icon} Documentation Drift Detected\n\n`);
        md.appendMarkdown(`**Drift Score:** ${Math.round(pair.driftScore * 100)}%\n\n`);
        md.appendMarkdown(`**Function:** \`${pair.codeSignature.name}\`\n\n`);

        if (pair.driftReasons.length > 0) {
            md.appendMarkdown('### Issues Found:\n\n');
            for (const reason of pair.driftReasons) {
                const reasonIcon = this.getSeverityIcon(reason.severity);
                md.appendMarkdown(`${reasonIcon} **${reason.message}**\n`);
                if (reason.details) {
                    md.appendMarkdown(`  - ${reason.details}\n`);
                }
                md.appendMarkdown('\n');
            }
        }

        // Add quick actions
        md.appendMarkdown('---\n\n');
        md.appendMarkdown(`[Mark as Reviewed](command:drift.markAsReviewed?${encodeURIComponent(JSON.stringify({ id: pair.id }))})`);
        md.appendMarkdown(' | ');
        md.appendMarkdown(`[Go to Code](command:drift.goToCode?${encodeURIComponent(JSON.stringify({ line: pair.codeRange.start.line }))})`);

        return md;
    }

    /**
     * Get icon for severity level
     */
    private getSeverityIcon(severity: DriftSeverity): string {
        switch (severity) {
            case DriftSeverity.Critical: return '🔴';
            case DriftSeverity.High: return '🟠';
            case DriftSeverity.Medium: return '🟡';
            case DriftSeverity.Low: return '⚪';
            default: return '❓';
        }
    }

    /**
     * Get path to gutter icon
     */
    private getIconPath(name: string): vscode.Uri {
        // For now, return a placeholder - in production, this would be an actual icon file
        return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6" fill="orange" opacity="0.8"/>
                <text x="8" y="11" text-anchor="middle" fill="white" font-size="10" font-weight="bold">!</text>
            </svg>`
        )}`);
    }

    /**
     * Dispose of all decoration types
     */
    dispose(): void {
        this.gutterDecorationType.dispose();
        for (const decoration of this.inlineDecorationTypes.values()) {
            decoration.dispose();
        }
    }
}
