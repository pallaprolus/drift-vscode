import * as vscode from 'vscode';
import { ParserRegistry } from '../parsers/parserRegistry';
import { DriftAnalyzer } from '../analyzers/driftAnalyzer';
import { CodeType, DocCodePair, DocType, DriftConfig, GitPairInfo } from '../models/types';
import { BaseParser } from '../parsers/baseParser';
import { minimatch } from 'minimatch';
import { DriftLogger } from '../utils/logger';
import { SymbolIndex } from './symbolIndex';
import { analyzeMarkdown } from './readmeAnalyzer';
import { GitTracker } from '../integrations/gitIntegration';
import { hashContent } from '../utils/helpers';

/**
 * Scans the workspace for documentation drift
 */
export class WorkspaceScanner {
    private parserRegistry: ParserRegistry;
    private analyzer: DriftAnalyzer;
    private config: DriftConfig;
    private scanResults: Map<string, DocCodePair[]> = new Map();
    private symbolIndex: SymbolIndex = new SymbolIndex();
    private gitTracker: GitTracker = new GitTracker();
    private gitInfo: Map<string, GitPairInfo> = new Map();
    private symbolIndexBuilt = false;

    constructor(config: DriftConfig) {
        this.parserRegistry = ParserRegistry.getInstance();
        this.analyzer = new DriftAnalyzer();
        this.config = config;
    }

    /**
     * Update configuration
     */
    updateConfig(config: DriftConfig): void {
        this.config = config;
    }

    /**
     * Scan the entire workspace
     */
    async scanWorkspace(
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<DocCodePair[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        this.scanResults.clear();
        this.symbolIndex.clear();
        this.gitInfo.clear();
        this.gitTracker.clear();

        const allPairs: DocCodePair[] = [];
        const markdownFiles: vscode.Uri[] = [];

        for (const folder of workspaceFolders) {
            progress?.report({ message: `Scanning ${folder.name}...` });

            const files = await this.findSupportedFiles(folder.uri);
            const totalFiles = files.length;
            let processedFiles = 0;

            for (const fileUri of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const pairs = await this.scanDocument(document);
                    allPairs.push(...pairs);
                } catch (error) {
                    DriftLogger.error(`Error scanning ${fileUri.fsPath}:`, error);
                }

                processedFiles++;
                progress?.report({
                    message: `Scanning ${folder.name}... (${processedFiles}/${totalFiles})`,
                    increment: (1 / totalFiles) * 100
                });
            }

            if (this.config.scanMarkdown) {
                markdownFiles.push(...await this.findMarkdownFiles(folder.uri));
            }
        }

        this.symbolIndexBuilt = true;

        // Markdown must be scanned after code so the symbol index is complete
        if (markdownFiles.length > 0) {
            progress?.report({ message: `Checking ${markdownFiles.length} Markdown file(s)...` });
            for (const fileUri of markdownFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const pairs = await this.scanMarkdownDocument(document);
                    allPairs.push(...pairs);
                } catch (error) {
                    DriftLogger.error(`Error scanning ${fileUri.fsPath}:`, error);
                }
            }
        }

