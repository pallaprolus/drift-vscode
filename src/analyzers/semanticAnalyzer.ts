import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { DocCodePair, DriftReason, DriftSeverity, DriftType } from '../models/types';
import { DriftLogger } from '../utils/logger';

export const ANTHROPIC_KEY_SECRET = 'drift.anthropicApiKey';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * Structured result returned by the model
 */
export interface SemanticFinding {
    drifted: boolean;
    /** 0-1 */
    confidence: number;
    summary: string;
    issues: string[];
}

export interface SemanticProviderConfig {
    provider: 'auto' | 'anthropic' | 'vscode' | 'off';
    model: string;
}

/**
 * Build the prompt for semantic drift detection.
 */
export function buildSemanticPrompt(pair: DocCodePair): { system: string; user: string } {
    const system = [
        'You review source code to determine whether its documentation has drifted from what the code actually does.',
        'Focus on meaning, not formatting: wrong descriptions of behavior, incorrect return semantics, outdated edge-case notes,',
        'parameters described inaccurately, side effects that are missing or no longer happen, and examples that would not work.',
        'Ignore purely stylistic issues and do not flag missing documentation for trivial details.',
        'Respond with a single JSON object and nothing else, using this shape:',
        '{"drifted": boolean, "confidence": number between 0 and 1, "summary": string, "issues": string[]}',
        'When nothing is wrong, return {"drifted": false, "confidence": <your confidence>, "summary": "Documentation matches the code.", "issues": []}.'
    ].join(' ');

    const user = [
        `Symbol: ${pair.codeSignature.name} (${pair.codeSignature.type})`,
        `File: ${pair.filePath}`,
        '',
        'Documentation:',
        '```',
        pair.docContent,
        '```',
        '',
        'Code:',
        '```',
        pair.codeContent,
        '```',
        '',
        'Does the documentation accurately describe this code? Reply with the JSON object only.'
    ].join('\n');

    return { system, user };
}

/**
 * Parse the model's response into a finding. Tolerates code fences and surrounding prose.
 */
export function parseSemanticResponse(text: string): SemanticFinding | null {
    if (!text) {
        return null;
    }

    let candidate = text.trim();
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        candidate = fenced[1].trim();
    }

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }

    try {
        const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<SemanticFinding>;
        const confidence = typeof parsed.confidence === 'number'
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0.5;
        return {
            drifted: Boolean(parsed.drifted),
            confidence,
            summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
            issues: Array.isArray(parsed.issues)
                ? parsed.issues.filter((i): i is string => typeof i === 'string').map(i => i.trim()).filter(Boolean)
                : []
        };
    } catch {
        return null;
    }
}

/**
 * Convert a finding into drift reasons.
 */
export function findingToReasons(finding: SemanticFinding, providerName: string): DriftReason[] {
    if (!finding.drifted) {
        return [];
    }

    const severity = finding.confidence >= 0.85
        ? DriftSeverity.High
        : finding.confidence >= 0.6
            ? DriftSeverity.Medium
            : DriftSeverity.Low;

    const summary = finding.summary || 'Documentation may not match the code behavior';
    const details = finding.issues.length > 0
        ? finding.issues.map(i => `• ${i}`).join('\n')
        : undefined;

    return [{
        type: DriftType.SemanticMismatch,
        severity,
        message: `AI (${providerName}): ${summary}`,
        details: details
            ? `${details}\nConfidence: ${Math.round(finding.confidence * 100)}%`
            : `Confidence: ${Math.round(finding.confidence * 100)}%`
    }];
}

export interface SemanticProvider {
    readonly name: string;
    isAvailable(): Promise<boolean>;
    complete(system: string, user: string, token?: vscode.CancellationToken): Promise<string>;
}

/**
 * Anthropic API provider using the official SDK.
 */
