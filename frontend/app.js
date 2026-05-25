// --- Monaco Editor Instances & Global Variables ---
let rustEditor = null;
let jsEditor = null;

let rustChartInstance = null;
let jsChartInstance = null;

let currentOptimizedRustCode = "";
let currentOptimizedJsCode = "";

// High-Performance Optimization Presets
const PRESETS = {
    rust: `// Rust Playground: Vector Capacity Pre-allocation
// Compare pushing into Vec::new() vs Vec::with_capacity(100_000)

fn main() {
    let limit = 100000;
    
    // Sub-optimal: Starts with 0 capacity, causing O(N) reallocations as elements push
    let mut vec_unoptimized = Vec::new();
    for i in 0..limit {
        vec_unoptimized.push(i);
    }
    
    println!("Filled vector containing {} elements.", vec_unoptimized.len());
}`,
    js: `// JavaScript Playground: Linear vs Set Lookup Performance
// Compare scanning a large Array vs using Set lookups

const limit = 10000;
const array = [];
for (let i = 0; i < limit; i++) {
    array.push(i);
}

// Sub-optimal: Checks Array item index 3,000 times (Linear search O(N))
var matches = 0;
for (let x = 0; x < 3000; x++) {
    if (array.includes(x)) {
        matches++;
    }
}

console.log("Lookup match count:", matches);`
};

// Initialize Monaco Editors via CDN Loader
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
    // Hide loaders
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

// --- Split Workspace Drag-and-Resize Handle Controllers ---

function bindResizer(resizerId, paneId, editorGetter) {
    const resizer = document.getElementById(resizerId);
    const rightPane = document.getElementById(paneId);
    let isResizing = false;

    resizer.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const windowWidth = window.innerWidth;
        const newWidth = windowWidth - e.clientX - 16; // offset padding
        if (newWidth > 280 && newWidth < windowWidth - 240 - 200) {
            rightPane.style.width = `${newWidth}px`;
            const editor = editorGetter();
            if (editor) editor.layout();
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    });
}

// Bind split sliders
bindResizer('resizer-rust', 'analytics-rust', () => rustEditor);
bindResizer('resizer-js', 'analytics-js', () => jsEditor);

// --- Notion left sidebar routing page transitions ---
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.document-page');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const pageId = item.dataset.page;
        
        navItems.forEach(n => n.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        
        item.classList.add('active');
        document.getElementById(`page-${pageId}`).classList.add('active');
        
        // Trigger Layout updates for Monaco
        setTimeout(() => {
            if (pageId === 'rust-ide' && rustEditor) rustEditor.layout();
            if (pageId === 'js-ide' && jsEditor) jsEditor.layout();
        }, 50);
    });
});

// --- Crayon Tab buttons controllers ---
const tabButtons = document.querySelectorAll('.tab-btn-neobrutalist');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        const parentPane = btn.closest('.analytics-pane');
        
        // Find sibling tabs in the same pane
        parentPane.querySelectorAll('.tab-btn-neobrutalist').forEach(b => b.classList.remove('active'));
        parentPane.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`tab-${tabId}`).classList.add('active');
    });
});

function switchPaneTab(paneId, tabId) {
    const pane = document.getElementById(paneId);
    pane.querySelectorAll('.tab-btn-neobrutalist').forEach(b => b.classList.remove('active'));
    pane.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const targetBtn = Array.from(pane.querySelectorAll('.tab-btn-neobrutalist')).find(b => b.dataset.tab === tabId);
    if (targetBtn) targetBtn.classList.add('active');
    
    const targetContent = document.getElementById(`tab-${tabId}`);
    if (targetContent) targetContent.classList.add('active');
}

// --- High-Performance API Integrations ---

const API_BASE = "http://127.0.0.1:3000";

// --- RUST ACTIONS ---

