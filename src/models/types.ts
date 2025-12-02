import * as vscode from 'vscode';

/**
 * Represents a documentation block paired with its code anchor
 */
export interface DocCodePair {
    id: string;
    filePath: string;
    
    // Documentation info
    docRange: vscode.Range;
    docContent: string;
    docType: DocType;
    
    // Code anchor info
    codeRange: vscode.Range;
    codeContent: string;
    codeSignature: CodeSignature;
    
    // Drift analysis
    driftScore: number;
    driftReasons: DriftReason[];
    lastAnalyzed: Date;
    
    // State
    isReviewed: boolean;
    reviewedAt?: Date;
    lastCodeChange?: Date;
}

export enum DocType {
    JSDoc = 'jsdoc',
    PyDoc = 'pydoc',
    GoDoc = 'godoc',
    RustDoc = 'rustdoc',
    JavaDoc = 'javadoc',
    CDoc = 'cdoc',
    InlineComment = 'inline',
    BlockComment = 'block',
    ReadmeCodeBlock = 'readme'
}

export interface CodeSignature {
    name: string;
    type: CodeType;
    parameters: ParameterInfo[];
    returnType?: string;
    modifiers: string[];
    hash: string; // Content hash for change detection
}

export enum CodeType {
    Function = 'function',
    Method = 'method',
    Class = 'class',
    Interface = 'interface',
    Variable = 'variable',
    Constant = 'constant',
    Type = 'type',
    Module = 'module'
}

export interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    isOptional: boolean;
    isRest: boolean;
}

export interface DriftReason {
    type: DriftType;
    severity: DriftSeverity;
    message: string;
    details?: string;
}

export enum DriftType {
    ParameterMismatch = 'parameter_mismatch',
    ParameterAdded = 'parameter_added',
    ParameterRemoved = 'parameter_removed',
    ParameterRenamed = 'parameter_renamed',
    ReturnTypeMismatch = 'return_type_mismatch',
    SignatureChanged = 'signature_changed',
    CodeContentChanged = 'code_content_changed',
    DescriptionMismatch = 'description_mismatch',
    MissingDocumentation = 'missing_documentation',
    OrphanedDocumentation = 'orphaned_documentation',
    DeprecatedReference = 'deprecated_reference'
}

export enum DriftSeverity {
    Low = 'low',
    Medium = 'medium',
    High = 'high',
    Critical = 'critical'
}

/**
 * Parsed documentation content
 */
export interface ParsedDoc {
    description: string;
    params: DocParam[];
    returns?: DocReturn;
    throws?: DocThrows[];
    deprecated?: string;
    since?: string;
    examples?: string[];
    tags: DocTag[];
}

export interface DocParam {
    name: string;
    type?: string;
    description: string;
    isOptional: boolean;
}

export interface DocReturn {
    type?: string;
    description: string;
}

export interface DocThrows {
    type?: string;
    description: string;
}

export interface DocTag {
    name: string;
    value: string;
}

/**
 * Workspace state for tracking drift across sessions
 */
export interface DriftState {
    version: string;
    pairs: Map<string, DocCodePairState>;
    lastFullScan?: Date;
}

export interface DocCodePairState {
    id: string;
    filePath: string;
    codeHash: string;
    docHash: string;
    isReviewed: boolean;
    reviewedAt?: Date;
    driftScore: number;
}

/**
 * Configuration options
 */
export interface DriftConfig {
    enableGutterIcons: boolean;
    enableInlineDecorations: boolean;
    excludePatterns: string[];
    supportedLanguages: string[];
    driftThreshold: number;
}

/**
 * Language-specific parser interface
 */
export interface LanguageParser {
    languageId: string;
    fileExtensions: string[];
    
    parseDocCodePairs(document: vscode.TextDocument): Promise<DocCodePair[]>;
    parseDocumentation(content: string, docType: DocType): ParsedDoc;
    extractCodeSignature(content: string, range: vscode.Range): CodeSignature;
}

/**
 * Dashboard tree item for the sidebar view
 */
export interface DriftTreeItem {
    pair: DocCodePair;
    label: string;
    description: string;
    tooltip: string;
    iconPath?: vscode.ThemeIcon;
}