export class AnthropicProvider implements SemanticProvider {
    readonly name = 'Anthropic';

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly getModel: () => string
    ) {}

    async isAvailable(): Promise<boolean> {
        const key = await this.secrets.get(ANTHROPIC_KEY_SECRET);
        return Boolean(key);
    }

    async complete(system: string, user: string, token?: vscode.CancellationToken): Promise<string> {
        const apiKey = await this.secrets.get(ANTHROPIC_KEY_SECRET);
        if (!apiKey) {
            throw new Error('No Anthropic API key configured. Run "Drift: Set Anthropic API Key".');
        }

        const client = new Anthropic({ apiKey });
        const controller = new AbortController();
        const cancel = token?.onCancellationRequested(() => controller.abort());

        try {
            const model = this.getModel() || DEFAULT_ANTHROPIC_MODEL;
            const response = await client.messages.create(
                {
                    model,
                    max_tokens: 4096,
                    system,
                    messages: [{ role: 'user', content: user }]
                },
                { signal: controller.signal }
            );

            if (response.stop_reason === 'refusal') {
                throw new Error('The model declined to analyze this documentation.');
            }

            return response.content
                .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                .map(block => block.text)
                .join('\n');
        } catch (error) {
            if (error instanceof Anthropic.AuthenticationError) {
                throw new Error('Anthropic rejected the API key. Run "Drift: Set Anthropic API Key" to update it.');
            }
            if (error instanceof Anthropic.RateLimitError) {
                throw new Error('Anthropic rate limit reached. Try again shortly.');
            }
            if (error instanceof Anthropic.NotFoundError) {
                throw new Error(`Model "${this.getModel()}" was not found. Check the drift.ai.model setting.`);
            }
            if (error instanceof Anthropic.APIError) {
                throw new Error(`Anthropic API error ${error.status}: ${error.message}`);
            }
            throw error;
        } finally {
            cancel?.dispose();
        }
    }
}

/**
 * Provider backed by the VS Code Language Model API (e.g. GitHub Copilot models).
 * No API key required; VS Code prompts the user for consent on first use.
 */
export class VsCodeLmProvider implements SemanticProvider {
    readonly name = 'VS Code LM';

    async isAvailable(): Promise<boolean> {
        if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
            return false;
        }
        try {
            const models = await vscode.lm.selectChatModels();
            return models.length > 0;
        } catch {
            return false;
        }
    }

    async complete(system: string, user: string, token?: vscode.CancellationToken): Promise<string> {
        const models = await vscode.lm.selectChatModels();
        if (models.length === 0) {
            throw new Error('No VS Code language models available. Install a chat provider (e.g. GitHub Copilot) or set an Anthropic API key.');
        }

        // Prefer the most capable-looking model, fall back to the first
        const model = models.find(m => /opus|sonnet|claude/i.test(m.family) || /opus|sonnet|claude/i.test(m.name))
            ?? models.find(m => /gpt-4|o[134]/i.test(m.family))
            ?? models[0];

        const messages = [
            vscode.LanguageModelChatMessage.User(`${system}\n\n${user}`)
        ];

        const cts = token ?? new vscode.CancellationTokenSource().token;
        const response = await model.sendRequest(messages, {}, cts);

        let text = '';
        for await (const fragment of response.text) {
            text += fragment;
        }
        return text;
    }
}

/**
 * Orchestrates semantic analysis across providers.
 */
export class SemanticAnalyzer {
    private anthropic: AnthropicProvider;
    private vscodeLm: VsCodeLmProvider;

    constructor(
        secrets: vscode.SecretStorage,
        private readonly getConfig: () => SemanticProviderConfig
    ) {
        this.anthropic = new AnthropicProvider(secrets, () => this.getConfig().model);
        this.vscodeLm = new VsCodeLmProvider();
    }

    /**
     * Pick the provider based on configuration and availability.
     */
    async resolveProvider(): Promise<SemanticProvider | null> {
        const { provider } = this.getConfig();

        if (provider === 'off') {
            return null;
        }
        if (provider === 'anthropic') {
            return this.anthropic;
        }
        if (provider === 'vscode') {
            return this.vscodeLm;
        }

        // auto: prefer Anthropic when a key is configured, otherwise VS Code LM
        if (await this.anthropic.isAvailable()) {
            return this.anthropic;
        }
        if (await this.vscodeLm.isAvailable()) {
            return this.vscodeLm;
        }
        return null;
    }

    /**
     * Analyze a single pair. Returns the reasons to add (empty when no drift found).
     */
    async analyzePair(pair: DocCodePair, token?: vscode.CancellationToken): Promise<{ provider: string; finding: SemanticFinding; reasons: DriftReason[] }> {
        const provider = await this.resolveProvider();
        if (!provider) {
            throw new Error(
                'No AI provider available. Set an Anthropic API key ("Drift: Set Anthropic API Key") ' +
                'or install a VS Code chat provider such as GitHub Copilot.'
            );
        }

        const { system, user } = buildSemanticPrompt(pair);
        DriftLogger.log(`Semantic analysis of ${pair.codeSignature.name} via ${provider.name}`);

        const raw = await provider.complete(system, user, token);
        const finding = parseSemanticResponse(raw);
        if (!finding) {
            DriftLogger.error('Could not parse semantic analysis response', raw);
            throw new Error('The AI response could not be parsed. See the Drift output channel for details.');
        }

        return { provider: provider.name, finding, reasons: findingToReasons(finding, provider.name) };
    }
}
