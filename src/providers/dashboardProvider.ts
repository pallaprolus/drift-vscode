import * as vscode from 'vscode';
import { DocCodePair, DriftSeverity } from '../models/types';
import * as path from 'path';

/**
 * Tree item representing a drift issue in the dashboard
 */
export class DriftTreeItem extends vscode.TreeItem {
    constructor(
        public readonly pair: DocCodePair,
        public readonly workspaceFolder: string
    ) {
        const severity = DriftTreeItem.getSeverityFromScore(pair.driftScore);
        const icon = DriftTreeItem.getSeverityIcon(severity);
        
        super(
            `${icon} ${pair.codeSignature.name}`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        
        // Set relative file path as description
        const relativePath = path.relative(workspaceFolder, pair.filePath);
        this.description = `${relativePath}:${pair.docRange.start.line + 1}`;
        
        // Set tooltip
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${pair.codeSignature.name}**\n\n`);
        this.tooltip.appendMarkdown(`Drift Score: ${Math.round(pair.driftScore * 100)}%\n\n`);
        this.tooltip.appendMarkdown(`File: ${relativePath}\n\n`);
        this.tooltip.appendMarkdown(`Line: ${pair.docRange.start.line + 1}`);
        
        // Set icon
        this.iconPath = new vscode.ThemeIcon(
            this.getThemeIconName(severity),
            this.getIconColor(severity)
        );
        
        // Set context value for menu items
        this.contextValue = 'driftItem';
        
        // Set command to open file at location
        this.command = {
            command: 'vscode.open',
            title: 'Open',
            arguments: [
                vscode.Uri.file(pair.filePath),
                {
                    selection: new vscode.Range(pair.docRange.start, pair.docRange.end)
                }
            ]
        };
    }
    
    private getThemeIconName(severity: DriftSeverity): string {
        switch (severity) {
            case DriftSeverity.Critical: return 'error';
            case DriftSeverity.High: return 'warning';
            case DriftSeverity.Medium: return 'info';
            case DriftSeverity.Low: return 'circle-outline';
            default: return 'question';
        }
    }
    
    private getIconColor(severity: DriftSeverity): vscode.ThemeColor {
        switch (severity) {
            case DriftSeverity.Critical: return new vscode.ThemeColor('errorForeground');
            case DriftSeverity.High: return new vscode.ThemeColor('editorWarning.foreground');
            case DriftSeverity.Medium: return new vscode.ThemeColor('editorInfo.foreground');
            case DriftSeverity.Low: return new vscode.ThemeColor('foreground');
            default: return new vscode.ThemeColor('foreground');
        }
    }
    
    private static getSeverityFromScore(score: number): DriftSeverity {
        if (score >= 0.8) return DriftSeverity.Critical;
        if (score >= 0.6) return DriftSeverity.High;
        if (score >= 0.4) return DriftSeverity.Medium;
        return DriftSeverity.Low;
    }
    
    private static getSeverityIcon(severity: DriftSeverity): string {
        switch (severity) {
            case DriftSeverity.Critical: return '🔴';
            case DriftSeverity.High: return '🟠';
            case DriftSeverity.Medium: return '🟡';
            case DriftSeverity.Low: return '⚪';
            default: return '❓';
        }
    }
}

/**
 * Tree item for drift reasons (children of DriftTreeItem)
 */
export class DriftReasonItem extends vscode.TreeItem {
    constructor(
        public readonly message: string,
        public readonly details: string | undefined,
        public readonly severity: DriftSeverity
    ) {
        super(message, vscode.TreeItemCollapsibleState.None);
        
        this.description = details;
        
        this.iconPath = new vscode.ThemeIcon(
            this.getThemeIconName(severity),
            this.getIconColor(severity)
        );
    }
    
    private getThemeIconName(severity: DriftSeverity): string {
        switch (severity) {
            case DriftSeverity.Critical: return 'circle-filled';
            case DriftSeverity.High: return 'circle-filled';
            case DriftSeverity.Medium: return 'circle-outline';
            case DriftSeverity.Low: return 'dash';
            default: return 'dash';
        }
    }
    
    private getIconColor(severity: DriftSeverity): vscode.ThemeColor {
        switch (severity) {
            case DriftSeverity.Critical: return new vscode.ThemeColor('errorForeground');
            case DriftSeverity.High: return new vscode.ThemeColor('editorWarning.foreground');
            case DriftSeverity.Medium: return new vscode.ThemeColor('editorInfo.foreground');
            case DriftSeverity.Low: return new vscode.ThemeColor('foreground');
            default: return new vscode.ThemeColor('foreground');
        }
    }
}

/**
 * Tree item for file grouping
 */
export class FileGroupItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly pairs: DocCodePair[],
        public readonly workspaceFolder: string
    ) {
        const relativePath = path.relative(workspaceFolder, filePath);
        const maxSeverity = Math.max(...pairs.map(p => p.driftScore));
        
        super(relativePath, vscode.TreeItemCollapsibleState.Expanded);
        
        this.description = `${pairs.length} issue${pairs.length > 1 ? 's' : ''}`;
        this.iconPath = vscode.ThemeIcon.File;
        this.resourceUri = vscode.Uri.file(filePath);
        this.contextValue = 'fileGroup';
    }
}

/**
 * Tree data provider for the drift dashboard
 */
export class DriftDashboardProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private pairs: DocCodePair[] = [];
    private groupByFile = true;
    private workspaceFolder: string = '';
    
    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            this.workspaceFolder = folders[0].uri.fsPath;
        }
    }
    
    /**
     * Update the pairs displayed in the dashboard
     */
    updatePairs(pairs: DocCodePair[]): void {
        // Sort by drift score descending
        this.pairs = pairs
            .filter(p => !p.isReviewed && p.driftScore > 0)
            .sort((a, b) => b.driftScore - a.driftScore);
        
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * Mark a pair as reviewed
     */
    markAsReviewed(pairId: string): void {
        const pair = this.pairs.find(p => p.id === pairId);
        if (pair) {
            pair.isReviewed = true;
            pair.reviewedAt = new Date();
            this._onDidChangeTreeData.fire();
        }
    }
    
    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * Toggle grouping by file
     */
    toggleGroupByFile(): void {
        this.groupByFile = !this.groupByFile;
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * Get tree item for an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
    
    /**
     * Get children for an element
     */
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (!element) {
            // Root level
            if (this.pairs.length === 0) {
                return [this.createEmptyStateItem()];
            }
            
            if (this.groupByFile) {
                return this.getFileGroups();
            } else {
                return this.pairs.map(pair => new DriftTreeItem(pair, this.workspaceFolder));
            }
        }
        
        if (element instanceof FileGroupItem) {
            return element.pairs.map(pair => new DriftTreeItem(pair, this.workspaceFolder));
        }
        
        if (element instanceof DriftTreeItem) {
            return element.pair.driftReasons.map(
                reason => new DriftReasonItem(reason.message, reason.details, reason.severity)
            );
        }
        
        return [];
    }
    
    /**
     * Get file group items
     */
    private getFileGroups(): FileGroupItem[] {
        const fileMap = new Map<string, DocCodePair[]>();
        
        for (const pair of this.pairs) {
            const existing = fileMap.get(pair.filePath) || [];
            existing.push(pair);
            fileMap.set(pair.filePath, existing);
        }
        
        return Array.from(fileMap.entries())
            .map(([filePath, pairs]) => new FileGroupItem(filePath, pairs, this.workspaceFolder))
            .sort((a, b) => {
                const maxA = Math.max(...a.pairs.map(p => p.driftScore));
                const maxB = Math.max(...b.pairs.map(p => p.driftScore));
                return maxB - maxA;
            });
    }
    
    /**
     * Create an item for empty state
     */
    private createEmptyStateItem(): vscode.TreeItem {
        const item = new vscode.TreeItem('No documentation drift detected ✓');
        item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        item.description = 'Run "Drift: Scan Workspace" to check';
        return item;
    }
    
    /**
     * Get the pair by ID
     */
    getPairById(id: string): DocCodePair | undefined {
        return this.pairs.find(p => p.id === id);
    }
    
    /**
     * Get all pairs
     */
    getAllPairs(): DocCodePair[] {
        return this.pairs;
    }
    
    /**
     * Get statistics
     */
    getStatistics(): { total: number; critical: number; high: number; medium: number; low: number } {
        return {
            total: this.pairs.length,
            critical: this.pairs.filter(p => p.driftScore >= 0.8).length,
            high: this.pairs.filter(p => p.driftScore >= 0.6 && p.driftScore < 0.8).length,
            medium: this.pairs.filter(p => p.driftScore >= 0.4 && p.driftScore < 0.6).length,
            low: this.pairs.filter(p => p.driftScore < 0.4).length
        };
    }
}