        return allPairs;
    }

    /**
     * Scan a single document (code or markdown)
     */
    async scanDocument(document: vscode.TextDocument): Promise<DocCodePair[]> {
        // Check if file should be excluded
        if (this.shouldExclude(document.uri.fsPath)) {
            return [];
        }

        if (document.languageId === 'markdown') {
            if (!this.config.scanMarkdown || !this.matchesMarkdownPatterns(document.uri.fsPath)) {
                return [];
            }
            await this.ensureSymbolIndex();
            return this.scanMarkdownDocument(document);
        }

        // Check if language is supported
        if (!this.config.supportedLanguages.includes(document.languageId)) {
            return [];
        }

        // Get parser for this document
        const parser = this.parserRegistry.getParser(document);
        if (!parser) {
            return [];
        }

        // Parse doc-code pairs
        const pairs = await this.parserRegistry.parseDocument(document);

        // Analyze each pair for drift
        let analyzedPairs = pairs.map(pair =>
            this.analyzer.analyzePair(pair, parser as BaseParser)
        );

        // Git-based change tracking
        if (this.config.gitEnabled && document.uri.scheme === 'file') {
            analyzedPairs = await this.applyGitAnalysis(analyzedPairs, document);
        }

        // Store results
        this.scanResults.set(document.uri.fsPath, analyzedPairs);
        this.symbolIndex.updateFile(document.uri.fsPath, analyzedPairs);

        return analyzedPairs;
    }

    /**
     * Scan a Markdown document's code blocks against the symbol index.
     */
    async scanMarkdownDocument(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const filePath = document.uri.fsPath;
        const analyses = analyzeMarkdown(document.getText(), this.symbolIndex);
        const pairs: DocCodePair[] = [];

        for (const analysis of analyses) {
            if (analysis.reasons.length === 0) {
                continue;
            }

            const { block } = analysis;
            const docRange = new vscode.Range(block.startLine, 0, block.endLine, document.lineAt(block.endLine).text.length);
            const primary = analysis.matched[0];
            const name = analysis.primarySymbol ?? primary?.name ?? `code block (${block.language})`;

            const pair: DocCodePair = {
                id: `${hashContent(filePath)}-md-${block.startLine}`,
                filePath,
                docRange,
                docContent: block.content,
                docType: DocType.ReadmeCodeBlock,
                codeRange: docRange,
                codeContent: primary ? `${primary.filePath}:${primary.line + 1}` : '',
                codeSignature: primary
                    ? { ...primary.signature, name }
                    : {
                        name,
                        type: CodeType.Function,
                        parameters: [],
                        modifiers: [],
                        hash: hashContent(block.content)
                    },
                driftScore: this.analyzer.calculateDriftScore(analysis.reasons),
                driftReasons: analysis.reasons,
                lastAnalyzed: new Date(),
                isReviewed: false
            };

            pairs.push(pair);
        }

        this.scanResults.set(filePath, pairs);
        return pairs;
    }

    /**
     * Run git blame/diff analysis and merge reasons into pairs.
     */
    private async applyGitAnalysis(pairs: DocCodePair[], document: vscode.TextDocument): Promise<DocCodePair[]> {
        if (pairs.length === 0) {
            return pairs;
        }

        const contentKey = hashContent(document.getText());
        const results = await Promise.all(
            pairs.map(pair => this.gitTracker.analyzePair(pair, contentKey, this.config.gitStaleDays).catch(() => null))
        );

        return pairs.map((pair, i) => {
            const result = results[i];
            if (!result) {
                this.gitInfo.delete(pair.id);
                return pair;
            }

            this.gitInfo.set(pair.id, result.info);
            if (result.reasons.length === 0) {
                return pair;
            }

            const reasons = [...pair.driftReasons, ...result.reasons];
            return {
                ...pair,
                driftReasons: reasons,
                driftScore: this.analyzer.calculateDriftScore(reasons),
                lastCodeChange: result.info.codeLastChanged
            };
        });
    }

    /**
     * Make sure the symbol index has been populated at least once
     * (needed when a Markdown file is opened before a workspace scan).
     */
    async ensureSymbolIndex(): Promise<void> {
        if (this.symbolIndexBuilt) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        DriftLogger.log('Building symbol index for Markdown analysis...');
        for (const folder of workspaceFolders) {
            const files = await this.findSupportedFiles(folder.uri);
            for (const fileUri of files) {
                if (this.symbolIndex && this.scanResults.has(fileUri.fsPath)) {
                    continue;
                }
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const parser = this.parserRegistry.getParser(document);
                    if (!parser) {
                        continue;
                    }
                    const pairs = await this.parserRegistry.parseDocument(document);
                    this.symbolIndex.updateFile(fileUri.fsPath, pairs);
                } catch (error) {
                    DriftLogger.error(`Error indexing ${fileUri.fsPath}:`, error);
                }
            }
        }
        this.symbolIndexBuilt = true;
    }

    /**
     * Get cached results for a file
     */
    getResultsForFile(filePath: string): DocCodePair[] | undefined {
        return this.scanResults.get(filePath);
    }

    /**
     * Replace cached results for a file (used after semantic analysis updates a pair)
     */
    setResultsForFile(filePath: string, pairs: DocCodePair[]): void {
        this.scanResults.set(filePath, pairs);
    }

    /**
     * Get all cached results
     */
    getAllResults(): DocCodePair[] {
        const allPairs: DocCodePair[] = [];
        for (const pairs of this.scanResults.values()) {
            allPairs.push(...pairs);
        }
        return allPairs;
    }

    /**
     * Git metadata collected during scanning, keyed by pair id
     */
    getGitInfo(): Map<string, GitPairInfo> {
        return this.gitInfo;
    }

    getSymbolIndex(): SymbolIndex {
        return this.symbolIndex;
    }

    /**
     * Clear cached results
     */
    clearResults(): void {
        this.scanResults.clear();
        this.symbolIndex.clear();
        this.gitInfo.clear();
        this.symbolIndexBuilt = false;
    }

    /**
     * Clear results for a specific file
     */
    clearResultsForFile(filePath: string): void {
        this.scanResults.delete(filePath);
        this.symbolIndex.removeFile(filePath);
        this.gitTracker.invalidate(filePath);
    }

    /**
     * Find all supported files in a folder
     */
    private async findSupportedFiles(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
        const supportedExtensions = this.getSupportedExtensions();
        if (supportedExtensions.length === 0) {
            return [];
        }
        const pattern = `**/*{${supportedExtensions.join(',')}}`;

        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folderUri, pattern),
            this.getExcludePattern()
        );

        return files;
    }

    /**
     * Find Markdown files matching the configured patterns
     */
    private async findMarkdownFiles(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
        const patterns = this.config.markdownPatterns.length > 0
            ? this.config.markdownPatterns
            : ['**/README.md'];
        const pattern = patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;

        return vscode.workspace.findFiles(
            new vscode.RelativePattern(folderUri, pattern),
            this.getExcludePattern()
        );
    }

    private matchesMarkdownPatterns(filePath: string): boolean {
        const patterns = this.config.markdownPatterns.length > 0
            ? this.config.markdownPatterns
            : ['**/README.md'];
        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of folders) {
            const root = folder.uri.fsPath;
            if (!filePath.startsWith(root)) {
                continue;
            }
            const rel = filePath.slice(root.length).replace(/^[\\/]/, '').split('\\').join('/');
            for (const pattern of patterns) {
                if (minimatch(rel, pattern, { dot: true, nocase: true, matchBase: true })) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get supported file extensions
     */
    private getSupportedExtensions(): string[] {
        const extensions: string[] = [];

        for (const langId of this.config.supportedLanguages) {
            const parser = this.parserRegistry.getParserByLanguageId(langId);
            if (parser) {
                extensions.push(...parser.fileExtensions);
            }
        }

        return [...new Set(extensions)];
    }

    /**
     * Get exclude pattern from config
     */
    private getExcludePattern(): string {
        return `{${this.config.excludePatterns.join(',')}}`;
    }

    /**
     * Check if a file should be excluded
     */
    private shouldExclude(filePath: string): boolean {
        for (const pattern of this.config.excludePatterns) {
            if (minimatch(filePath, pattern, { dot: true })) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get analyzer instance (for comparing signatures on file change)
     */
    getAnalyzer(): DriftAnalyzer {
        return this.analyzer;
    }
}