document.getElementById('btn-run-rust').addEventListener('click', async () => {
    if (!rustEditor) return;
    const code = rustEditor.getValue();
    const btn = document.getElementById('btn-run-rust');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Running`;
    
    switchPaneTab('analytics-rust', 'console-rust');
    const consoleOutput = document.getElementById('console-output-rust');
    consoleOutput.innerText = "Compiling sandbox Rust code via rustc...";
    consoleOutput.classList.remove('placeholder');
    consoleOutput.style.color = "#000000";
    
    try {
        const response = await fetch(`${API_BASE}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "rust" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            consoleOutput.innerText = data.stdout || "Rust block ran successfully with empty stdout.";
            consoleOutput.style.color = "var(--neo-green)";
        } else {
            consoleOutput.innerText = data.stderr || "Compiler error occurred.";
            consoleOutput.style.color = "var(--neo-pink)";
        }
        
        document.getElementById('speed-rust').innerText = `Execution time: ${data.execution_time_ms.toFixed(2)} ms`;
        
    } catch (err) {
        consoleOutput.innerText = `Sandboxing error: Backend compiler service is offline.\nDetails: ${err}`;
        consoleOutput.style.color = "var(--neo-pink)";
    } finally {
        btn.disabled = false;
        btn.innerHTML = `🖍️ Run`;
    }
});

