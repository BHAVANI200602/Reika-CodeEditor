import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

let previousEdit: {
    document: vscode.TextDocument,
    range: vscode.Range,
    originalText: string,
    codeText: string
} | null = null;

let cachedWebviewPanel: vscode.WebviewPanel | null = null;
let lastPromptId: string | null = null;

interface WebviewMessage {
    command: string;
    text?: string;
    promptId?: string | null;
    code?: string;
    explanation?: string;
    isCode?: boolean;
    codeLanguage?: string | null;
}

export function activate(context: vscode.ExtensionContext) {
    // Register the message handler once at the top level
    const registerWebviewMessageHandler = (panel: vscode.WebviewPanel) => {
        panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            console.log('[Sable] Received webview message:', message);
            const editor = vscode.window.activeTextEditor;

            if (message.command === 'sendPrompt') {
                if (message.promptId === lastPromptId) {
                    console.log('[Sable] Duplicate promptId detected, skipping:', message.promptId);
                    return;
                }
                lastPromptId = message.promptId !== undefined ? message.promptId : null;
                console.log('[Sable] Updated lastPromptId:', lastPromptId);

                try {
                    console.log('[Sable] Sending request to backend:', message.text);
                    const res = await fetch('http://localhost:3000/ask', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: message.text })
                    });
                    console.log('[Sable] Backend response status:', res.status);
                    if (!res.ok) {
                        throw new Error(`HTTP error! status: ${res.status}, message: ${await res.text()}`);
                    }
                    const data = await res.json();
                    console.log('[Sable] Backend response data:', data);
                    const reply = data.reply || 'Sable did not respond.';

                    let code = '';
                    let explanation = reply;
                    let language: string | null = null;

                    if (reply.includes('```')) {
                        const codeMatch = reply.match(/```(\w+)?\n?([\s\S]*?)```/);
                        if (codeMatch) {
                            language = codeMatch[1]?.toLowerCase() || null;
                            code = codeMatch[2].trim();
                            const parts = reply.split(/```[\s\S]*?```/).map((p: string) => p.trim()).filter((p: string) => p).join('\n');
                            explanation = parts || 'No explanation provided.';
                        }
                    }

                    const isCode = !!code && (language || /^[ \t]*(function|class|const|let|var|#include|def|print|if|else)/.test(code));

                    console.log('[Sable] Posting showResponse to webview:', {
                        command: 'showResponse',
                        code: isCode ? code : '',
                        explanation,
                        isCode,
                        codeLanguage: isCode ? (language || 'plaintext') : null,
                        promptId: message.promptId || null
                    });

                    await panel.webview.postMessage({
                        command: 'showResponse',
                        code: isCode ? code : '',
                        explanation,
                        isCode,
                        codeLanguage: isCode ? (language || 'plaintext') : null,
                        promptId: message.promptId || null
                    });

                    if (isCode && editor) {
                        const doc = editor.document;
                        const range = new vscode.Range(editor.selection.start, editor.selection.end);
                        const originalText = doc.getText(range);
                        previousEdit = { document: doc, range, originalText, codeText: code };
                        console.log('[Sable] Stored previousEdit:', {
                            document: doc.uri.fsPath,
                            range,
                            codeText: code
                        });
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Sable] Error in sendPrompt:', errorMessage);
                    await panel.webview.postMessage({
                        command: 'showResponse',
                        code: '',
                        explanation: '❌ Error contacting Sable backend: ' + errorMessage,
                        isCode: false,
                        codeLanguage: null,
                        promptId: message.promptId || null
                    });
                    vscode.window.showErrorMessage(`Error contacting Sable backend: ${errorMessage}`);
                }
            }

            if (message.command === 'acceptEdit') {
                const currentEditor = vscode.window.activeTextEditor;
                if (!currentEditor) {
                    console.log('[Sable] No active text editor for acceptEdit');
                    vscode.window.showErrorMessage('❌ No active text editor to apply changes.');
                    return;
                }
                if (!previousEdit || !previousEdit.codeText) {
                    console.log('[Sable] No previous edit available for acceptEdit');
                    vscode.window.showErrorMessage('❌ No edit available to apply.');
                    return;
                }
                if (previousEdit.document.isClosed) {
                    console.log('[Sable] Document is closed for acceptEdit');
                    vscode.window.showErrorMessage('❌ Cannot apply edit: Document is closed.');
                    return;
                }
                if (previousEdit.document !== currentEditor.document) {
                    console.log('[Sable] Document mismatch in acceptEdit');
                    vscode.window.showErrorMessage('❌ Document mismatch: Please ensure the correct file is open.');
                    return;
                }
                try {
                    const isValidRange = previousEdit.range.start.isBeforeOrEqual(previousEdit.range.end) &&
                        previousEdit.range.end.line < previousEdit.document.lineCount;
                    if (!isValidRange) {
                        console.log('[Sable] Invalid range in acceptEdit');
                        vscode.window.showErrorMessage('❌ Invalid range in document.');
                        return;
                    }
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(previousEdit.document.uri, previousEdit.range, previousEdit.codeText);
                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        await previousEdit.document.save();
                        console.log('[Sable] Edit applied and saved successfully');
                        vscode.window.showInformationMessage('✅ Code applied and saved successfully.');
                        previousEdit = null;
                    } else {
                        console.log('[Sable] Failed to apply edit');
                        vscode.window.showErrorMessage('❌ Failed to apply code to the file.');
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Sable] Error applying edit:', errorMessage);
                    vscode.window.showErrorMessage(`❌ Error applying code: ${errorMessage}`);
                }
            }

            if (message.command === 'rejectEdit') {
                const currentEditor = vscode.window.activeTextEditor;
                if (!currentEditor || !previousEdit) {
                    console.log('[Sable] No editor or previous edit for rejectEdit');
                    vscode.window.showWarningMessage('⚠️ No edit available or editor closed.');
                    return;
                }
                if (previousEdit.document !== currentEditor.document) {
                    console.log('[Sable] Document mismatch in rejectEdit');
                    vscode.window.showWarningMessage('⚠️ Document mismatch: Please ensure the correct file is open.');
                    return;
                }
                try {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(previousEdit.document.uri, previousEdit.range, previousEdit.originalText);
                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        console.log('[Sable] Edit reverted successfully');
                        vscode.window.showInformationMessage('❌ Edit reverted.');
                        previousEdit = null;
                    } else {
                        console.log('[Sable] Failed to revert edit');
                        vscode.window.showErrorMessage('❌ Failed to revert edit.');
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Sable] Error reverting edit:', errorMessage);
                    vscode.window.showErrorMessage(`❌ Error reverting edit: ${errorMessage}`);
                }
            }
        }, undefined, context.subscriptions);
    };

    const askDisposable = vscode.commands.registerCommand('sable.askAI', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.log('[Sable] No active text editor for sable.askAI');
            vscode.window.showErrorMessage('No active text editor.');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();
        if (!selectedText) {
            console.log('[Sable] No text selected for sable.askAI');
            vscode.window.showWarningMessage('Please select some code or text.');
            return;
        }

        console.log('[Sable] Selected text:', selectedText);

        if (!cachedWebviewPanel) {
            cachedWebviewPanel = vscode.window.createWebviewPanel(
                'sableChat',
                'Sable Chat',
                vscode.ViewColumn.Two,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            cachedWebviewPanel.onDidDispose(() => {
                console.log('[Sable] Webview panel disposed');
                cachedWebviewPanel = null;
                previousEdit = null;
                lastPromptId = null;
            }, null, context.subscriptions);

            const htmlPath = path.join(context.extensionPath, 'src', 'chat.html');
            try {
                const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
                cachedWebviewPanel.webview.html = htmlContent;
                console.log('[Sable] Webview HTML loaded successfully');
            } catch (error) {
                console.error('[Sable] Failed to load chat.html:', error);
                vscode.window.showErrorMessage('Failed to load chat interface.');
                return;
            }

            registerWebviewMessageHandler(cachedWebviewPanel);
        } else {
            cachedWebviewPanel.reveal(vscode.ViewColumn.Two);
            console.log('[Sable] Webview panel revealed');
        }

        const promptId = Date.now().toString();
        console.log('[Sable] Sending prompt to webview:', { text: selectedText, promptId });
        try {
            await cachedWebviewPanel.webview.postMessage({ command: 'sendPrompt', text: selectedText, promptId });
        } catch (error) {
            console.error('[Sable] Failed to post sendPrompt message:', error);
            vscode.window.showErrorMessage('Failed to send prompt to webview.');
            return;
        }
    });

    const chatDisposable = vscode.commands.registerCommand('sable.openChat', async () => {
        if (!cachedWebviewPanel) {
            cachedWebviewPanel = vscode.window.createWebviewPanel(
                'sableChat',
                'Sable Chat',
                vscode.ViewColumn.Two,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            cachedWebviewPanel.onDidDispose(() => {
                console.log('[Sable] Webview panel disposed');
                cachedWebviewPanel = null;
                previousEdit = null;
                lastPromptId = null;
            }, null, context.subscriptions);

            const htmlPath = path.join(context.extensionPath, 'src', 'chat.html');
            try {
                const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
                cachedWebviewPanel.webview.html = htmlContent;
                console.log('[Sable] Webview HTML loaded successfully');
            } catch (error) {
                console.error('[Sable] Failed to load chat.html:', error);
                vscode.window.showErrorMessage('Failed to load chat interface.');
                return;
            }

            registerWebviewMessageHandler(cachedWebviewPanel);
        } else {
            cachedWebviewPanel.reveal(vscode.ViewColumn.Two);
            console.log('[Sable] Webview panel revealed');
        }
    });

    context.subscriptions.push(askDisposable, chatDisposable);
}

export function deactivate() {
    cachedWebviewPanel?.dispose();
    cachedWebviewPanel = null;
    lastPromptId = null;
    previousEdit = null;
    console.log('[Sable] Extension deactivated');
}