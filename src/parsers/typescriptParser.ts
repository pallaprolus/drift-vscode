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
 * Parser for TypeScript and JavaScript files
 */
export class TypeScriptParser extends BaseParser {
    languageId = 'typescript';
    fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    
    async parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const pairs: DocCodePair[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            
            // Check for JSDoc comment start
            if (line.trim().startsWith('/**')) {
                const docStart = i;
                let docEnd = i;
                
                // Find the end of the JSDoc comment
                while (docEnd < lines.length && !lines[docEnd].includes('*/')) {
                    docEnd++;
                }
                
                if (docEnd < lines.length) {
                    // Extract the documentation
                    const docLines = lines.slice(docStart, docEnd + 1);
                    const docContent = docLines.join('\n');
                    const docRange = new vscode.Range(
                        new vscode.Position(docStart, 0),
                        new vscode.Position(docEnd, lines[docEnd].length)
                    );
                    
                    // Find the code that follows
                    let codeStart = docEnd + 1;
                    
                    // Skip empty lines and decorators
                    while (codeStart < lines.length) {
                        const codeLine = lines[codeStart].trim();
                        if (codeLine === '' || codeLine.startsWith('@')) {
                            codeStart++;
                        } else {
                            break;
                        }
                    }
                    
                    if (codeStart < lines.length) {
                        // Determine the code block end
                        const codeInfo = this.findCodeBlock(lines, codeStart);
                        
                        if (codeInfo) {
                            const codeContent = lines.slice(codeStart, codeInfo.end + 1).join('\n');
                            const codeRange = new vscode.Range(
                                new vscode.Position(codeStart, 0),
                                new vscode.Position(codeInfo.end, lines[codeInfo.end]?.length || 0)
                            );
                            
                            const codeSignature = this.extractCodeSignature(codeContent, codeRange);
                            
                            pairs.push(this.createPair(
                                document.uri.fsPath,
                                docRange,
                                docContent,
                                DocType.JSDoc,
                                codeRange,
                                codeContent,
                                codeSignature
                            ));
                            
                            i = codeInfo.end;
                        }
                    }
                }
            }
            
            i++;
        }
        
