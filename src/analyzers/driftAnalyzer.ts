import {
    DocCodePair,
    DriftReason,
    DriftType,
    DriftSeverity,
    ParsedDoc,
    CodeSignature,
    DocType,
    LanguageParser
} from '../models/types';
import {
    calculateSimilarity,
    extractIdentifiers,
    extractDocParamNames,
    extractDocReturnType,
    findClosestMatch,
    normalizeWhitespace
} from '../utils/helpers';

/**
 * Analyzes documentation-code pairs for drift
 */
export class DriftAnalyzer {
    private readonly paramMismatchWeight = 0.4;
    private readonly returnTypeMismatchWeight = 0.2;
    private readonly signatureChangeWeight = 0.25;
    private readonly descriptionMismatchWeight = 0.15;

    /**
     * Analyze a doc-code pair for drift
     */
    analyzePair(pair: DocCodePair, parser: LanguageParser): DocCodePair {
        const reasons: DriftReason[] = [];

        // Parse the documentation
        const parsedDoc = parser.parseDocumentation(pair.docContent, pair.docType);

        // Check parameter drift
        const paramReasons = this.analyzeParameters(parsedDoc, pair.codeSignature);
        reasons.push(...paramReasons);

        // Check return type drift
        const returnReasons = this.analyzeReturnType(parsedDoc, pair.codeSignature);
        reasons.push(...returnReasons);

        // Check description drift (mentions of identifiers that no longer exist)
        const descReasons = this.analyzeDescription(parsedDoc, pair.codeContent, pair.codeSignature);
        reasons.push(...descReasons);

        // Calculate overall drift score
        const driftScore = this.calculateDriftScore(reasons);

        return {
            ...pair,
            driftScore,
            driftReasons: reasons,
            lastAnalyzed: new Date()
        };
    }

    /**
     * Analyze parameter documentation vs code signature
     */
    private analyzeParameters(doc: ParsedDoc, signature: CodeSignature): DriftReason[] {
        const reasons: DriftReason[] = [];

        const docParamNames = doc.params.map(p => p.name.toLowerCase());
        const codeParamNames = signature.parameters
            .filter(p => !['self', 'cls'].includes(p.name.toLowerCase()))
            .map(p => p.name.toLowerCase());

        // Find documented params that don't exist in code
        for (const docParam of doc.params) {
            const paramName = docParam.name.toLowerCase();

            // Skip self/cls for Python
            if (['self', 'cls'].includes(paramName)) continue;

            if (!codeParamNames.includes(paramName)) {
                // Check if it might be renamed
                const closest = findClosestMatch(paramName, codeParamNames);

                if (closest && closest.distance <= 2) {
                    reasons.push({
                        type: DriftType.ParameterRenamed,
                        severity: DriftSeverity.Medium,
                        message: `Parameter '${docParam.name}' may have been renamed to '${closest.match}'`,
                        details: `Documentation mentions '${docParam.name}' but code has '${closest.match}'`
                    });
                } else {
                    reasons.push({
                        type: DriftType.ParameterRemoved,
                        severity: DriftSeverity.High,
                        message: `Documented parameter '${docParam.name}' not found in code`,
                        details: `The documentation describes a parameter that doesn't exist in the current function signature`
                    });
                }
            }
        }

        // Find code params that aren't documented
        for (const codeParam of signature.parameters) {
            const paramName = codeParam.name.toLowerCase();

            // Skip self/cls for Python
            if (['self', 'cls'].includes(paramName)) continue;

            if (!docParamNames.includes(paramName)) {
                // Only flag as issue if this seems like a substantive parameter
                // (not just common short names that might be intentionally undocumented)
                if (codeParam.name.length > 1) {
                    reasons.push({
                        type: DriftType.ParameterAdded,
                        severity: DriftSeverity.Medium,
                        message: `Parameter '${codeParam.name}' is not documented`,
                        details: `The code has a parameter '${codeParam.name}' that isn't described in the documentation`
                    });
                }
            }
        }

        // Check for type mismatches in documented parameters
        for (const docParam of doc.params) {
            const codeParam = signature.parameters.find(
                p => p.name.toLowerCase() === docParam.name.toLowerCase()
            );

            if (codeParam && docParam.type && codeParam.type) {
                const docType = normalizeWhitespace(docParam.type.toLowerCase());
                const codeType = normalizeWhitespace(codeParam.type.toLowerCase());

                if (!this.typesMatch(docType, codeType)) {
                    reasons.push({
                        type: DriftType.ParameterMismatch,
                        severity: DriftSeverity.Medium,
                        message: `Type mismatch for parameter '${docParam.name}'`,
                        details: `Documentation says '${docParam.type}' but code has '${codeParam.type}'`
                    });
                }
            }
        }

        return reasons;
    }

