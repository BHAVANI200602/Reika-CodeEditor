const vscode = acquireVsCodeApi();
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send-button');
const responseDiv = document.getElementById('response');
const messagesDiv = document.getElementById('messages');
let lastPromptId = null;
const initialPromptHeight = promptInput.scrollHeight;

function clearQuote() {
    if (responseDiv.textContent === 'Ready when you are!') {
        responseDiv.style.display = 'none';
    }
}

function resetPromptHeight() {
    promptInput.style.height = `${initialPromptHeight}px`;
}

function sendPrompt() {
    const text = promptInput.value.trim();
    if (!text) return;

    clearQuote();

    const userMessage = document.createElement('div');
    userMessage.className = 'message user-message';
    userMessage.textContent = text;
    messagesDiv.appendChild(userMessage);

    const thinkingMessage = document.createElement('div');
    thinkingMessage.className = 'message response-message thinking';
    thinkingMessage.innerHTML = 'Thinking<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
    messagesDiv.appendChild(thinkingMessage);

    responseDiv.textContent = 'Thinking...';
    sendButton.disabled = true;

    const promptId = Date.now().toString();

    try {
        console.log('[Webview] Sending prompt:', {
            text,
            promptId
        });

        vscode.postMessage({
            command: 'sendPrompt',
            text,
            promptId
        });

        promptInput.value = '';
        resetPromptHeight();
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('[Webview] Error sending prompt:', error);
        thinkingMessage.className = 'message error-message';
        thinkingMessage.textContent = '❌ Error sending prompt: ' + (error.message || 'Unknown error');
        responseDiv.textContent = 'Error sending prompt.';
        sendButton.disabled = false;
    }
}

function attachActionButtons(container, isCode) {
    if (!isCode) return;

    const codeBlock = container.querySelector('.code-block');
    const codeContent = document.createElement('div');
    codeContent.className = 'code-content';
    codeContent.textContent = codeBlock.textContent;
    codeBlock.textContent = '';
    codeBlock.appendChild(codeContent);

    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'code-wrapper';
    codeBlock.parentNode.insertBefore(codeWrapper, codeBlock);
    codeWrapper.appendChild(codeBlock);

    const codeActions = document.createElement('div');
    codeActions.className = 'code-actions';
    codeWrapper.prepend(codeActions);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        <span>Copy</span>
    `;
    codeActions.appendChild(copyBtn);

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeContent.textContent).then(() => {
            copyBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
                <span>Copied!</span>
            `;
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                    <span>Copy</span>
                `;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            copyBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                </svg>
                <span>Error</span>
            `;
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                    <span>Copy</span>
                `;
            }, 2000);
        });
    });

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'accept-btn';
    acceptBtn.textContent = 'Apply';
    codeActions.appendChild(acceptBtn);
    acceptBtn.onclick = () => {
        vscode.postMessage({
            command: 'acceptEdit'
        });
    };

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'reject-btn';
    rejectBtn.textContent = 'Reject';
    codeActions.appendChild(rejectBtn);
    rejectBtn.onclick = () => {
        vscode.postMessage({
            command: 'rejectEdit'
        });
        container.remove();
    };

    // Apply Prism syntax highlighting
    Prism.highlightElement(codeContent);
}

promptInput.addEventListener('focus', clearQuote);

promptInput.addEventListener('input', () => {
    clearQuote();
    promptInput.style.height = 'auto';
    promptInput.style.height = `${promptInput.scrollHeight}px`;
});

promptInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
    }
});

sendButton.addEventListener('click', sendPrompt);

window.addEventListener('message', (event) => {
    console.log('[Webview] Received message:', event.data);
    const msg = event.data;

    if (msg.command === 'showResponse') {
        if (msg.promptId === lastPromptId) {
            console.log('[Webview] Duplicate promptId, skipping:', msg.promptId);
            return;
        }
        lastPromptId = msg.promptId;

        const thinkingMessage = messagesDiv.querySelector('.thinking');

        if (msg.explanation) {
            const explanationMessage = document.createElement('div');
            explanationMessage.className = msg.explanation.startsWith('❌') ? 'message error-message' : 'message response-message';
            explanationMessage.textContent = msg.explanation || 'No explanation received.';

            if (thinkingMessage) {
                messagesDiv.replaceChild(explanationMessage, thinkingMessage);
            } else {
                messagesDiv.appendChild(explanationMessage);
            }
        }

        if (msg.isCode && msg.code) {
            const codeMessage = document.createElement('div');
            codeMessage.className = 'message response-message';
            const contentDiv = document.createElement('div');
            const codeBlock = document.createElement('div');
            codeBlock.className = `code-block language-${msg.codeLanguage || 'plaintext'}`;
            codeBlock.textContent = msg.code || 'No code received.';
            contentDiv.appendChild(codeBlock);
            codeMessage.appendChild(contentDiv);
            messagesDiv.appendChild(codeMessage);
            attachActionButtons(codeMessage, true);
        }

        responseDiv.textContent = msg.isCode ? 'Code response received. Review and apply changes.' : (msg.explanation || 'No response received.');
        sendButton.disabled = false;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        promptInput.focus();
    } else if (msg.command === 'sendPrompt') {
        console.log('[Webview] Processing sendPrompt:', msg);
        promptInput.value = msg.text || '';

        if (promptInput.value && msg.promptId !== lastPromptId) {
            lastPromptId = msg.promptId;
            sendPrompt();
        }
    }
});

window.onload = () => {
    console.log('[Webview] Webview loaded');
    vscode.postMessage({
        command: 'ready'
    });
    promptInput.style.height = 'auto';
    promptInput.style.height = `${promptInput.scrollHeight}px`;
};