        return pairs;
    }
    
    /**
     * Find the end of a code block (function, class, etc.)
     */
    private findCodeBlock(lines: string[], startLine: number): { end: number; type: CodeType } | null {
        const firstLine = lines[startLine].trim();
        
        // Determine the type of code block
        let type = CodeType.Function;
        if (firstLine.includes('class ')) {
            type = CodeType.Class;
        } else if (firstLine.includes('interface ')) {
            type = CodeType.Interface;
        } else if (firstLine.includes('type ')) {
            type = CodeType.Type;
        } else if (firstLine.match(/^(export\s+)?(const|let|var)\s+/)) {
            type = CodeType.Variable;
        }
        
        // For simple declarations without braces (arrow functions on one line, type aliases, etc.)
        if (!firstLine.includes('{') && (firstLine.includes('=>') || firstLine.includes('='))) {
            // Find the end of the statement (semicolon or next non-continuation line)
            let end = startLine;
            while (end < lines.length - 1) {
                const line = lines[end].trim();
                if (line.endsWith(';') || line.endsWith(',') || 
                    (!line.endsWith('=>') && !line.endsWith('(') && !line.endsWith(','))) {
                    break;
                }
                end++;
            }
            return { end, type };
        }
        
        // For blocks with braces, count brace depth
        let braceDepth = 0;
        let foundFirstBrace = false;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '{') {
                    braceDepth++;
                    foundFirstBrace = true;
                } else if (char === '}') {
                    braceDepth--;
                }
            }
            
            // If we've found at least one brace and we're back to 0 depth
            if (foundFirstBrace && braceDepth === 0) {
                return { end: i, type };
            }
        }
        
        // If no braces found, it's a single line
        if (!foundFirstBrace) {
            return { end: startLine, type };
        }
        
        return null;
    }
    
    extractCodeSignature(content: string, range: vscode.Range): CodeSignature {
        const firstLine = content.split('\n')[0].trim();
        
        // Extract function/method name and parameters
        let name = 'unknown';
        let type = CodeType.Function;
        const parameters: ParameterInfo[] = [];
        let returnType: string | undefined;
        const modifiers: string[] = [];
        
        // Check for export
        if (firstLine.includes('export ')) {
            modifiers.push('export');
        }
        if (firstLine.includes('default ')) {
            modifiers.push('default');
        }
        if (firstLine.includes('async ')) {
            modifiers.push('async');
        }
        if (firstLine.includes('static ')) {
            modifiers.push('static');
        }
        if (firstLine.includes('private ')) {
            modifiers.push('private');
        }
        if (firstLine.includes('protected ')) {
            modifiers.push('protected');
        }
        if (firstLine.includes('public ')) {
            modifiers.push('public');
        }
        if (firstLine.includes('readonly ')) {
            modifiers.push('readonly');
        }
        
        // Match function declaration
        const funcMatch = firstLine.match(
            /(?:function\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{=]+))?/
        );
        
        if (funcMatch) {
            name = funcMatch[1];
            type = firstLine.includes('class ') ? CodeType.Class : 
                   firstLine.includes('interface ') ? CodeType.Interface : CodeType.Function;
            
            // Parse parameters
            const paramsStr = funcMatch[2];
            if (paramsStr) {
                const params = this.parseParameters(paramsStr);
                parameters.push(...params);
            }
            
            // Extract return type
            if (funcMatch[3]) {
                returnType = funcMatch[3].trim();
            }
        }
        
        // Match arrow function assigned to variable
        const arrowMatch = firstLine.match(
            /(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s+)?\(?([^)]*)\)?\s*(?::\s*([^=]+))?\s*=>/
        );
        
        if (arrowMatch) {
            name = arrowMatch[1];
            type = CodeType.Function;
            
            const paramsStr = arrowMatch[2];
            if (paramsStr) {
                const params = this.parseParameters(paramsStr);
                parameters.push(...params);
            }
            
            if (arrowMatch[3]) {
                returnType = arrowMatch[3].trim();
            }
        }
        
        // Match class declaration
        const classMatch = firstLine.match(/class\s+(\w+)/);
        if (classMatch) {
            name = classMatch[1];
            type = CodeType.Class;
        }
        
        // Match interface declaration
        const interfaceMatch = firstLine.match(/interface\s+(\w+)/);
        if (interfaceMatch) {
            name = interfaceMatch[1];
            type = CodeType.Interface;
        }
        
        // Match type alias
        const typeMatch = firstLine.match(/type\s+(\w+)/);
        if (typeMatch) {
            name = typeMatch[1];
            type = CodeType.Type;
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
     * Parse parameter string into ParameterInfo array
     */
    private parseParameters(paramsStr: string): ParameterInfo[] {
        const params: ParameterInfo[] = [];
        
        if (!paramsStr.trim()) return params;
        
        // Split by comma, but be careful of nested types
        let depth = 0;
        let current = '';
        const parts: string[] = [];
        
        for (const char of paramsStr) {
            if (char === '<' || char === '(' || char === '[' || char === '{') {
                depth++;
                current += char;
            } else if (char === '>' || char === ')' || char === ']' || char === '}') {
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
     * Parse a single parameter
     */
    private parseParameter(paramStr: string): ParameterInfo | null {
        const trimmed = paramStr.trim();
        if (!trimmed) return null;
        
        const isRest = trimmed.startsWith('...');
        const withoutRest = isRest ? trimmed.slice(3) : trimmed;
        
        // Match: name?: type = default or name: type = default
        const match = withoutRest.match(/^(\w+)(\?)?(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);
        
        if (match) {
            return {
                name: match[1],
                type: match[3]?.trim(),
                defaultValue: match[4]?.trim(),
                isOptional: !!match[2] || !!match[4],
                isRest
            };
        }
        
        // Simple name only
        const simpleMatch = withoutRest.match(/^(\w+)$/);
        if (simpleMatch) {
            return {
                name: simpleMatch[1],
                isOptional: false,
                isRest
            };
        }
        
        return null;
    }
}
