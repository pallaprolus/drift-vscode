import * as vscode from 'vscode';
import { BaseParser } from './baseParser';
import { DocCodePair, DocType, CodeSignature, CodeType } from '../models/types';

export class GoParser extends BaseParser {
    languageId = 'go';
    fileExtensions = ['.go'];

    /**
     * Parse Go file for documentation and code pairs
     */
    async parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]> {
        const pairs: DocCodePair[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Regex to match Go function declarations
        // func Name(params) returnType {
        const funcRegex = /^func\s+(\w+)\s*\((.*?)\)/;
        // Regex for comments
        const commentRegex = /^\s*\/\/\s?(.*)$/;

        let currentDocLines: string[] = [];
        let docStartLine = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

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
            const funcMatch = trimmedLine.match(funcRegex);
            if (funcMatch && currentDocLines.length > 0) {
                const name = funcMatch[1];
                const params = funcMatch[2];
                // Go docs usually don't have blank lines between doc and function
                // But we'll allow it if strictly adjacent for now

                const docContent = currentDocLines.join('\n');
                const docRange = new vscode.Range(
                    docStartLine, 0,
                    i - 1, lines[i - 1].length
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
                    DocType.GoDoc,
                    codeRange,
                    line,
                    signature
                ));
            }

            // Reset if not a comment and we processed (or ignored) it
            if (currentDocLines.length > 0) {
                currentDocLines = [];
                docStartLine = -1;
            }
        }

        return pairs;
    }

    /**
     * Extract signature from Go function definition
     */
    extractCodeSignature(content: string, range: vscode.Range): CodeSignature {
        const signature: CodeSignature = {
            name: '',
            type: CodeType.Function,
            parameters: [],
            modifiers: [],
            hash: ''
        }

        // Parse: func Name(param1 type1, param2 type2) (retType)
        const funcMatch = content.trim().match(/^func\s+(\w+)\s*\((.*?)\)(?:\s*(.*))?\s*\{?$/);

        if (funcMatch) {
            signature.name = funcMatch[1];

            // Parse parameters
            const paramsStr = funcMatch[2];
            if (paramsStr) {
                // Determine split strategy - Go params can be tricky: "a, b int, c string"
                // For MVP, simplistic comma splitting might fail on complex types like func(int, int)
                // But let's try a basic approach first and assume simple types
                const paramParts = paramsStr.split(',');

                // Go allows "x, y int" -> both are int. 
                // We need to parse backwards or handle groups.

                // Better approach: regex for "name type" or "name1, name2 type"
                // But full Go parsing is complex. Let's do a best-effort split.
                // Or simplified: just extract names if possible.

                // Let's iterate and clean
                let currentNames: string[] = [];

                // If it contains only types (no names), it's harder, but Go funcs usually have named params

                signature.parameters = this.parseGoParams(paramsStr);
            }

            // Return type is in group 3, but capturing it accurately with regex is hard
            if (funcMatch[3]) {
                const returnPart = funcMatch[3].replace('{', '').trim();
                if (returnPart) {
                    signature.returnType = returnPart;
                }
            }
        }

        return signature;
    }

    private parseGoParams(paramsStr: string): any[] {
        const params: any[] = [];
        // Handle: a, b int, c string
        // Split by comma, but careful of func/interface types which might contain commas
        // For MVP, assuming simple types

        const parts = paramsStr.split(',');
        let pendingNames: string[] = [];

        for (const part of parts) {
            const trimmed = part.trim();
            const spaceIndex = trimmed.lastIndexOf(' '); // Type usually follows name

            if (spaceIndex !== -1) {
                // Found a type? "b int"
                const possibleName = trimmed.substring(0, spaceIndex).trim();
                const type = trimmed.substring(spaceIndex + 1).trim();

                // But wait, "map[string]int" has no space.
                // "a int" -> name="a", type="int"

                // If we have pending names, apply this type to them too
                // e.g. "a," (pending "a") -> "b int" -> a is int, b is int

                pendingNames.push(possibleName);

                for (const name of pendingNames) {
                    params.push({
                        name: name,
                        type: type
                    });
                }
                pendingNames = [];
            } else {
                // Just a name? "a" in "a, b int"
                pendingNames.push(trimmed);
            }
        }

        // Edge case: "int, int" (unnamed params, valid in signatures but not definitions usually)
        // If we have leftovers in pendingNames, they might be types or names without types?
        // Standard Go func definition requires names if any used.

        return params;
    }
}
