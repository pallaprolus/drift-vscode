import * as vscode from 'vscode';
import {
    DocCodePair,
    DocType,
    ParsedDoc,
    CodeSignature,
    CodeType,
    ParameterInfo,
    DocParam,
    LanguageParser
} from '../models/types';
import { hashContent, generatePairId } from '../utils/helpers';

/**
 * Base parser with common functionality for all languages
 */
export abstract class BaseParser implements LanguageParser {
    abstract languageId: string;
    abstract fileExtensions: string[];

    abstract parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]>;

    /**
     * Parse documentation content based on doc type
     */
    parseDocumentation(content: string, docType: DocType): ParsedDoc {
        switch (docType) {
            case DocType.JSDoc:
            case DocType.JavaDoc:
                return this.parseJSDocStyle(content);
            case DocType.PyDoc:
                return this.parsePyDocStyle(content);
            case DocType.GoDoc:
                return this.parseGoDocStyle(content);
            case DocType.RustDoc:
                return this.parseRustDocStyle(content);
            default:
                return this.parseGenericComment(content);
        }
    }

    /**
     * Extract code signature - to be implemented by subclasses
     */
    abstract extractCodeSignature(content: string, range: vscode.Range): CodeSignature;

    /**
     * Parse JSDoc/JavaDoc style documentation
     */
    protected parseJSDocStyle(content: string): ParsedDoc {
        const result: ParsedDoc = {
            description: '',
            params: [],
            tags: []
        };

        // Remove comment markers
        const cleanContent = content
            .replace(/^\/\*\*?/gm, '')
            .replace(/\*\/$/gm, '')
            .replace(/^\s*\*\s?/gm, '')
            .trim();

        const lines = cleanContent.split('\n');
        const descriptionLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // Parse @param
            const paramMatch = trimmed.match(/@param\s+(?:\{([^}]*)\}\s+)?(\w+)\s*(.*)/);
            if (paramMatch) {
                result.params.push({
                    name: paramMatch[2],
                    type: paramMatch[1],
                    description: paramMatch[3] || '',
                    isOptional: paramMatch[1]?.includes('=') || false
                });
                continue;
            }

            // Parse @returns/@return
            const returnMatch = trimmed.match(/@returns?\s+(?:\{([^}]*)\}\s*)?(.*)/);
            if (returnMatch) {
                result.returns = {
                    type: returnMatch[1],
                    description: returnMatch[2] || ''
                };
                continue;
            }

            // Parse @throws/@exception
            const throwsMatch = trimmed.match(/@(?:throws|exception)\s+(?:\{([^}]*)\}\s*)?(.*)/);
            if (throwsMatch) {
                if (!result.throws) result.throws = [];
                result.throws.push({
                    type: throwsMatch[1],
                    description: throwsMatch[2] || ''
                });
                continue;
            }

            // Parse @deprecated
            const deprecatedMatch = trimmed.match(/@deprecated\s*(.*)/);
            if (deprecatedMatch) {
                result.deprecated = deprecatedMatch[1] || 'Deprecated';
                continue;
            }

            // Parse @since
            const sinceMatch = trimmed.match(/@since\s+(.*)/);
            if (sinceMatch) {
                result.since = sinceMatch[1];
                continue;
            }

            // Parse @example
            const exampleMatch = trimmed.match(/@example\s*(.*)/);
            if (exampleMatch) {
                if (!result.examples) result.examples = [];
                result.examples.push(exampleMatch[1] || '');
                continue;
            }

            // Parse other tags
            const tagMatch = trimmed.match(/@(\w+)\s*(.*)/);
            if (tagMatch) {
                result.tags.push({
                    name: tagMatch[1],
                    value: tagMatch[2] || ''
                });
                continue;
            }

            // Add to description if not a tag
            if (!trimmed.startsWith('@')) {
                descriptionLines.push(trimmed);
            }
        }

        result.description = descriptionLines.join(' ').trim();
        return result;
    }

    /**
     * Parse Python docstring style documentation
     */
    protected parsePyDocStyle(content: string): ParsedDoc {
        const result: ParsedDoc = {
            description: '',
            params: [],
            tags: []
        };

        // Remove docstring quotes
        const cleanContent = content
            .replace(/^['"`]{3}/gm, '')
            .replace(/['"`]{3}$/gm, '')
            .trim();

        const sections = cleanContent.split(/\n\s*\n/);

        if (sections.length > 0) {
            result.description = sections[0].trim();
        }

        // Try Sphinx style first/also
        this.parseSphinxStyle(cleanContent, result);

        // Try NumPy style
        this.parseNumPyStyle(cleanContent, result);

        // Parse Args/Parameters section
        const argsPattern = /(?:Args|Parameters|Params):\s*\n((?:\s+\w+.*\n?)+)/gi;
        const argsMatch = cleanContent.match(argsPattern);
        if (argsMatch) {
            const paramPattern = /^\s+(\w+)(?:\s*\(([^)]+)\))?:\s*(.*)$/gm;
            let paramMatch;
            while ((paramMatch = paramPattern.exec(argsMatch[0])) !== null) {
                result.params.push({
                    name: paramMatch[1],
                    type: paramMatch[2],
                    description: paramMatch[3] || '',
                    isOptional: false
                });
            }
        }

        // Parse Returns section
        const returnsPattern = /Returns:\s*\n?\s*(?:(\w+):\s*)?(.+)/i;
        const returnsMatch = cleanContent.match(returnsPattern);
        if (returnsMatch) {
            result.returns = {
                type: returnsMatch[1],
                description: returnsMatch[2] || ''
            };
        }

        // Parse Raises section
        const raisesPattern = /Raises:\s*\n((?:\s+\w+.*\n?)+)/gi;
        const raisesMatch = cleanContent.match(raisesPattern);
        if (raisesMatch) {
            result.throws = [];
            const throwPattern = /^\s+(\w+):\s*(.*)$/gm;
            let throwMatch;
            while ((throwMatch = throwPattern.exec(raisesMatch[0])) !== null) {
                result.throws.push({
                    type: throwMatch[1],
                    description: throwMatch[2] || ''
                });
            }
        }

        return result;
    }

    /**
     * Parse Sphinx-style docstrings (:param, :return, etc.)
     * Returns true if Sphinx style was detected and parsed
     */
    private parseSphinxStyle(cleanContent: string, result: ParsedDoc): boolean {
        let foundSphinx = false;
        const lines = cleanContent.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // :param [type] name: description
            const paramMatch = trimmed.match(/^:param\s+(.+?):\s*(.*)$/);
            if (paramMatch) {
                foundSphinx = true;
                const paramSig = paramMatch[1].trim();
                const desc = paramMatch[2] || '';

                // Extract type/name from the signature part
                // Case 1: "name"
                // Case 2: "type name"
                const parts = paramSig.split(/\s+/);
                const name = parts.pop() || ''; // Last part is name
                const type = parts.join(' ');   // Rest is type

                if (name) {
                    // Check if already exists (Google style mixed with Sphinx?)
                    const existing = result.params.find(p => p.name === name);
                    if (!existing) {
                        result.params.push({
                            name,
                            type,
                            description: desc,
                            isOptional: false
                        });
                    }
                }
                continue;
            }

            // :type name: type
            const typeMatch = trimmed.match(/^:type\s+(\w+):\s*(.*)$/);
            if (typeMatch) {
                foundSphinx = true;
                const name = typeMatch[1];
                const type = typeMatch[2];

                // Find existing param to update logic
                const existing = result.params.find(p => p.name === name);
                if (existing) {
                    existing.type = type;
                }
                continue;
            }

            // :return: description or :returns:
            const returnMatch = trimmed.match(/^:(?:return|returns):\s*(.*)$/);
            if (returnMatch) {
                foundSphinx = true;
                if (!result.returns) {
                    result.returns = { type: '', description: '' };
                }
                result.returns.description = returnMatch[1];
                continue;
            }

            // :rtype: type
            const rtypeMatch = trimmed.match(/^:rtype:\s*(.*)$/);
            if (rtypeMatch) {
                foundSphinx = true;
                if (!result.returns) {
                    result.returns = { type: '', description: '' };
                }
                result.returns.type = rtypeMatch[1];
                continue;
            }
        }

        return foundSphinx;
    }

    /**
     * Parse NumPy-style docstrings (Parameters\n----------)
     */
    private parseNumPyStyle(cleanContent: string, result: ParsedDoc): void {
        const lines = cleanContent.split('\n');
        let currentSection = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Detect section headers
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                // Check for underline (at least 3 dashes) matching roughly the header length? 
                // NumPy usually strictly requires dashes.
                if (nextLine.startsWith('---') && nextLine.length >= 3) {
                    currentSection = trimmed.toLowerCase();
                    i++; // Skip the underline
                    continue;
                }
            }

            if (currentSection === 'parameters') {
                // Parse parameter: name : type
                // description continues on next indented lines
                const paramMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
                if (paramMatch) {
                    const name = paramMatch[1];
                    const typeInfo = paramMatch[2];

                    // Check for optional
                    const isOptional = typeInfo.toLowerCase().includes('optional');
                    const cleanType = typeInfo.replace(/,\s*optional/i, '').trim();

                    // Avoid duplicates
                    if (!result.params.some(p => p.name === name)) {
                        result.params.push({
                            name,
                            type: cleanType,
                            description: '', // TODO: Extract description from following lines
                            isOptional
                        });
                    }
                }
            } else if (currentSection === 'returns') {
                // Parse returns: type
                // OR name : type
                if (trimmed && !result.returns) {
                    const returnMatch = trimmed.match(/^(?:(\w+)\s*:\s*)?(.+)$/);
                    if (returnMatch) {
                        // heuristic: if colon exists, part 2 is type. If no colon, entire string might be type or desc?
                        // NumPy returns: "type" or "name : type"
                        const hasColon = trimmed.includes(':');
                        if (hasColon) {
                            result.returns = {
                                type: returnMatch[2],
                                description: ''
                            };
                        } else {
                            result.returns = {
                                type: trimmed,
                                description: ''
                            };
                        }
                    }
                }
            }
        }
    }






    /**
     * Parse Go-style documentation (comment blocks before declarations)
     */
    protected parseGoDocStyle(content: string): ParsedDoc {
        const result: ParsedDoc = {
            description: '',
            params: [],
            tags: []
        };

        // Go docs are simple comment lines
        const cleanContent = content
            .replace(/^\/\/\s?/gm, '')
            .trim();

        result.description = cleanContent;

        // Go doesn't have formal param documentation, but we can extract
        // mentioned parameter names
        const words = cleanContent.split(/\s+/);
        // Parameters are often mentioned in the description

        return result;
    }

    /**
     * Parse Rust doc comments (//! or ///)
     */
    protected parseRustDocStyle(content: string): ParsedDoc {
        const result: ParsedDoc = {
            description: '',
            params: [],
            tags: []
        };

        const cleanContent = content
            .replace(/^\/\/[\/!]\s?/gm, '')
            .trim();

        const lines = cleanContent.split('\n');
        const descriptionLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // Parse # Arguments section
            if (trimmed === '# Arguments') {
                continue;
            }

            // Parse argument items
            const argMatch = trimmed.match(/^\*\s+`(\w+)`\s*-\s*(.*)$/);
            if (argMatch) {
                result.params.push({
                    name: argMatch[1],
                    description: argMatch[2] || '',
                    isOptional: false
                });
                continue;
            }

            // Parse # Returns section
            if (trimmed === '# Returns') {
                continue;
            }

            // Parse # Examples section
            if (trimmed === '# Examples') {
                if (!result.examples) result.examples = [];
                continue;
            }

            descriptionLines.push(trimmed);
        }

        result.description = descriptionLines.join(' ').trim();
        return result;
    }

    /**
     * Parse generic comment without specific format
     */
    protected parseGenericComment(content: string): ParsedDoc {
        const cleanContent = content
            .replace(/^\/\*+/gm, '')
            .replace(/\*+\/$/gm, '')
            .replace(/^\/\/\s?/gm, '')
            .replace(/^\s*\*\s?/gm, '')
            .replace(/^#\s?/gm, '')
            .trim();

        return {
            description: cleanContent,
            params: [],
            tags: []
        };
    }

    /**
     * Create a DocCodePair from parsed data
     */
    protected createPair(
        filePath: string,
        docRange: vscode.Range,
        docContent: string,
        docType: DocType,
        codeRange: vscode.Range,
        codeContent: string,
        codeSignature: CodeSignature
    ): DocCodePair {
        return {
            id: generatePairId(filePath, docRange.start.line),
            filePath,
            docRange,
            docContent,
            docType,
            codeRange,
            codeContent,
            codeSignature,
            driftScore: 0,
            driftReasons: [],
            lastAnalyzed: new Date(),
            isReviewed: false
        };
    }

    /**
     * Helper to create a basic code signature
     */
    protected createBasicSignature(
        name: string,
        type: CodeType,
        content: string
    ): CodeSignature {
        return {
            name,
            type,
            parameters: [],
            modifiers: [],
            hash: hashContent(content)
        };
    }
}
