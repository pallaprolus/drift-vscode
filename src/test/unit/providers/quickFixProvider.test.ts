
import * as assert from 'assert';
import * as vscode from 'vscode';
import { QuickFixProvider } from '../../../providers/quickFixProvider';
import { WorkspaceScanner } from '../../../analyzers/workspaceScanner';
import { DocCodePair, DriftReason, DriftSeverity, CodeType, DocType, CodeSignature, DriftType } from '../../../models/types';

suite('QuickFixProvider Test Suite', () => {
    let provider: QuickFixProvider;
    let mockScanner: any;
    let mockDocument: any;

    setup(() => {
        mockScanner = {
            getResultsForFile: () => []
        };
        provider = new QuickFixProvider(mockScanner as WorkspaceScanner);

        mockDocument = {
            uri: { fsPath: '/test/file.ts' },
            languageId: 'typescript',
            lineAt: (line: number) => ({
                text: line === 0 ? '/**' : line === 2 ? ' */' : ' * @param existing - desc',
                rangeIncludingLineBreak: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line + 1, 0))
            })
        };
    });

    test('Should return no actions if no drift', () => {
        mockScanner.getResultsForFile = () => [];
        const actions = provider.provideCodeActions(
            mockDocument,
            new vscode.Range(0, 0, 0, 0),
            {} as vscode.CodeActionContext,
            {} as vscode.CancellationToken
        );
        assert.deepStrictEqual(actions, []);
    });

    test('Should offer "Add missing parameter" action', () => {
        const pair = createMockPair('missing_param');
        pair.driftReasons = [{
            message: "Parameter 'newParam' is not documented",
            severity: DriftSeverity.High,
            type: DriftType.ParameterMismatch
        }];
        mockScanner.getResultsForFile = () => [pair];

        // Mock document for JSDoc
        mockDocument.lineAt = (line: number) => {
            if (line === 5) return { text: ' */' }; // simplified end
            return { text: '' };
        };

        const actions = provider.provideCodeActions(
            mockDocument,
            new vscode.Range(0, 0, 0, 0), // Cursor at start
            {} as vscode.CodeActionContext,
            {} as vscode.CancellationToken
        ) as vscode.CodeAction[];

        assert.strictEqual(actions.length, 1);
        assert.strictEqual(actions[0].title, "Add missing parameter 'newParam'");
        assert.ok(actions[0].edit);
    });

    test('Should offer "Remove stale parameter" action', () => {
        const pair = createMockPair('stale_param');
        pair.driftReasons = [{
            message: "Documented parameter 'oldParam' not found in code",
            severity: DriftSeverity.High,
            type: DriftType.ParameterMismatch
        }];
        pair.docContent = '/**\n * @param oldParam - desc\n */';

        mockScanner.getResultsForFile = () => [pair];

        const actions = provider.provideCodeActions(
            mockDocument,
            new vscode.Range(0, 0, 0, 0),
            {} as vscode.CodeActionContext,
            {} as vscode.CancellationToken
        ) as vscode.CodeAction[];

        assert.strictEqual(actions.length, 1);
        assert.strictEqual(actions[0].title, "Remove stale parameter 'oldParam'");
    });

    function createMockPair(id: string): DocCodePair {
        return {
            id,
            filePath: '/test/file.ts',
            docRange: new vscode.Range(0, 0, 5, 3),
            docContent: '/**\n * @param existing\n */',
            docType: DocType.JSDoc,
            codeRange: new vscode.Range(6, 0, 8, 1),
            codeContent: 'function foo(existing, newParam) {}',
            codeSignature: {
                name: 'foo',
                type: CodeType.Function,
                parameters: [],
                modifiers: [],
                hash: ''
            },
            driftScore: 0.5,
            driftReasons: [],
            isReviewed: false,
            lastAnalyzed: new Date()
        };
    }
});
