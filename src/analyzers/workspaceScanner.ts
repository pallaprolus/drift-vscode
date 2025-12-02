import * as vscode from 'vscode';
import { ParserRegistry } from '../parsers/parserRegistry';
import { DriftAnalyzer } from '../analyzers/driftAnalyzer';
import { DocCodePair, DriftConfig } from '../models/types';
import { BaseParser } from '../parsers/baseParser';
import { minimatch } from 'minimatch';
import { DriftLogger } from '../utils/logger';

/**
 * Scans the workspace for documentation drift
 */
export class WorkspaceScanner {
    private parserRegistry: ParserRegistry;
    private analyzer: DriftAnalyzer;
    private config: DriftConfig;
    private scanResults: Map<string, DocCodePair[]> = new Map();

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

        const allPairs: DocCodePair[] = [];

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

                    // Store results by file
                    this.scanResults.set(fileUri.fsPath, pairs);
                } catch (error) {
                    DriftLogger.error(`Error scanning ${fileUri.fsPath}:`, error);
                }

                processedFiles++;
                progress?.report({
                    message: `Scanning ${folder.name}... (${processedFiles}/${totalFiles})`,
                    increment: (1 / totalFiles) * 100
                });
            }
        }

        return allPairs;
    }

    /**
     * Scan a single document
     */
    async scanDocument(document: vscode.TextDocument): Promise<DocCodePair[]> {
        // Check if file should be excluded
        if (this.shouldExclude(document.uri.fsPath)) {
            return [];
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
        const analyzedPairs = pairs.map(pair =>
            this.analyzer.analyzePair(pair, parser as BaseParser)
        );

        // Store results
        this.scanResults.set(document.uri.fsPath, analyzedPairs);

        return analyzedPairs;
    }

    /**
     * Get cached results for a file
     */
    getResultsForFile(filePath: string): DocCodePair[] | undefined {
        return this.scanResults.get(filePath);
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
     * Clear cached results
     */
    clearResults(): void {
        this.scanResults.clear();
    }

    /**
     * Clear results for a specific file
     */
    clearResultsForFile(filePath: string): void {
        this.scanResults.delete(filePath);
    }

    /**
     * Find all supported files in a folder
     */
    private async findSupportedFiles(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
        const supportedExtensions = this.getSupportedExtensions();
        const pattern = `**/*{${supportedExtensions.join(',')}}`;

        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folderUri, pattern),
            this.getExcludePattern()
        );

        return files;
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
