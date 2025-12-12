import * as vscode from 'vscode';
import { BaseParser } from './baseParser';
import {
    DocCodePair,
    DocType,
    CodeSignature,
    CodeType,
    ParameterInfo
} from '../models/types';
import { hashContent } from '../utils/helpers';

/**
 * Parser for Python files
 */
export class PythonParser extends BaseParser {
    languageId = 'python';
    fileExtensions = ['.py', '.pyw', '.pyi'];

    async parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const pairs: DocCodePair[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            // Check for function or class definition
            const defMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\(|^class\s+(\w+)/);

            if (defMatch) {
                const codeStart = i;
                const isClass = trimmed.startsWith('class');

                // Find the end of the signature (might span multiple lines)
                let signatureEnd = i;
                if (!isClass) {
                    let parenDepth = 0;
                    let foundFirstParen = false;

                    for (let j = i; j < lines.length; j++) {
                        const sigLine = lines[j];
                        for (const char of sigLine) {
                            if (char === '(') {
                                parenDepth++;
                                foundFirstParen = true;
                            } else if (char === ')') {
                                parenDepth--;
                            }
                        }

                        if (foundFirstParen && parenDepth === 0) {
                            signatureEnd = j;
                            break;
                        }
                    }
                }

                // Look for docstring after the definition
                let docStart = signatureEnd + 1;

                // Skip to the line after the colon
                while (docStart < lines.length && !lines[docStart - 1].trim().endsWith(':')) {
                    docStart++;
                }

                // Skip empty lines
                while (docStart < lines.length && lines[docStart].trim() === '') {
                    docStart++;
                }

                // Check for docstring
                const docLine = lines[docStart]?.trim() || '';
                const docstringQuote = this.getDocstringQuote(docLine);

                if (docstringQuote) {
                    let docEnd = docStart;

                    // Handle single-line docstring
                    if (docLine.endsWith(docstringQuote) && docLine.length > docstringQuote.length * 2) {
                        docEnd = docStart;
                    } else {
                        // Multi-line docstring
                        docEnd = docStart + 1;
                        while (docEnd < lines.length) {
                            if (lines[docEnd].trim().endsWith(docstringQuote)) {
                                break;
                            }
                            docEnd++;
                        }
                    }

                    // Extract docstring content
                    const docLines = lines.slice(docStart, docEnd + 1);
                    const docContent = docLines.join('\n');
                    const docRange = new vscode.Range(
                        new vscode.Position(docStart, 0),
                        new vscode.Position(docEnd, lines[docEnd]?.length || 0)
                    );

                    // Find the end of the function/class body
                    const codeEnd = this.findBlockEnd(lines, codeStart, signatureEnd);
                    const codeContent = lines.slice(codeStart, codeEnd + 1).join('\n');
                    const codeRange = new vscode.Range(
                        new vscode.Position(codeStart, 0),
                        new vscode.Position(codeEnd, lines[codeEnd]?.length || 0)
                    );

                    const codeSignature = this.extractCodeSignature(codeContent, codeRange);

                    pairs.push(this.createPair(
                        document.uri.fsPath,
                        docRange,
                        docContent,
                        DocType.PyDoc,
                        codeRange,
                        codeContent,
                        codeSignature
                    ));

                    i = codeEnd;
                }
            }

            i++;
        }

