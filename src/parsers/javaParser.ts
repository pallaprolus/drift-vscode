import * as vscode from 'vscode';
import { BaseParser } from './baseParser';
import { DocCodePair, DocType, CodeSignature, CodeType } from '../models/types';

export class JavaParser extends BaseParser {
    languageId = 'java';
    fileExtensions = ['.java'];

    /**
     * Parse Java file for documentation and code pairs
     */
    async parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const pairs: DocCodePair[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let inComment = false;
        let commentStartLine = -1;
        let currentDocLines: string[] = [];

        // Regex for method declaration (simplified)
        // (public|private|protected|static|final|synchronized|abstract|default|native)* type name(params) ... {?
        const methodRegex = /^(?:[\w\[\]<>\.]+\s+)*[\w\[\]<>\.]+\s+(\w+)\s*\(/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for Javadoc start /**
            if (!inComment && trimmedLine.startsWith('/**')) {
                inComment = true;
                commentStartLine = i;
                currentDocLines = [line];
                // If single line /** ... */, handle it
                if (trimmedLine.endsWith('*/')) {
                    inComment = false;
                    // Check next line for code
                    // But we continue to loop to find code
                }
                continue;
            }

            if (inComment) {
                currentDocLines.push(line);
                if (trimmedLine.endsWith('*/')) {
                    inComment = false;
                }
                continue;
            }

            // Not in comment, check for code (annotations, then method)
            if (currentDocLines.length > 0) {
                // Skip empty lines or annotations (@Override)
                if (trimmedLine === '' || trimmedLine.startsWith('@')) {
                    continue;
                }

                // Check for method declaration
                const methodMatch = trimmedLine.match(methodRegex);
                const isClass = /\bclass\b/.test(trimmedLine); // Avoid classes for now

                if (methodMatch && !isClass) {
                    const docContent = currentDocLines.join('\n');
                    const docEndLine = i - 1; // Assuming adjacent (skipping annotations logic logic simplified)
                    // Better: docEndLine was where we closed the comment.
                    // But we didn't track it. Let's recalculate based on lines length.
                    // Actually, we should track where the comment ended.

                    // Re-scan doc lines to find end? No, simple math:
                    // commentStartLine is known. currentDocLines contains the block.
                    const commentEndLine = commentStartLine + currentDocLines.length - 1;

                    const docRange = new vscode.Range(
                        commentStartLine, 0,
                        commentEndLine, lines[commentEndLine].length
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
                        DocType.JavaDoc,
                        codeRange,
                        line,
                        signature
                    ));

                    // Reset
                    currentDocLines = [];
                    commentStartLine = -1;
                } else {
                    // If we hit something else (field? garbage?), clear doc if it's not an annotation
                    // For now, if we drift too far, we lose the doc. 
                    // But "annotations" loop handles skipping.
                    // If we hit a brace or something, maybe reset.
                    if (trimmedLine.endsWith('{') || trimmedLine.endsWith(';')) {
                        currentDocLines = [];
                        commentStartLine = -1;
                    }
                }
            }
        }

        return pairs;
    }

    /**
     * Extract signature from Java method definition
     */
    extractCodeSignature(content: string, range: vscode.Range): CodeSignature {
        const signature: CodeSignature = {
            name: '',
            type: CodeType.Function,
            parameters: [],
            modifiers: [],
            hash: ''
        }

        // Modifiers
        const modifiersList = ['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized'];
        for (const mod of modifiersList) {
            if (content.includes(mod + ' ')) {
                signature.modifiers.push(mod);
            }
        }

        // Name and Type
        // public String getName(int id)
        // Match: ... type name(params)
        // Discard modifiers matches

        // Remove modifiers to simplify
        let clean = content;
        // This is naive string replacement, but sufficient for simple MVP
        // Better to use regex to capture groups

        const methodMatch = content.match(/(\w+)\s*\((.*?)\)/);
        if (methodMatch) {
            signature.name = methodMatch[1];

            // Extract return type? It precedes name.
            // ... (Type) Name ...

            const beforeName = content.substring(0, content.indexOf(methodMatch[1])).trim();
            const parts = beforeName.split(/\s+/);
            const potentialType = parts[parts.length - 1];
            if (potentialType && !modifiersList.includes(potentialType) && !potentialType.startsWith('@')) {
                signature.returnType = potentialType;
            }

            // Parameters
            const paramsStr = methodMatch[2];
            if (paramsStr) {
                const paramParts = paramsStr.split(',');
                for (const part of paramParts) {
                    const trimmed = part.trim();
                    if (!trimmed) continue;

                    // Type Name
                    // final String s
                    // we want last word as name, rest as type

                    const words = trimmed.split(/\s+/);
                    if (words.length >= 2) {
                        const name = words[words.length - 1];
                        const type = words.slice(0, words.length - 1).join(' '); // includes modifiers like final

                        signature.parameters.push({
                            name: name,
                            type: type, // includes 'final' etc
                            isOptional: false,
                            isRest: false
                        });
                    }
                }
            }
        }

        return signature;
    }
}
