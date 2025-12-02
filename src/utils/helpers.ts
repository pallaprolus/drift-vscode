import * as crypto from 'crypto';

/**
 * Generate a hash for content (for change detection)
 */
export function hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Generate a unique ID for a doc-code pair
 */
export function generatePairId(filePath: string, lineNumber: number): string {
    return `${hashContent(filePath)}-${lineNumber}`;
}

/**
 * Calculate similarity between two strings using Jaccard index
 */
export function calculateSimilarity(str1: string, str2: string): number {
    const set1 = new Set(tokenize(str1));
    const set2 = new Set(tokenize(str2));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) {
        return 1;
    }
    return intersection.size / union.size;
}

/**
 * Tokenize a string into words
 */
export function tokenize(str: string): string[] {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 1);
}

/**
 * Extract identifiers from code (variable names, function names, etc.)
 */
export function extractIdentifiers(code: string): string[] {
    // Match typical identifier patterns
    const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const matches = code.match(identifierPattern) || [];

    // Filter out common keywords
    const keywords = new Set([
        'function', 'const', 'let', 'var', 'class', 'interface', 'type',
        'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
        'break', 'continue', 'try', 'catch', 'finally', 'throw',
        'import', 'export', 'from', 'default', 'async', 'await',
        'new', 'this', 'super', 'extends', 'implements', 'static',
        'public', 'private', 'protected', 'readonly', 'abstract',
        'true', 'false', 'null', 'undefined', 'void', 'never',
        'def', 'self', 'cls', 'lambda', 'pass', 'raise', 'with', 'as',
        'func', 'struct', 'impl', 'trait', 'pub', 'mut', 'fn', 'mod',
        'package', 'main', 'fmt', 'println', 'print'
    ]);

    return matches.filter(id => !keywords.has(id.toLowerCase()));
}

/**
 * Parse parameter names from a documentation string
 */
export function extractDocParamNames(doc: string): string[] {
    const patterns = [
        /@param\s+(?:\{[^}]*\}\s+)?(\w+)/g,  // JSDoc: @param {type} name
        /:param\s+(\w+):/g,                   // Python: :param name:
        /@param\s+(\w+)/g,                    // Simple: @param name
        /\*\s+(\w+)\s+-/g,                    // Go-style: * name -
    ];

    const names: string[] = [];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(doc)) !== null) {
            names.push(match[1]);
        }
    }

    return [...new Set(names)];
}

/**
 * Parse return type from documentation
 */
export function extractDocReturnType(doc: string): string | undefined {
    const patterns = [
        /@returns?\s+\{([^}]+)\}/,           // JSDoc: @return {type}
        /:returns?:\s+(\w+)/,                 // Python: :returns: type
        /@returns?\s+(\w+)/,                  // Simple: @return type
    ];

    for (const pattern of patterns) {
        const match = doc.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }

    return undefined;
}

/**
 * Normalize whitespace in a string
 */
export function normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}

/**
 * Check if a string contains another string (case-insensitive)
 */
export function containsIgnoreCase(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
        dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }

    return dp[m][n];
}

/**
 * Find the closest matching string from a list
 */
export function findClosestMatch(target: string, candidates: string[]): { match: string; distance: number } | null {
    if (candidates.length === 0) {
        return null;
    }

    let closest = candidates[0];
    let minDistance = levenshteinDistance(target, closest);

    for (let i = 1; i < candidates.length; i++) {
        const distance = levenshteinDistance(target, candidates[i]);
        if (distance < minDistance) {
            minDistance = distance;
            closest = candidates[i];
        }
    }

    return { match: closest, distance: minDistance };
}

/**
 * Debounce a function
 */
export function debounce<TArgs extends unknown[]>(
    func: (...args: TArgs) => void,
    wait: number
): (...args: TArgs) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: TArgs) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), wait);
    };
}

/**
 * Throttle a function
 */
export function throttle<TArgs extends unknown[]>(
    func: (...args: TArgs) => void,
    limit: number
): (...args: TArgs) => void {
    let inThrottle = false;

    return (...args: TArgs) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
