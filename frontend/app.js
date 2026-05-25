// --- Monaco Editor Instances & Global Variables ---
let rustEditor = null;
let jsEditor = null;

// Clean code templates for the compilers
const PRESETS = {
    rust: `fn main() {
    println!("Hello, RustBin! Welcome to the ultra-clean Rust compiler playpen.");
    
    let numbers = vec![1, 2, 3, 4, 5];
    let sum: i32 = numbers.iter().sum();
    println!("The sum of elements is: {}", sum);
}`,
    js: `console.log("Hello, RustBin! Welcome to the ultra-clean JavaScript compiler playpen.");

const numbers = [1, 2, 3, 4, 5];
const sum = numbers.reduce((acc, curr) => acc + curr, 0);
console.log("The sum of elements is:", sum);`
};

// API Base configuration for local vs production (Vercel Proxying)
const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:3000"
    : "";

// --- Initialize Monaco Editors via jsDelivr CDN Loader ---
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
    // Hide loading spinners instantly once Monaco loads
    document.querySelectorAll('.editor-loading').forEach(el => el.style.display = 'none');

    // Rust Monaco Editor
    rustEditor = monaco.editor.create(document.getElementById('monaco-rust-container'), {
        value: PRESETS.rust,
        language: 'rust',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Fira Code', var(--font-mono)",
        lineNumbers: 'on',
        minimap: { enabled: false },
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'on'
    });

    // Javascript Monaco Editor
    jsEditor = monaco.editor.create(document.getElementById('monaco-js-container'), {
        value: PRESETS.js,
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Fira Code', var(--font-mono)",
        lineNumbers: 'on',
        minimap: { enabled: false },
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'on'
    });
});

// --- Sidebar Page Navigation Switching ---
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        // Toggle active class in nav
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        // Toggle active page
        const targetPage = item.getAttribute('data-page');
        document.querySelectorAll('.document-page').forEach(page => page.classList.remove('active'));
        document.getElementById(`page-${targetPage}`).classList.add('active');
    });
});

// --- COMPILER RUN ACTION HANDLERS ---

// Execute Rust code
document.getElementById('btn-run-rust').addEventListener('click', async () => {
    if (!rustEditor) return;
    const code = rustEditor.getValue();
    const btn = document.getElementById('btn-run-rust');
    const terminal = document.getElementById('console-output-rust');
    const speedFooter = document.getElementById('speed-rust');

    // Toggle loader
    btn.disabled = true;
    btn.innerText = "🖍️ Compiling...";
    terminal.classList.remove('placeholder');
    terminal.innerHTML = `<span style="color: var(--neo-yellow);">🚀 Launching compiler environment and sandboxing execution...</span>`;
    speedFooter.innerText = "Execution time: -- ms";

    try {
        const response = await fetch(`${API_BASE}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "rust" })
        });
        const result = await response.json();
        
        btn.disabled = false;
        btn.innerText = "🖍️ Run Code";

        if (result.success) {
            terminal.innerHTML = "";
            if (result.stdout) {
                terminal.innerHTML += `<div style="color: #00ff00;">${escapeHtml(result.stdout)}</div>`;
            }
            if (result.stderr) {
                terminal.innerHTML += `<div style="color: #ffaa00; font-style: italic;">${escapeHtml(result.stderr)}</div>`;
            }
            if (!result.stdout && !result.stderr) {
                terminal.innerHTML += `<div style="color: #888;">(Empty Output)</div>`;
            }
            speedFooter.innerText = `Execution time: ${result.execution_time_ms.toFixed(1)} ms`;
        } else {
            terminal.innerHTML = `<div style="color: #ff3333; font-weight: bold; border-bottom: 2px dashed #ff3333; padding-bottom: 4px; margin-bottom: 8px;">❌ Compiler Compilation Error:</div>`;
            terminal.innerHTML += `<div style="color: #ff5555; white-space: pre-wrap;">${escapeHtml(result.stderr || "Unknown build error.")}</div>`;
            speedFooter.innerText = "Execution time: 0.0 ms";
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerText = "🖍️ Run Code";
        terminal.innerHTML = `<div style="color: #ff3333;">❌ Execution Failed: Make sure the backend compiler server is running and accessible.</div>`;
        speedFooter.innerText = "Execution time: -- ms";
    }
});

// Execute JavaScript code
document.getElementById('btn-run-js').addEventListener('click', async () => {
    if (!jsEditor) return;
    const code = jsEditor.getValue();
    const btn = document.getElementById('btn-run-js');
    const terminal = document.getElementById('console-output-js');
    const speedFooter = document.getElementById('speed-js');

    // Toggle loader
    btn.disabled = true;
    btn.innerText = "🖍️ Executing...";
    terminal.classList.remove('placeholder');
    terminal.innerHTML = `<span style="color: var(--neo-yellow);">🚀 Spawning JS sandbox context...</span>`;
    speedFooter.innerText = "Execution time: -- ms";

    try {
        const response = await fetch(`${API_BASE}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "javascript" })
        });
        const result = await response.json();
        
        btn.disabled = false;
        btn.innerText = "🖍️ Run Code";

        if (result.success) {
            terminal.innerHTML = "";
            if (result.stdout) {
                terminal.innerHTML += `<div style="color: #00ff00;">${escapeHtml(result.stdout)}</div>`;
            }
            if (result.stderr) {
                terminal.innerHTML += `<div style="color: #ffaa00; font-style: italic;">${escapeHtml(result.stderr)}</div>`;
            }
            if (!result.stdout && !result.stderr) {
                terminal.innerHTML += `<div style="color: #888;">(Empty Output)</div>`;
            }
            speedFooter.innerText = `Execution time: ${result.execution_time_ms.toFixed(1)} ms`;
        } else {
            terminal.innerHTML = `<div style="color: #ff3333; font-weight: bold; border-bottom: 2px dashed #ff3333; padding-bottom: 4px; margin-bottom: 8px;">❌ Sandbox Runtime Error:</div>`;
            terminal.innerHTML += `<div style="color: #ff5555; white-space: pre-wrap;">${escapeHtml(result.stderr || "Unknown runtime execution error.")}</div>`;
            speedFooter.innerText = "Execution time: 0.0 ms";
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerText = "🖍️ Run Code";
        terminal.innerHTML = `<div style="color: #ff3333;">❌ Execution Failed: Make sure the backend execution server is running and accessible.</div>`;
        speedFooter.innerText = "Execution time: -- ms";
    }
});

// HTML escaping helper
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- Horizontal Resizer Handles Drag-and-Drop ---
function setupWorkspaceResizer(resizerId, editorPaneClass, analyticsPaneId) {
    const resizer = document.getElementById(resizerId);
    const container = resizer.parentElement;
    const rightPane = document.getElementById(analyticsPaneId);

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const containerRect = container.getBoundingClientRect();
        const relativeX = e.clientX - containerRect.left;
        
        // Boundaries
        const minWidth = 200;
        const maxWidth = containerRect.width - 200;
        
        if (relativeX > minWidth && relativeX < maxWidth) {
            const rightWidth = containerRect.width - relativeX - 6; // Subtract resizer bar width
            rightPane.style.width = `${rightWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
            
            // Recalculate Monaco layouts after sizing shifts
            if (rustEditor) rustEditor.layout();
            if (jsEditor) jsEditor.layout();
        }
    });
}

// Attach drag handles
setupWorkspaceResizer('resizer-rust', 'editor-pane', 'analytics-rust');
setupWorkspaceResizer('resizer-js', 'editor-pane', 'analytics-js');