    /**
     * Analyze return type documentation vs code signature
     */
    private analyzeReturnType(doc: ParsedDoc, signature: CodeSignature): DriftReason[] {
        const reasons: DriftReason[] = [];

        if (doc.returns && signature.returnType) {
            const docType = normalizeWhitespace(doc.returns.type?.toLowerCase() || '');
            const codeType = normalizeWhitespace(signature.returnType.toLowerCase());

            if (docType && !this.typesMatch(docType, codeType)) {
                reasons.push({
                    type: DriftType.ReturnTypeMismatch,
                    severity: DriftSeverity.Medium,
                    message: `Return type mismatch`,
                    details: `Documentation says '${doc.returns.type}' but code returns '${signature.returnType}'`
                });
            }
        }

        // Check for void/undefined returns that are documented
        if (doc.returns && !signature.returnType) {
            // Only flag if the doc explicitly specifies a non-void return
            if (doc.returns.type && !['void', 'none', 'undefined'].includes(doc.returns.type.toLowerCase())) {
                reasons.push({
                    type: DriftType.ReturnTypeMismatch,
                    severity: DriftSeverity.Low,
                    message: `Documentation specifies return type but code has none`,
                    details: `Documentation mentions returning '${doc.returns.type}' but no return type in signature`
                });
            }
        }

        return reasons;
    }

    /**
     * Analyze description for references to code elements that may have changed
     */
    private analyzeDescription(doc: ParsedDoc, codeContent: string, signature: CodeSignature): DriftReason[] {
        const reasons: DriftReason[] = [];

        // Extract identifiers from the code
        const codeIdentifiers = new Set(extractIdentifiers(codeContent).map(i => i.toLowerCase()));

        // Extract what looks like identifier references from the description
        const descriptionRefs = this.extractDescriptionReferences(doc.description);

        // Check if any referenced identifiers don't exist in the code
        for (const ref of descriptionRefs) {
            const refLower = ref.toLowerCase();

            // Skip common words and very short references
            if (ref.length <= 2) continue;

            // Check if this reference exists in the code
            if (!codeIdentifiers.has(refLower)) {
                // Check if it might be a close match
                const closest = findClosestMatch(refLower, Array.from(codeIdentifiers));

                if (closest && closest.distance <= 2 && closest.distance > 0) {
                    reasons.push({
                        type: DriftType.DescriptionMismatch,
                        severity: DriftSeverity.Low,
                        message: `Description references '${ref}' which may have been renamed to '${closest.match}'`,
                        details: `Consider updating the documentation to use the current name`
                    });
                }
            }
        }

        return reasons;
    }

    /**
     * Extract identifier-like references from documentation description
     */
    private extractDescriptionReferences(description: string): string[] {
        const refs: string[] = [];

        // Match backtick-quoted identifiers: `identifier`
        const backtickMatches = description.match(/`([a-zA-Z_][a-zA-Z0-9_]*)`/g);
        if (backtickMatches) {
            refs.push(...backtickMatches.map(m => m.slice(1, -1)));
        }

        // Match code-like words (camelCase or snake_case)
        const camelCasePattern = /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/g;
        const snakeCasePattern = /\b([a-z][a-z0-9]*_[a-z][a-z0-9_]*)\b/g;

        let match;
        while ((match = camelCasePattern.exec(description)) !== null) {
            refs.push(match[1]);
        }
        while ((match = snakeCasePattern.exec(description)) !== null) {
            refs.push(match[1]);
        }

        return [...new Set(refs)];
    }

