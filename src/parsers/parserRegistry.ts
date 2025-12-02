import * as vscode from 'vscode';
import { LanguageParser, DocCodePair } from '../models/types';
import { TypeScriptParser } from './typescriptParser';
import { PythonParser } from './pythonParser';

/**
 * Registry for language-specific parsers
 */
export class ParserRegistry {
    private static instance: ParserRegistry;
    private parsers: Map<string, LanguageParser> = new Map();
    private extensionMap: Map<string, string> = new Map();
    
    private constructor() {
        this.registerDefaultParsers();
    }
    
    static getInstance(): ParserRegistry {
        if (!ParserRegistry.instance) {
            ParserRegistry.instance = new ParserRegistry();
        }
        return ParserRegistry.instance;
    }
    
    /**
     * Register the default language parsers
     */
    private registerDefaultParsers(): void {
        const tsParser = new TypeScriptParser();
        this.registerParser(tsParser);
        
        // Also register for JavaScript
        this.parsers.set('javascript', tsParser);
        this.parsers.set('javascriptreact', tsParser);
        this.parsers.set('typescriptreact', tsParser);
        
        const pyParser = new PythonParser();
        this.registerParser(pyParser);
    }
    
    /**
     * Register a parser
     */
    registerParser(parser: LanguageParser): void {
        this.parsers.set(parser.languageId, parser);
        
        for (const ext of parser.fileExtensions) {
            this.extensionMap.set(ext, parser.languageId);
        }
    }
    
    /**
     * Get parser for a document
     */
    getParser(document: vscode.TextDocument): LanguageParser | undefined {
        // First try by language ID
        let parser = this.parsers.get(document.languageId);
        
        if (!parser) {
            // Try by file extension
            const ext = this.getFileExtension(document.uri.fsPath);
            const languageId = this.extensionMap.get(ext);
            if (languageId) {
                parser = this.parsers.get(languageId);
            }
        }
        
        return parser;
    }
    
    /**
     * Get parser by language ID
     */
    getParserByLanguageId(languageId: string): LanguageParser | undefined {
        return this.parsers.get(languageId);
    }
    
    /**
     * Check if a language is supported
     */
    isLanguageSupported(languageId: string): boolean {
        return this.parsers.has(languageId);
    }
    
    /**
     * Get all supported language IDs
     */
    getSupportedLanguages(): string[] {
        return Array.from(this.parsers.keys());
    }
    
    /**
     * Parse a document and return doc-code pairs
     */
    async parseDocument(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const parser = this.getParser(document);
        
        if (!parser) {
            return [];
        }
        
        try {
            return await parser.parseDocCodePairs(document);
        } catch (error) {
            console.error(`Error parsing document ${document.uri.fsPath}:`, error);
            return [];
        }
    }
    
    /**
     * Get file extension including the dot
     */
    private getFileExtension(filePath: string): string {
        const lastDot = filePath.lastIndexOf('.');
        if (lastDot === -1) return '';
        return filePath.slice(lastDot).toLowerCase();
    }
}
