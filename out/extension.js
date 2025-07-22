"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_fetch_1 = __importDefault(require("node-fetch"));
let previousEdit = null;
let cachedWebviewPanel = null;
let lastPromptId = null;
function activate(context) {
    const registerWebviewMessageHandler = (panel) => {
        panel.webview.onDidReceiveMessage(async (message) => {
            console.log('[Reika] Received webview message:', message);
            const editor = vscode.window.activeTextEditor;
            if (message.command === 'sendPrompt') {
                if (message.promptId === lastPromptId) {
                    console.log('[Reika] Duplicate promptId detected, skipping:', message.promptId);
                    return;
                }
                lastPromptId = message.promptId !== undefined ? message.promptId : null;
                console.log('[Reika] Updated lastPromptId:', lastPromptId);
                try {
                    console.log('[Reika] Sending request to backend:', message.text);
                    const res = await (0, node_fetch_1.default)('https://proxy-server-inky-three.vercel.app/ask', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: message.text })
                    });
                    console.log('[Reika] Backend response status:', res.status);
                    if (!res.ok) {
                        throw new Error(`HTTP error! status: ${res.status}, message: ${await res.text()}`);
                    }
                    const data = await res.json();
                    console.log('[Reika] Backend response data:', data);
                    const reply = data.reply || 'Reika did not respond.';
                    let code = '';
                    let explanation = reply;
                    let language = null;
                    if (reply.includes('```')) {
                        const codeMatch = reply.match(/```(\w+)?\n?([\s\S]*?)```/);
                        if (codeMatch) {
                            language = codeMatch[1]?.toLowerCase() || null;
                            code = codeMatch[2].trim();
                            const parts = reply.split(/```[\s\S]*?```/).map((p) => p.trim()).filter((p) => p).join('\n');
                            explanation = parts || 'No explanation provided.';
                        }
                    }
                    const isCode = !!code && (language || /^[ \t]*(function|class|const|let|var|#include|def|print|if|else)/.test(code));
                    console.log('[Reika] Posting showResponse to webview:', {
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
                        console.log('[Reika] Stored previousEdit:', {
                            document: doc.uri.fsPath,
                            range,
                            codeText: code
                        });
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Reika] Error in sendPrompt:', errorMessage);
                    await panel.webview.postMessage({
                        command: 'showResponse',
                        code: '',
                        explanation: '❌ Error contacting Reika backend: ' + errorMessage,
                        isCode: false,
                        codeLanguage: null,
                        promptId: message.promptId || null
                    });
                    vscode.window.showErrorMessage(`Error contacting Reika backend: ${errorMessage}`);
                }
            }
            if (message.command === 'acceptEdit') {
                const currentEditor = vscode.window.activeTextEditor;
                if (!currentEditor) {
                    console.log('[Reika] No active text editor for acceptEdit');
                    vscode.window.showErrorMessage('❌ No active text editor to apply changes.');
                    return;
                }
                if (!previousEdit || !previousEdit.codeText) {
                    console.log('[Reika] No previous edit available for acceptEdit');
                    vscode.window.showErrorMessage('❌ No edit available to apply.');
                    return;
                }
                if (previousEdit.document.isClosed) {
                    console.log('[Reika] Document is closed for acceptEdit');
                    vscode.window.showErrorMessage('❌ Cannot apply edit: Document is closed.');
                    return;
                }
                if (previousEdit.document !== currentEditor.document) {
                    console.log('[Reika] Document mismatch in acceptEdit');
                    vscode.window.showErrorMessage('❌ Document mismatch: Please ensure the correct file is open.');
                    return;
                }
                try {
                    const isValidRange = previousEdit.range.start.isBeforeOrEqual(previousEdit.range.end) &&
                        previousEdit.range.end.line < previousEdit.document.lineCount;
                    if (!isValidRange) {
                        console.log('[Reika] Invalid range in acceptEdit');
                        vscode.window.showErrorMessage('❌ Invalid range in document.');
                        return;
                    }
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(previousEdit.document.uri, previousEdit.range, previousEdit.codeText);
                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        await previousEdit.document.save();
                        console.log('[Reika] Edit applied and saved successfully');
                        vscode.window.showInformationMessage('✅ Code applied and saved successfully.');
                        previousEdit = null;
                    }
                    else {
                        console.log('[Reika] Failed to apply edit');
                        vscode.window.showErrorMessage('❌ Failed to apply code to the file.');
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Reika] Error applying edit:', errorMessage);
                    vscode.window.showErrorMessage(`❌ Error applying code: ${errorMessage}`);
                }
            }
            if (message.command === 'rejectEdit') {
                const currentEditor = vscode.window.activeTextEditor;
                if (!currentEditor || !previousEdit) {
                    console.log('[Reika] No editor or previous edit for rejectEdit');
                    vscode.window.showWarningMessage('⚠️ No edit available or editor closed.');
                    return;
                }
                if (previousEdit.document !== currentEditor.document) {
                    console.log('[Reika] Document mismatch in rejectEdit');
                    vscode.window.showWarningMessage('⚠️ Document mismatch: Please ensure the correct file is open.');
                    return;
                }
                try {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(previousEdit.document.uri, previousEdit.range, previousEdit.originalText);
                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        console.log('[Reika] Edit reverted successfully');
                        vscode.window.showInformationMessage('❌ Edit reverted.');
                        previousEdit = null;
                    }
                    else {
                        console.log('[Reika] Failed to revert edit');
                        vscode.window.showErrorMessage('❌ Failed to revert edit.');
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[Reika] Error reverting edit:', errorMessage);
                    vscode.window.showErrorMessage(`❌ Error reverting edit: ${errorMessage}`);
                }
            }
        }, undefined, context.subscriptions);
    };
    const askDisposable = vscode.commands.registerCommand('reika.askAI', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.log('[Reika] No active text editor for reika.askAI');
            vscode.window.showErrorMessage('No active text editor.');
            return;
        }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();
        if (!selectedText) {
            console.log('[Reika] No text selected for reika.askAI');
            vscode.window.showWarningMessage('Please select some code or text.');
            return;
        }
        console.log('[Reika] Selected text:', selectedText);
        if (!cachedWebviewPanel) {
            cachedWebviewPanel = vscode.window.createWebviewPanel('reikaChat', 'Reika Chat', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src'))] });
            cachedWebviewPanel.onDidDispose(() => {
                console.log('[Reika] Webview panel disposed');
                cachedWebviewPanel = null;
                previousEdit = null;
                lastPromptId = null;
            }, null, context.subscriptions);
            const htmlPath = path.join(context.extensionPath, 'src', 'chat.html');
            const cssPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'style.css'));
            const jsPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'script.js'));
            const cssUri = cachedWebviewPanel.webview.asWebviewUri(cssPath);
            const jsUri = cachedWebviewPanel.webview.asWebviewUri(jsPath);
            try {
                let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
                htmlContent = htmlContent.replace('href="style.css"', `href="${cssUri}"`);
                htmlContent = htmlContent.replace('src="script.js"', `src="${jsUri}"`);
                cachedWebviewPanel.webview.html = htmlContent;
                console.log('[Reika] Webview HTML loaded successfully');
            }
            catch (error) {
                console.error('[Reika] Failed to load chat.html:', error);
                vscode.window.showErrorMessage('Failed to load chat interface.');
                return;
            }
            registerWebviewMessageHandler(cachedWebviewPanel);
        }
        else {
            cachedWebviewPanel.reveal(vscode.ViewColumn.Two);
            console.log('[Reika] Webview panel revealed');
        }
        const promptId = Date.now().toString();
        console.log('[Reika] Sending prompt to webview:', { text: selectedText, promptId });
        try {
            await cachedWebviewPanel.webview.postMessage({ command: 'sendPrompt', text: selectedText, promptId });
        }
        catch (error) {
            console.error('[Reika] Failed to post sendPrompt message:', error);
            vscode.window.showErrorMessage('Failed to send prompt to webview.');
            return;
        }
    });
    const chatDisposable = vscode.commands.registerCommand('reika.openChat', async () => {
        if (!cachedWebviewPanel) {
            cachedWebviewPanel = vscode.window.createWebviewPanel('reikaChat', 'Reika Chat', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src'))] });
            cachedWebviewPanel.onDidDispose(() => {
                console.log('[Reika] Webview panel disposed');
                cachedWebviewPanel = null;
                previousEdit = null;
                lastPromptId = null;
            }, null, context.subscriptions);
            const htmlPath = path.join(context.extensionPath, 'src', 'chat.html');
            const cssPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'style.css'));
            const jsPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'script.js'));
            const cssUri = cachedWebviewPanel.webview.asWebviewUri(cssPath);
            const jsUri = cachedWebviewPanel.webview.asWebviewUri(jsPath);
            try {
                let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
                htmlContent = htmlContent.replace('href="style.css"', `href="${cssUri}"`);
                htmlContent = htmlContent.replace('src="script.js"', `src="${jsUri}"`);
                cachedWebviewPanel.webview.html = htmlContent;
                console.log('[Reika] Webview HTML loaded successfully');
            }
            catch (error) {
                console.error('[Reika] Failed to load chat.html:', error);
                vscode.window.showErrorMessage('Failed to load chat interface.');
                return;
            }
            registerWebviewMessageHandler(cachedWebviewPanel);
        }
        else {
            cachedWebviewPanel.reveal(vscode.ViewColumn.Two);
            console.log('[Reika] Webview panel revealed');
        }
    });
    context.subscriptions.push(askDisposable, chatDisposable);
}
function deactivate() {
    cachedWebviewPanel?.dispose();
    cachedWebviewPanel = null;
    lastPromptId = null;
    previousEdit = null;
    console.log('[Reika] Extension deactivated');
}