    /**
     * Check if two type strings are equivalent (allowing for common variations)
     */
    private typesMatch(docType: string, codeType: string): boolean {
        // Direct match
        if (docType === codeType) return true;

        // Common type aliases
        const typeAliases: Record<string, string[]> = {
            'string': ['str', 'string'],
            'number': ['int', 'float', 'number', 'integer'],
            'boolean': ['bool', 'boolean'],
            'array': ['list', 'array', '[]'],
            'object': ['dict', 'object', 'map', 'record'],
            'any': ['any', 'object', 'unknown'],
            'void': ['void', 'none', 'null', 'undefined']
        };

        for (const aliases of Object.values(typeAliases)) {
            if (aliases.includes(docType) && aliases.includes(codeType)) {
                return true;
            }
        }

        // Check if one contains the other (for union types, generics, etc.)
        if (docType.includes(codeType) || codeType.includes(docType)) {
            return true;
        }

        return false;
    }

    /**
     * Calculate overall drift score from reasons
     */
    private calculateDriftScore(reasons: DriftReason[]): number {
        if (reasons.length === 0) return 0;

        let score = 0;

        for (const reason of reasons) {
            let weight = 0;

            switch (reason.type) {
                case DriftType.ParameterMismatch:
                case DriftType.ParameterAdded:
                case DriftType.ParameterRemoved:
                case DriftType.ParameterRenamed:
                    weight = this.paramMismatchWeight;
                    break;
                case DriftType.ReturnTypeMismatch:
                    weight = this.returnTypeMismatchWeight;
                    break;
                case DriftType.SignatureChanged:
                case DriftType.CodeContentChanged:
                    weight = this.signatureChangeWeight;
                    break;
                case DriftType.DescriptionMismatch:
                    weight = this.descriptionMismatchWeight;
                    break;
                default:
                    weight = 0.1;
            }

            // Adjust by severity
            switch (reason.severity) {
                case DriftSeverity.Critical:
                    weight *= 1.5;
                    break;
                case DriftSeverity.High:
                    weight *= 1.2;
                    break;
                case DriftSeverity.Medium:
                    weight *= 1.0;
                    break;
                case DriftSeverity.Low:
                    weight *= 0.5;
                    break;
            }

            score += weight;
        }

        // Normalize to 0-1 range
        return Math.min(1, score);
    }

    /**
     * Compare two code signatures to detect if the code has changed significantly
     */
    compareSignatures(oldSig: CodeSignature, newSig: CodeSignature): DriftReason[] {
        const reasons: DriftReason[] = [];

        // Check if hash is different
        if (oldSig.hash !== newSig.hash) {
            reasons.push({
                type: DriftType.CodeContentChanged,
                severity: DriftSeverity.Medium,
                message: 'Code content has changed since documentation was last reviewed',
                details: 'The implementation may have been updated without reviewing the documentation'
            });
        }

        // Check for signature changes
        if (oldSig.name !== newSig.name) {
            reasons.push({
                type: DriftType.SignatureChanged,
                severity: DriftSeverity.High,
                message: `Function renamed from '${oldSig.name}' to '${newSig.name}'`,
                details: 'The function name has changed'
            });
        }

        if (oldSig.parameters.length !== newSig.parameters.length) {
            reasons.push({
                type: DriftType.SignatureChanged,
                severity: DriftSeverity.High,
                message: 'Parameter count has changed',
                details: `Was ${oldSig.parameters.length} parameters, now ${newSig.parameters.length}`
            });
        }

        return reasons;
    }
}
