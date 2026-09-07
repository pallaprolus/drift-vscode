import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DriftApi } from '../../extension';

async function getApi(): Promise<DriftApi> {
    const ext = vscode.extensions.getExtension('pallaprolus.drift');
    assert.ok(ext, 'extension should be installed');
    return (await ext!.activate()) as DriftApi;
}

suite('Integration Test: Drift Detection', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('pallaprolus.drift'));
    });

    test('All contributed commands are registered', async () => {
        await getApi();
        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            'drift.scanWorkspace', 'drift.scanCurrentFile', 'drift.markAsReviewed', 'drift.showDashboard',
            'drift.refreshDashboard', 'drift.exportReport', 'drift.analyzeSemantic', 'drift.analyzeSemanticFile',
            'drift.setAnthropicApiKey', 'drift.clearAnthropicApiKey'
        ]) {
            assert.ok(commands.includes(id), `${id} should be registered`);
        }
    });

    test('Workspace scan finds JSDoc drift and README drift', async function () {
        this.timeout(60000);
        const api = await getApi();
        await vscode.commands.executeCommand('drift.scanWorkspace');

        const results = api.getAllResults();
        const calc = results.find(p => p.filePath.endsWith('lib.ts') && p.codeSignature.name === 'calculateTotal');
        assert.ok(calc, 'calculateTotal should be analyzed');
        assert.ok(calc!.driftScore > 0, 'calculateTotal docs should drift (taxRate renamed, discount undocumented)');
        assert.ok(calc!.driftReasons.some(r => r.message.includes('taxRate')));

        const readme = results.filter(p => p.filePath.endsWith('README.md'));
        assert.ok(readme.length >= 1, 'README code block should produce a drift pair');
        const messages = readme.flatMap(p => p.driftReasons.map(r => r.message));
        assert.ok(messages.some(m => /calculateTotal.*1 argument/.test(m)), `expected arity issue, got: ${messages.join(' | ')}`);
        assert.ok(messages.some(m => /formatUsrName.*renamed to 'formatUserName'/.test(m)), `expected rename issue, got: ${messages.join(' | ')}`);
    });

    test('Export report writes Markdown, HTML and JSON', async function () {
        this.timeout(60000);
        const api = await getApi();
        if (api.getAllResults().length === 0) {
            await vscode.commands.executeCommand('drift.scanWorkspace');
        }

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-report-'));
        for (const format of ['markdown', 'html', 'json'] as const) {
            const ext = format === 'markdown' ? 'md' : format;
            const target = vscode.Uri.file(path.join(dir, `report.${ext}`));
            await api.exportReport(format, target);
            const content = fs.readFileSync(target.fsPath, 'utf8');
            assert.ok(content.length > 100, `${format} report should have content`);
            assert.ok(content.includes('calculateTotal'), `${format} report should mention calculateTotal`);
        }
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
        assert.strictEqual(json.tool, 'drift');
        assert.ok(json.summary.total >= 2);
    });

    test('Should detect drift when code changes', async function () {
        this.timeout(60000);
        const api = await getApi();

        const doc = await vscode.workspace.openTextDocument({
            language: 'typescript',
            content: [
                '/**',
                ' * Test function',
                ' * @param a First parameter',
                ' */',
                'function test(a: string) {}',
                ''
            ].join('\n')
        });
        const editor = await vscode.window.showTextDocument(doc);
        console.log('[test] document shown');

        await vscode.commands.executeCommand('drift.scanCurrentFile');
        console.log('[test] first scan done');

        const before = api.getAllResults().find(p => p.filePath === doc.uri.fsPath && p.codeSignature.name === 'test');
        assert.ok(before, 'pair should be found before the edit');
        assert.strictEqual(before!.driftScore, 0, 'no drift before the edit');

        // Rename the parameter so the docs drift
        const applied = await editor.edit(editBuilder => {
            const text = doc.getText();
            const range = new vscode.Range(
                doc.positionAt(text.indexOf('function test')),
                doc.positionAt(text.length)
            );
            editBuilder.replace(range, 'function test(b: string) {}\n');
        });
        assert.ok(applied, 'edit should apply');
        console.log('[test] edit applied');

        await vscode.commands.executeCommand('drift.scanCurrentFile');
        console.log('[test] second scan done');

        const after = api.getAllResults().find(p => p.filePath === doc.uri.fsPath && p.codeSignature.name === 'test');
        assert.ok(after, 'pair should be found after the edit');
        assert.ok(after!.driftScore > 0, 'drift should be detected after the rename');
        assert.ok(
            after!.driftReasons.some(r => r.message.includes("'a'")),
            `expected a reason mentioning the old parameter, got: ${after!.driftReasons.map(r => r.message).join(' | ')}`
        );
    });

});