document.getElementById('btn-bench-rust').addEventListener('click', async () => {
    if (!rustEditor) return;
    const code = rustEditor.getValue();
    const btn = document.getElementById('btn-bench-rust');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Benchmarking`;
    switchPaneTab('analytics-rust', 'benchmark-rust');
    
    try {
        const response = await fetch(`${API_BASE}/api/benchmark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "rust" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateStatsRow("rust", data);
            await triggerComparisonBenchmark("rust", code, data);
        } else {
            alert(`Rust Benchmarking failed:\n${data.stderr}`);
        }
        
    } catch (e) {
        alert(`Rust benchmark connection error: ${e}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `⏱️ Benchmark`;
    }
});

document.getElementById('btn-analyze-rust').addEventListener('click', async () => {
    if (!rustEditor) return;
    const code = rustEditor.getValue();
    const btn = document.getElementById('btn-analyze-rust');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Scans Active`;
    switchPaneTab('analytics-rust', 'optimizer-rust');
    
    try {
        const response = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "rust" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderOptimizations("rust", data);
            updateComplexityStats("rust", data.code_complexity);
        } else {
            alert("Rust diagnostics scans crashed.");
        }
        
    } catch (e) {
        alert(`Rust analyzer connection error: ${e}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `🔍 Optimize`;
    }
});

document.getElementById('btn-apply-rust').addEventListener('click', () => {
    if (rustEditor && currentOptimizedRustCode) {
        rustEditor.setValue(currentOptimizedRustCode);
        switchPaneTab('analytics-rust', 'console-rust');
        document.getElementById('console-output-rust').innerText = "Loaded optimal Rust code into drawing pane! Compile or benchmark to compare.";
        document.getElementById('console-output-rust').style.color = "var(--neo-blue)";
        clearDiagnostics("rust");
    }
});

// --- JAVASCRIPT ACTIONS ---

document.getElementById('btn-run-js').addEventListener('click', async () => {
    if (!jsEditor) return;
    const code = jsEditor.getValue();
    const btn = document.getElementById('btn-run-js');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Running`;
    
    switchPaneTab('analytics-js', 'console-js');
    const consoleOutput = document.getElementById('console-output-js');
    consoleOutput.innerText = "Writing source to sandbox and evaluating using local Node subprocess...";
    consoleOutput.classList.remove('placeholder');
    consoleOutput.style.color = "#000000";
    
    try {
        const response = await fetch(`${API_BASE}/api/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "javascript" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            consoleOutput.innerText = data.stdout || "JS block ran successfully with empty stdout.";
            consoleOutput.style.color = "var(--neo-green)";
        } else {
            consoleOutput.innerText = data.stderr || "Runtime error occurred.";
            consoleOutput.style.color = "var(--neo-pink)";
        }
        
        document.getElementById('speed-js').innerText = `Execution time: ${data.execution_time_ms.toFixed(2)} ms`;
        
    } catch (err) {
        consoleOutput.innerText = `Sandboxing error: Node.js subprocess engine is offline.\nDetails: ${err}`;
        consoleOutput.style.color = "var(--neo-pink)";
    } finally {
        btn.disabled = false;
        btn.innerHTML = `🖍️ Run`;
    }
});

document.getElementById('btn-bench-js').addEventListener('click', async () => {
    if (!jsEditor) return;
    const code = jsEditor.getValue();
    const btn = document.getElementById('btn-bench-js');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Benchmarking`;
    switchPaneTab('analytics-js', 'benchmark-js');
    
    try {
        const response = await fetch(`${API_BASE}/api/benchmark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "javascript" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateStatsRow("js", data);
            await triggerComparisonBenchmark("js", code, data);
        } else {
            alert(`JS Benchmarking failed:\n${data.stderr}`);
        }
        
    } catch (e) {
        alert(`JS benchmark connection error: ${e}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `⏱️ Benchmark`;
    }
});

document.getElementById('btn-analyze-js').addEventListener('click', async () => {
    if (!jsEditor) return;
    const code = jsEditor.getValue();
    const btn = document.getElementById('btn-analyze-js');
    
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Scans Active`;
    switchPaneTab('analytics-js', 'optimizer-js');
    
    try {
        const response = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: "javascript" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderOptimizations("js", data);
            updateComplexityStats("js", data.code_complexity);
        } else {
            alert("JS optimization scans crashed.");
        }
        
    } catch (e) {
        alert(`JS analyzer connection error: ${e}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `🔍 Optimize`;
    }
});

document.getElementById('btn-apply-js').addEventListener('click', () => {
    if (jsEditor && currentOptimizedJsCode) {
        jsEditor.setValue(currentOptimizedJsCode);
        switchPaneTab('analytics-js', 'console-js');
        document.getElementById('console-output-js').innerText = "Loaded optimal JS code into drawing pane! Run or benchmark to compare.";
        document.getElementById('console-output-js').style.color = "var(--neo-blue)";
        clearDiagnostics("js");
    }
});

// --- General Core Helper Engines ---

function clearDiagnostics(lang) {
    document.getElementById(`opt-badge-${lang}`).style.display = 'none';
    document.getElementById(`score-val-${lang}`).innerText = '--';
    document.getElementById(`desc-rust`).innerText = 'Grade details will display after completing an optimizer scan.';
    document.getElementById(`list-${lang}`).innerHTML = `<div class="suggestion-placeholder">🛡️ Scan your files to see optimization lints.</div>`;
    document.getElementById(`diff-widget-${lang}`).style.display = 'none';
    document.getElementById(`comparison-${lang}`).style.display = 'none';
    if (lang === 'rust') currentOptimizedRustCode = "";
    else currentOptimizedJsCode = "";
}

function updateStatsRow(lang, data) {
    const ops = data.ops_per_sec;
    const opsText = ops > 1_000_000 ? `${(ops / 1_000_000).toFixed(2)} M` : ops > 1000 ? `${(ops / 1000).toFixed(1)} K` : ops.toFixed(0);
    
    document.getElementById(`ops-${lang}`).innerText = opsText;
    document.getElementById(`mean-${lang}`).innerText = formatDuration(data.mean_ns);
    document.getElementById(`moe-${lang}`).innerText = `± ${formatDuration(data.margin_of_error_ns)}`;
    document.getElementById(`stddev-${lang}`).innerText = formatDuration(data.std_dev_ns);
    
    renderJitDensityChart(lang, data.raw_durations_ns);
}

function renderJitDensityChart(lang, durations, optimizedDurations = null) {
    const ctx = document.getElementById(`chart-${lang}`).getContext('2d');
    let chartInstance = lang === 'rust' ? rustChartInstance : jsChartInstance;
    
    if (chartInstance) {
        chartInstance.destroy();
    }

    const binCount = 25;
    const minVal = Math.min(...durations, ...(optimizedDurations || []));
    const maxVal = Math.max(...durations, ...(optimizedDurations || []));
    const range = maxVal - minVal;
    const binWidth = range / binCount;
    
    const labels = [];
    const userCounts = Array(binCount).fill(0);
    const optCounts = Array(binCount).fill(0);
    
    for (let i = 0; i < binCount; i++) {
        const binStart = minVal + i * binWidth;
        const binEnd = binStart + binWidth;
        labels.push(formatDuration((binStart + binEnd) / 2));
    }
    
    durations.forEach(val => {
        let binIdx = Math.floor((val - minVal) / binWidth);
        if (binIdx >= binCount) binIdx = binCount - 1;
        userCounts[binIdx]++;
    });

    if (optimizedDurations) {
        optimizedDurations.forEach(val => {
            let binIdx = Math.floor((val - minVal) / binWidth);
            if (binIdx >= binCount) binIdx = binCount - 1;
            optCounts[binIdx]++;
        });
    }

    const datasets = [{
        label: 'Your Code Speed (Orange)',
        data: userCounts,
        borderColor: '#ff9800',
        backgroundColor: 'rgba(255, 152, 0, 0.12)',
        tension: 0.4,
        fill: true,
        borderWidth: 3.5
    }];

    if (optimizedDurations) {
        datasets.push({
            label: 'Optimal Code Speed (Green)',
            data: optCounts,
            borderColor: '#4caf50',
            backgroundColor: 'rgba(76, 175, 80, 0.12)',
            tension: 0.4,
            fill: true,
            borderWidth: 3.5
        });
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#000000',
                        font: { family: 'Lexend', size: 10, weight: 'bold' }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#000000',
                        font: { family: 'Fira Code', size: 8 },
                        maxRotation: 45
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                },
                y: {
                    ticks: { display: false },
                    grid: { display: false }
                }
            }
        }
    });

    if (lang === 'rust') rustChartInstance = chartInstance;
    else jsChartInstance = chartInstance;
}