        return pairs;
    }

    /**
     * Get the docstring quote style if the line starts with one
     */
    private getDocstringQuote(line: string): string | null {
        if (line.startsWith('"""')) return '"""';
        if (line.startsWith("'''")) return "'''";
        if (line.startsWith('"')) return '"';
        if (line.startsWith("'")) return "'";
        return null;
    }

    /**
     * Find the end of a Python block based on indentation
     */
    private findBlockEnd(lines: string[], startLine: number, searchStartLine?: number): number {
        const startIndent = this.getIndentation(lines[startLine]);

        let lastContentLine = searchStartLine !== undefined ? searchStartLine : startLine;
        const loopStart = (searchStartLine !== undefined ? searchStartLine : startLine) + 1;

        for (let i = loopStart; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }

            const indent = this.getIndentation(line);

            // If we find a line with equal or less indentation, the block ended
            if (indent <= startIndent && trimmed !== '') {
                break;
            }

            lastContentLine = i;
        }

        return lastContentLine;
    }

    /**
     * Get the indentation level of a line
     */
    private getIndentation(line: string): number {
        let indent = 0;
        for (const char of line) {
            if (char === ' ') {
                indent++;
            } else if (char === '\t') {
                indent += 4; // Treat tabs as 4 spaces
            } else {
                break;
            }
        }
        return indent;
    }

    extractCodeSignature(content: string, range: vscode.Range): CodeSignature {
        const lines = content.split('\n');
        const firstLine = lines[0].trim();

        let name = 'unknown';
        let type = CodeType.Function;
        const parameters: ParameterInfo[] = [];
        let returnType: string | undefined;
        const modifiers: string[] = [];

        // Check for async
        if (firstLine.startsWith('async ')) {
            modifiers.push('async');
        }

        // Check for class
        const classMatch = firstLine.match(/^class\s+(\w+)/);
        if (classMatch) {
            name = classMatch[1];
            type = CodeType.Class;
            return {
                name,
                type,
                parameters,
                returnType,
                modifiers,
                hash: hashContent(content)
            };
        }

        // Match function definition (potentially multi-line)
        const fullSignature = this.extractFullSignature(lines);
        const funcMatch = fullSignature.match(/(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?/s);

        if (funcMatch) {
            name = funcMatch[1];
            type = CodeType.Function;

            // Check for special methods
            if (name.startsWith('__') && name.endsWith('__')) {
                modifiers.push('dunder');
            }
            if (name.startsWith('_') && !name.startsWith('__')) {
                modifiers.push('private');
            }

            // Parse parameters
            const paramsStr = funcMatch[2];
            if (paramsStr) {
                const params = this.parseParameters(paramsStr);
                parameters.push(...params);
            }

            // Extract return type annotation
            if (funcMatch[3]) {
                returnType = funcMatch[3].trim();
            }
        }

        return {
            name,
            type,
            parameters,
            returnType,
            modifiers,
            hash: hashContent(content)
        };
    }

    /**
     * Extract the full function signature (may span multiple lines)
     */
    private extractFullSignature(lines: string[]): string {
        let signature = '';
        let parenDepth = 0;
        let foundFirstParen = false;

        for (const line of lines) {
            signature += line + '\n';

            for (const char of line) {
                if (char === '(') {
                    parenDepth++;
                    foundFirstParen = true;
                } else if (char === ')') {
                    parenDepth--;
                }
            }

            if (foundFirstParen && parenDepth === 0) {
                // Include potential return type annotation
                if (line.includes('->') || line.includes(':')) {
                    break;
                }
            }
        }

        return signature;
    }

    /**
     * Parse Python parameter string
     */
    private parseParameters(paramsStr: string): ParameterInfo[] {
        const params: ParameterInfo[] = [];

        if (!paramsStr.trim()) return params;

        // Split by comma, respecting nested brackets
        let depth = 0;
        let current = '';
        const parts: string[] = [];

        for (const char of paramsStr) {
            if (char === '[' || char === '(' || char === '{') {
                depth++;
                current += char;
            } else if (char === ']' || char === ')' || char === '}') {
                depth--;
                current += char;
            } else if (char === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) {
            parts.push(current.trim());
        }

        for (const part of parts) {
            const param = this.parseParameter(part);
            if (param) {
                params.push(param);
            }
        }

        return params;
    }

    /**
     * Parse a single Python parameter
     */
    private parseParameter(paramStr: string): ParameterInfo | null {
        const trimmed = paramStr.trim();
        if (!trimmed) return null;

        // Skip self, cls, *args, **kwargs style parameters for comparison purposes
        // but still track them
        const isSelf = trimmed === 'self' || trimmed === 'cls';
        const isRest = trimmed.startsWith('*') && !trimmed.startsWith('**');
        const isKwargs = trimmed.startsWith('**');

        // Handle *args and **kwargs
        if (isRest || isKwargs) {
            const argName = trimmed.replace(/^\*+/, '');
            const match = argName.match(/^(\w+)(?:\s*:\s*(.+))?$/);
            if (match) {
                return {
                    name: match[1],
                    type: match[2]?.trim(),
                    isOptional: true,
                    isRest: isRest || isKwargs
                };
            }
        }

        // Match: name: type = default
        const match = trimmed.match(/^(\w+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);

        if (match) {
            return {
                name: match[1],
                type: match[2]?.trim(),
                defaultValue: match[3]?.trim(),
                isOptional: !!match[3] || isSelf,
                isRest: false
            };
        }

        return null;
    }
}
