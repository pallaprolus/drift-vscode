import * as vscode from 'vscode';

export class DriftLogger {
    private static outputChannel: vscode.OutputChannel;

    public static initialize(channelName: string): void {
        this.outputChannel = vscode.window.createOutputChannel(channelName);
    }

    public static log(message: string): void {
        if (this.outputChannel) {
            const timestamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        }
    }

    public static error(message: string, error?: unknown): void {
        if (this.outputChannel) {
            const timestamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${message}`);
            if (error) {
                this.outputChannel.appendLine(error instanceof Error ? error.stack || error.message : String(error));
            }
        }
    }

    public static dispose(): void {
        if (this.outputChannel) {
            this.outputChannel.dispose();
        }
    }
}
