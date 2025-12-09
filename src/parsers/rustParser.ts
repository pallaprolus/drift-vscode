import * as vscode from 'vscode';
import { BaseParser } from './baseParser';
import { DocCodePair, DocType, CodeSignature, CodeType } from '../models/types';

export class RustParser extends BaseParser {
    languageId = 'rust';
    fileExtensions = ['.rs'];

    /**
     * Parse Rust file for documentation and code pairs
     */
    async parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const pairs: DocCodePair[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Regex to match Rust function/method declarations
        // fn name<T>(params) -> RetType where .. {
        // public fn name ... ? Rust uses pub
        const fnRegex = /^(?:pub(?:\([^)]+\))?\s+)?(?:unsafe\s+|async\s+|const\s+|extern\s+(?:\"[^\"]+\"\s+)?)*fn\s+(\w+)/;

        // Regex for comments (matched by BaseParser.parseRustDocStyle)
        // /// or //!
        const commentRegex = /^\s*\/\/(?:\/|!)\s?(.*)$/;

        let currentDocLines: string[] = [];
        let docStartLine = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for attributes (#[...]) - skip them but don't break doc block association
            // Actually attributes sit between doc and function.
            // Documentation usually precedes attributes.
            // /// doc
            // #[attr]
            // fn main()

            if (trimmedLine.startsWith('#[') && trimmedLine.endsWith(']')) {
                // If we have doc lines, keep them and continue
                if (currentDocLines.length > 0) {
                    continue; // Skip attribute line
                }
            }

            // Check for comment
            const commentMatch = trimmedLine.match(commentRegex);
            if (commentMatch) {
                if (currentDocLines.length === 0) {
                    docStartLine = i;
                }
                currentDocLines.push(line);
                continue;
            }

            // Check for function declaration
            const fnMatch = trimmedLine.match(fnRegex);
            if (fnMatch && currentDocLines.length > 0) {
                const docContent = currentDocLines.join('\n');

                // Determine doc end line (it was the last comment line)
                // If there were attributes, i-1 is attribute.
                // We need to find the range of comments.
                // Assuming continuous comments before we hit code/attr.

                // Let's create range for doc.
                // docStartLine is start.
                // The end is docStartLine + count - 1.

                const docEndLine = docStartLine + currentDocLines.length - 1;

                const docRange = new vscode.Range(
                    docStartLine, 0,
                    docEndLine, lines[docEndLine].length
                );

                const codeRange = new vscode.Range(
                    i, 0,
                    i, line.length
                );

                const signature = this.extractCodeSignature(line, codeRange);

                pairs.push(this.createPair(
                    document.uri.fsPath,
                    docRange,
                    docContent,
                    DocType.RustDoc,
                    codeRange,
                    line,
                    signature
                ));
            }

            // Reset if not a comment/attr
            if (currentDocLines.length > 0) {
                currentDocLines = [];
                docStartLine = -1;
            }
        }

        return pairs;
    }

    /**
     * Extract signature from Rust function definition
     */
    extractCodeSignature(content: string, range: vscode.Range): CodeSignature {
        const signature: CodeSignature = {
            name: '',
            type: CodeType.Function,
            parameters: [],
            modifiers: [],
            hash: ''
        }

        // Basic extraction
        const fnMatch = content.match(/fn\s+(\w+)/);
        if (fnMatch) {
            signature.name = fnMatch[1];
        }

        // Modifiers
        if (content.match(/\bpub\b/)) signature.modifiers.push('public');
        if (content.match(/\basync\b/)) signature.modifiers.push('async');
        if (content.match(/\bunsafe\b/)) signature.modifiers.push('unsafe');

        // Parameters extraction - simplified
        const paramMatch = content.match(/\((.*?)\)/);
        if (paramMatch && paramMatch[1]) {
            // Split by comma (ignoring nested logic for MVP)
            const parts = paramMatch[1].split(',');
            for (const part of parts) {
                const trimmed = part.trim();
                if (!trimmed) continue;

                // name: type
                const colIndex = trimmed.indexOf(':');
                if (colIndex !== -1) {
                    signature.parameters.push({
                        name: trimmed.substring(0, colIndex).trim(),
                        type: trimmed.substring(colIndex + 1).trim(),
                        isOptional: false,
                        isRest: false
                    });
                } else if (trimmed === 'self' || trimmed === '&self' || trimmed === '&mut self') {
                    // Method receiver
                    signature.parameters.push({
                        name: 'self',
                        type: trimmed, // treat self as type too
                        isOptional: false,
                        isRest: false
                    });
                }
            }
        }

        // Return type
        const retMatch = content.match(/->\s*(.*?)\s*\{?$/);
        if (retMatch) {
            signature.returnType = retMatch[1].trim();
        }

        return signature;
    }
}