// Side-by-side benchmarking trigger
async function triggerComparisonBenchmark(lang, code, userBenchData) {
    try {
        const analyzeRes = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: lang })
        });
        
        const analyzeData = await analyzeRes.json();
        
        if (analyzeData.success && analyzeData.suggested_optimized_code && analyzeData.suggested_optimized_code !== code) {
            
            const benchRes = await fetch(`${API_BASE}/api/benchmark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: analyzeData.suggested_optimized_code, language: lang })
            });
            
            const optBenchData = await benchRes.json();
            
            if (optBenchData.success) {
                const speedupPct = ((userBenchData.mean_ns - optBenchData.mean_ns) / userBenchData.mean_ns * 100);
                
                const card = document.getElementById(`comparison-${lang}`);
                card.style.display = 'block';
                
                const valElem = document.getElementById(`pct-${lang}`);
                
                if (speedupPct > 0) {
                    valElem.innerText = `${speedupPct.toFixed(1)}%`;
                    valElem.style.color = "var(--neo-green)";
                } else {
                    valElem.innerText = "Ideal!";
                    valElem.style.color = "var(--neo-blue)";
                }
                
                const maxTime = Math.max(userBenchData.mean_ns, optBenchData.mean_ns);
                const userBarWidth = (userBenchData.mean_ns / maxTime) * 100;
                const optBarWidth = (optBenchData.mean_ns / maxTime) * 100;
                
                document.getElementById(`bar-user-${lang}`).style.width = `${userBarWidth}%`;
                document.getElementById(`bar-opt-${lang}`).style.width = `${optBarWidth}%`;
                
                document.getElementById(`time-user-${lang}`).innerText = formatDuration(userBenchData.mean_ns);
                document.getElementById(`time-opt-${lang}`).innerText = formatDuration(optBenchData.mean_ns);
                
                renderJitDensityChart(lang, userBenchData.raw_durations_ns, optBenchData.raw_durations_ns);
            }
        } else {
            document.getElementById(`comparison-${lang}`).style.display = 'none';
        }
    } catch (e) {
        console.warn("Comparison benchmark failed: ", e);
    }
}

// Render local scans checklists
function renderOptimizations(lang, data) {
    const list = document.getElementById(`list-${lang}`);
    const badge = document.getElementById(`opt-badge-${lang}`);
    
    list.innerHTML = "";
    const count = data.optimizations.length + data.clippy_lints.length;
    
    if (count === 0) {
        badge.style.display = 'none';
        
        const rating = document.getElementById(`score-val-${lang}`);
        rating.innerText = "A+";
        
        document.getElementById(`desc-${lang}`).innerText = "Awesome! 100/100 code efficiency. Zero bottlenecks detected.";
        
        list.innerHTML = `<div class="suggestion-placeholder" style="color: var(--neo-green); font-weight: bold;">🌱 Ideal execution! Your lines perfectly borrow and allocate structures contiguous on the heap.</div>`;
        document.getElementById(`diff-widget-${lang}`).style.display = 'none';
        return;
    }
    
    badge.innerText = count;
    badge.style.display = 'inline-block';
    
    const rating = document.getElementById(`score-val-${lang}`);
    const summaryText = document.getElementById(`desc-${lang}`);
    
    if (count > 4) {
        rating.innerText = "F";
        summaryText.innerText = "Critical scoping or vector growth copying identified. Review allocations to avoid reallocations.";
    } else if (count > 2) {
        rating.innerText = "C";
        summaryText.innerText = "Moderate inefficiencies. Adjusting variables and lookups will yield clean speedups.";
    } else {
        rating.innerText = "B";
        summaryText.innerText = "Minor issues. Borrowing reference parameters instead of allocations will peak compiler scores.";
    }

    // Custom scan warnings
    data.optimizations.forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = "opt-item-alert";
        
        const impactClass = opt.impact.toLowerCase() === 'high' ? 'tag-high' : 'tag-medium';
        const lineText = opt.lines.length > 0 ? `Lines: ${opt.lines.join(', ')}` : '';
        
        item.innerHTML = `
            <div class="alert-header" onclick="toggleAlertBody('${lang}', ${idx})">
                <div class="alert-title-group">
                    <span class="impact-tag ${impactClass}">${opt.impact}</span>
                    <span class="alert-title">${opt.rule_name}</span>
                </div>
                <span class="alert-lines">${lineText}</span>
            </div>
            <div class="alert-body" id="alert-body-${lang}-${idx}" style="display:none;">
                <p class="alert-explanation">${opt.description}</p>
                <div class="alert-speedup-row">
                    <span>💡 Speedup Boost: ${opt.speedup_estimate}</span>
                </div>
            </div>
        `;
        list.appendChild(item);
    });

    // Clippy lints (Rust only)
    if (lang === 'rust') {
        data.clippy_lints.forEach((lint, idx) => {
            const item = document.createElement('div');
            item.className = "opt-item-alert";
            
            const alertId = `clippy-${idx}`;
            const levelClass = lint.level === 'error' ? 'tag-high' : 'tag-medium';
            
            item.innerHTML = `
                <div class="alert-header" onclick="toggleAlertBody('rust', '${alertId}')">
                    <div class="alert-title-group">
                        <span class="impact-tag ${levelClass}">${lint.level}</span>
                        <span class="alert-title">Clippy Suggestion</span>
                    </div>
                    <span class="alert-lines">Line: ${lint.line}</span>
                </div>
                <div class="alert-body" id="alert-body-rust-${alertId}" style="display:none;">
                    <p class="alert-explanation" style="font-family: var(--font-mono); background: #f5f5f5; padding: 6px; border: 2px solid #000;">${lint.message}</p>
                </div>
            `;
            list.appendChild(item);
        });
    }

    if (data.suggested_optimized_code && data.suggested_optimized_code !== (lang === 'rust' ? rustEditor.getValue() : jsEditor.getValue())) {
        if (lang === 'rust') {
            currentOptimizedRustCode = data.suggested_optimized_code;
            document.getElementById('diff-orig-rust').innerText = rustEditor.getValue();
            document.getElementById('diff-opt-rust').innerText = data.suggested_optimized_code;
        } else {
            currentOptimizedJsCode = data.suggested_optimized_code;
            document.getElementById('diff-orig-js').innerText = jsEditor.getValue();
            document.getElementById('diff-opt-js').innerText = data.suggested_optimized_code;
        }
        document.getElementById(`diff-widget-${lang}`).style.display = 'block';
    } else {
        document.getElementById(`diff-widget-${lang}`).style.display = 'none';
        if (lang === 'rust') currentOptimizedRustCode = "";
        else currentOptimizedJsCode = "";
    }
}

window.toggleAlertBody = function (lang, id) {
    const body = document.getElementById(`alert-body-${lang}-${id}`);
    body.style.display = (body.style.display === "none" || body.style.display === "") ? "flex" : "none";
};

function updateComplexityStats(lang, complexity) {
    document.getElementById(`loc-${lang}`).innerText = complexity.lines_of_code;
    document.getElementById(`allocs-${lang}`).innerText = complexity.estimated_allocations;
    document.getElementById(`complexity-${lang}`).innerText = complexity.complexity_score;
}
