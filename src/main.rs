use axum::{
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let current_dir = std::env::current_dir().unwrap();
    let temp_runs_dir = current_dir.join("temp_runs");
    let temp_cargo_dir = current_dir.join("temp_cargo");

    fs::create_dir_all(&temp_runs_dir).ok();
    fs::create_dir_all(&temp_cargo_dir).ok();

    initialize_temp_cargo(&temp_cargo_dir);

    // Dynamic port configuration for standard cloud deployment (Render, Koyeb, Fly)
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()
        .unwrap_or(3000);

    let app = Router::new()
        .route("/api/run", post(handle_run))
        .route("/api/benchmark", post(handle_benchmark))
        .route("/api/analyze", post(handle_analyze))
        .fallback_service(ServeDir::new(current_dir.join("frontend")))
        .layer(CorsLayer::permissive());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("RustBin server listening on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

fn initialize_temp_cargo(dir: &PathBuf) {
    if !dir.join("Cargo.toml").exists() {
        Command::new("cargo")
            .arg("init")
            .arg("--bin")
            .arg(dir)
            .output()
            .ok();

        let cargo_toml = r#"[package]
name = "temp_cargo"
version = "0.1.0"
edition = "2021"

[dependencies]
"#;
        fs::write(dir.join("Cargo.toml"), cargo_toml).ok();
    }
}

// --- Types ---

#[derive(Deserialize)]
struct RunRequest {
    code: String,
    language: String, // "rust" or "javascript"
}

#[derive(Serialize)]
struct RunResponse {
    success: bool,
    stdout: String,
    stderr: String,
    execution_time_ms: f64,
}

#[derive(Deserialize)]
struct BenchmarkRequest {
    code: String,
    language: String, // "rust" or "javascript"
    iterations: Option<usize>,
}

#[derive(Serialize)]
struct BenchmarkResponse {
    success: bool,
    stderr: String,
    mean_ns: f64,
    median_ns: f64,
    std_dev_ns: f64,
    margin_of_error_ns: f64,
    ops_per_sec: f64,
    min_ns: f64,
    max_ns: f64,
    raw_durations_ns: Vec<f64>,
}

#[derive(Deserialize)]
struct AnalyzeRequest {
    code: String,
    language: String, // "rust" or "javascript"
}

#[derive(Serialize)]
struct ClippyLint {
    message: String,
    line: usize,
    column: usize,
    level: String,
}

#[derive(Serialize, Clone)]
struct OptimizationReport {
    rule_name: String,
    description: String,
    impact: String, // "High", "Medium", "Low"
    lines: Vec<usize>,
    original_snippet: String,
    optimized_snippet: String,
    speedup_estimate: String,
}

#[derive(Serialize)]
struct AnalyzeResponse {
    success: bool,
    clippy_lints: Vec<ClippyLint>,
    optimizations: Vec<OptimizationReport>,
    code_complexity: CodeComplexity,
    suggested_optimized_code: String,
}

#[derive(Serialize)]
struct CodeComplexity {
    lines_of_code: usize,
    estimated_allocations: usize,
    complexity_score: String, // "Simple", "Moderate", "High"
}

// --- Endpoints ---

async fn handle_run(Json(payload): Json<RunRequest>) -> Json<RunResponse> {
    if payload.language.to_lowercase() == "javascript" || payload.language.to_lowercase() == "js" {
        let result = run_javascript(&payload.code).await;
        Json(result)
    } else {
        let result = compile_and_run(&payload.code, false).await;
        Json(result)
    }
}

async fn handle_benchmark(Json(payload): Json<BenchmarkRequest>) -> Json<BenchmarkResponse> {
    let iterations = payload.iterations.unwrap_or(200);
    let result = if payload.language.to_lowercase() == "javascript" || payload.language.to_lowercase() == "js" {
        run_benchmark_js(&payload.code, iterations).await
    } else {
        run_benchmark_rust(&payload.code, iterations).await
    };
    Json(result)
}

async fn handle_analyze(Json(payload): Json<AnalyzeRequest>) -> Json<AnalyzeResponse> {
    if payload.language.to_lowercase() == "javascript" || payload.language.to_lowercase() == "js" {
        let optimizations = scan_js_optimizations(&payload.code);
        let complexity = analyze_js_complexity(&payload.code);
        let suggested_optimized_code = generate_optimized_js_code(&payload.code, &optimizations);
        Json(AnalyzeResponse {
            success: true,
            clippy_lints: vec![],
            optimizations,
            code_complexity: complexity,
            suggested_optimized_code,
        })
    } else {
        let clippy_lints = run_clippy(&payload.code).await;
        let optimizations = scan_rust_optimizations(&payload.code);
        let complexity = analyze_rust_complexity(&payload.code);
        let suggested_optimized_code = generate_optimized_rust_code(&payload.code, &optimizations);
        Json(AnalyzeResponse {
            success: true,
            clippy_lints,
            optimizations,
            code_complexity: complexity,
            suggested_optimized_code,
        })
    }
}

// --- Compilation and Subprocess Runners ---

async fn compile_and_run(code: &str, release: bool) -> RunResponse {
    let thread_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::current_dir().unwrap().join("temp_runs");
    let rs_path = temp_dir.join(format!("run_{}.rs", thread_id));
    let bin_path = temp_dir.join(format!("run_{}", thread_id));

    let _ = fs::create_dir_all(&temp_dir);

    if let Err(e) = fs::write(&rs_path, code) {
        return RunResponse {
            success: false,
            stdout: "".to_string(),
            stderr: format!("Failed to write source file: {}", e),
            execution_time_ms: 0.0,
        };
    }

    let _start_compile = Instant::now();
    let mut cmd = Command::new("rustc");
    cmd.arg(&rs_path).arg("-o").arg(&bin_path);
    if release {
        cmd.arg("-O");
    }

    let compile_output = match cmd.output() {
        Ok(out) => out,
        Err(e) => {
            let _ = fs::remove_file(&rs_path);
            return RunResponse {
                success: false,
                stdout: "".to_string(),
                stderr: format!("Failed to execute rustc compiler: {}. Make sure local compilers are configured.", e),
                execution_time_ms: 0.0,
            };
        }
    };

    if !compile_output.status.success() {
        let _ = fs::remove_file(&rs_path);
        return RunResponse {
            success: false,
            stdout: "".to_string(),
            stderr: String::from_utf8_lossy(&compile_output.stderr).to_string(),
            execution_time_ms: 0.0,
        };
    }

    let start_execute = Instant::now();
    let run_cmd = Command::new(&bin_path).output();
    let duration = start_execute.elapsed();

    let _ = fs::remove_file(&rs_path);
    let _ = fs::remove_file(&bin_path);

    match run_cmd {
        Ok(out) => RunResponse {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            execution_time_ms: duration.as_secs_f64() * 1000.0,
        },
        Err(e) => RunResponse {
            success: false,
            stdout: "".to_string(),
            stderr: format!("Execution failed: {}", e),
            execution_time_ms: 0.0,
        },
    }
}

async fn run_javascript(code: &str) -> RunResponse {
    let thread_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::current_dir().unwrap().join("temp_runs");
    let js_path = temp_dir.join(format!("run_{}.js", thread_id));

    let _ = fs::create_dir_all(&temp_dir);

    if let Err(e) = fs::write(&js_path, code) {
        return RunResponse {
            success: false,
            stdout: "".to_string(),
            stderr: format!("Failed to write JavaScript execution file: {}", e),
            execution_time_ms: 0.0,
        };
    }

    let start_execute = Instant::now();
    let run_cmd = Command::new("node").arg(&js_path).output();
    let duration = start_execute.elapsed();

    let _ = fs::remove_file(&js_path);

    match run_cmd {
        Ok(out) => RunResponse {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            execution_time_ms: duration.as_secs_f64() * 1000.0,
        },
        Err(e) => RunResponse {
            success: false,
            stdout: "".to_string(),
            stderr: format!("Execution failed: {}. Ensure Node.js is installed locally on your system path.", e),
            execution_time_ms: 0.0,
        },
    }
}

// --- High-Precision Benchmarking Engines ---

async fn run_benchmark_rust(code: &str, iterations: usize) -> BenchmarkResponse {
    let mut benced_code = code.to_string();

    if !benced_code.contains("fn main") {
        return BenchmarkResponse {
            success: false,
            stderr: "Error: Code must contain a `fn main()` to benchmark.".to_string(),
            ..blank_bench()
        };
    }

    benced_code = benced_code.replace("fn main()", "fn main_user()");
    benced_code = benced_code.replace("fn main ( )", "fn main_user()");
    benced_code = benced_code.replace("fn main() ->", "fn main_user() ->");

    let harness = format!(
        r#"
// Benchmarking harness appended by RustBin
fn main() {{
    for _ in 0..15 {{
        let _ = std::hint::black_box(main_user());
    }}

    let mut durations = Vec::with_capacity({iterations});
    
    for _ in 0..{iterations} {{
        let start = std::time::Instant::now();
        let _ = std::hint::black_box(main_user());
        let duration = start.elapsed().as_nanos() as f64;
        durations.push(duration);
    }}

    println!("__BENCHMARK_START__");
    println!("{{ \"durations\": {{:?}} }}", durations);
    println!("__BENCHMARK_END__");
}}
"#,
        iterations = iterations
    );

    benced_code.push_str(&harness);

    let thread_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::current_dir().unwrap().join("temp_runs");
    let rs_path = temp_dir.join(format!("bench_{}.rs", thread_id));
    let bin_path = temp_dir.join(format!("bench_{}", thread_id));

    let _ = fs::create_dir_all(&temp_dir);

    if let Err(e) = fs::write(&rs_path, &benced_code) {
        return BenchmarkResponse {
            success: false,
            stderr: format!("Failed to write bench file: {}", e),
            ..blank_bench()
        };
    }

    let compile_output = Command::new("rustc")
        .arg(&rs_path)
        .arg("-o")
        .arg(&bin_path)
        .arg("-O")
        .output();

    let compile_output = match compile_output {
        Ok(out) => out,
        Err(e) => {
            let _ = fs::remove_file(&rs_path);
            return BenchmarkResponse {
                success: false,
                stderr: format!("Failed to run rustc: {}. Compiles are restricted in this environment.", e),
                ..blank_bench()
            };
        }
    };

    if !compile_output.status.success() {
        let _ = fs::remove_file(&rs_path);
        return BenchmarkResponse {
            success: false,
            stderr: String::from_utf8_lossy(&compile_output.stderr).to_string(),
            ..blank_bench()
        };
    }

    let run_output = Command::new(&bin_path).output();

    let _ = fs::remove_file(&rs_path);
    let _ = fs::remove_file(&bin_path);

    let run_output = match run_output {
        Ok(out) => out,
        Err(e) => {
            return BenchmarkResponse {
                success: false,
                stderr: format!("Failed to execute bench target: {}", e),
                ..blank_bench()
            };
        }
    };

    process_bench_output(&String::from_utf8_lossy(&run_output.stdout), &String::from_utf8_lossy(&run_output.stderr), run_output.status.success())
}

async fn run_benchmark_js(code: &str, iterations: usize) -> BenchmarkResponse {
    let wrapped_code = format!(
        r#"
// High-precision V8 JIT Benchmarking Harness
function main_user() {{
{}
}}

// V8 JIT Warm-up pre-heating
for (let i = 0; i < 20; i++) {{
    try {{ main_user(); }} catch(e) {{}}
}}

const durations = [];
for (let i = 0; i < {}; i++) {{
    const start = performance.now();
    try {{ main_user(); }} catch(e) {{}}
    const end = performance.now();
    durations.push((end - start) * 1000000.0); // Convert millisecond float to nanoseconds
}}

console.log("__BENCHMARK_START__");
console.log(JSON.stringify({{ durations: durations }}));
console.log("__BENCHMARK_END__");
"#,
        code, iterations
    );

    let thread_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::current_dir().unwrap().join("temp_runs");
    let js_path = temp_dir.join(format!("bench_{}.js", thread_id));

    let _ = fs::create_dir_all(&temp_dir);

    if let Err(e) = fs::write(&js_path, &wrapped_code) {
        return BenchmarkResponse {
            success: false,
            stderr: format!("Failed to write JS bench file: {}", e),
            ..blank_bench()
        };
    }

    let run_output = Command::new("node").arg(&js_path).output();

    let _ = fs::remove_file(&js_path);

    let run_output = match run_output {
        Ok(out) => out,
        Err(e) => {
            return BenchmarkResponse {
                success: false,
                stderr: format!("Failed to execute Node.js bench target: {}", e),
                ..blank_bench()
            };
        }
    };

    process_bench_output(&String::from_utf8_lossy(&run_output.stdout), &String::from_utf8_lossy(&run_output.stderr), run_output.status.success())
}

fn process_bench_output(stdout: &str, stderr: &str, status_success: bool) -> BenchmarkResponse {
    if !status_success {
        return BenchmarkResponse {
            success: false,
            stderr: format!("Execution failed:\n{}", stderr),
            ..blank_bench()
        };
    }

    let start_tag = "__BENCHMARK_START__";
    let end_tag = "__BENCHMARK_END__";

    let start_idx = match stdout.find(start_tag) {
        Some(idx) => idx + start_tag.len(),
        None => {
            return BenchmarkResponse {
                success: false,
                stderr: format!("Harness parse error. Stdout was:\n{}", stdout),
                ..blank_bench()
            };
        }
    };

    let end_idx = match stdout.find(end_tag) {
        Some(idx) => idx,
        None => {
            return BenchmarkResponse {
                success: false,
                stderr: "Harness parse error: no end marker.".to_string(),
                ..blank_bench()
            };
        }
    };

    let json_segment = &stdout[start_idx..end_idx].trim();

    #[derive(Deserialize)]
    struct DurationsWrapper {
        durations: Vec<f64>,
    }

    let parsed: DurationsWrapper = match serde_json::from_str(json_segment) {
        Ok(p) => p,
        Err(e) => {
            return BenchmarkResponse {
                success: false,
                stderr: format!("Failed to parse JSON durations: {}. Data: {}", e, json_segment),
                ..blank_bench()
            };
        }
    };

    let mut durations = parsed.durations;
    if durations.is_empty() {
        return BenchmarkResponse {
            success: false,
            stderr: "No durations measured.".to_string(),
            ..blank_bench()
        };
    }

    durations.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let count = durations.len() as f64;
    let min_ns = durations[0];
    let max_ns = durations[durations.len() - 1];

    let mean_ns = durations.iter().sum::<f64>() / count;

    let median_ns = if durations.len() % 2 == 0 {
        let mid = durations.len() / 2;
        (durations[mid - 1] + durations[mid]) / 2.0
    } else {
        durations[durations.len() / 2]
    };

    let variance = durations
        .iter()
        .map(|&x| {
            let diff = x - mean_ns;
            diff * diff
        })
        .sum::<f64>()
        / (count - 1.0);
    let std_dev_ns = variance.sqrt();

    let standard_error = std_dev_ns / count.sqrt();
    let margin_of_error_ns = 1.96 * standard_error;

    let ops_per_sec = 1_000_000_000.0 / mean_ns;

    BenchmarkResponse {
        success: true,
        stderr: "".to_string(),
        mean_ns,
        median_ns,
        std_dev_ns,
        margin_of_error_ns,
        ops_per_sec,
        min_ns,
        max_ns,
        raw_durations_ns: durations,
    }
}

fn blank_bench() -> BenchmarkResponse {
    BenchmarkResponse {
        success: false,
        stderr: "".to_string(),
        mean_ns: 0.0,
        median_ns: 0.0,
        std_dev_ns: 0.0,
        margin_of_error_ns: 0.0,
        ops_per_sec: 0.0,
        min_ns: 0.0,
        max_ns: 0.0,
        raw_durations_ns: vec![],
    }
}

// --- Local Clippy Runner ---

async fn run_clippy(code: &str) -> Vec<ClippyLint> {
    let temp_cargo = std::env::current_dir().unwrap().join("temp_cargo");
    let src_main = temp_cargo.join("src/main.rs");

    if let Err(_) = fs::write(&src_main, code) {
        return vec![];
    }

    let output = Command::new("cargo")
        .arg("clippy")
        .arg("--message-format=json")
        .current_dir(temp_cargo)
        .output();

    let output = match output {
        Ok(out) => out,
        Err(_) => return vec![],
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut lints = Vec::new();

    for line in stdout_str.lines() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if value["reason"] == "compiler-message" {
                if let Some(msg) = value["message"].as_object() {
                    let level = msg["level"].as_str().unwrap_or("warning").to_string();
                    let message = msg["message"].as_str().unwrap_or("").to_string();

                    let mut line_num = 1;
                    let mut col_num = 1;

                    if let Some(spans) = msg["spans"].as_array() {
                        if !spans.is_empty() {
                            line_num = spans[0]["line_start"].as_u64().unwrap_or(1) as usize;
                            col_num = spans[0]["column_start"].as_u64().unwrap_or(1) as usize;
                        }
                    }

                    if level == "warning" || level == "error" {
                        lints.push(ClippyLint {
                            message,
                            line: line_num,
                            column: col_num,
                            level,
                        });
                    }
                }
            }
        }
    }

    lints
}

// --- Custom Local Optimization Scanners ---

fn scan_rust_optimizations(code: &str) -> Vec<OptimizationReport> {
    let mut reports = Vec::new();
    let lines: Vec<&str> = code.lines().collect();

    let clone_re = regex::Regex::new(r"(\w+)\.clone\(\)").unwrap();
    for (i, line) in lines.iter().enumerate() {
        if let Some(caps) = clone_re.captures(line) {
            let var_name = &caps[1];
            if !line.contains("std::") && !line.contains("//") {
                reports.push(OptimizationReport {
                    rule_name: "Redundant Heap Allocation (.clone())".to_string(),
                    description: format!(
                        "Calling `.clone()` on `{}` duplicates memory allocations on the heap. In Rust, it is often faster and safer to pass a reference (`&{}`) or leverage borrowing instead of copying the entire structure.",
                        var_name, var_name
                    ),
                    impact: "Medium".to_string(),
                    lines: vec![i + 1],
                    original_snippet: line.trim().to_string(),
                    optimized_snippet: line.replace(&format!("{}.clone()", var_name), &format!("&{}", var_name)).trim().to_string(),
                    speedup_estimate: "1.2x - 3.5x faster (eliminates heap allocation/copying)".to_string(),
                });
            }
        }
    }

    let mut in_loop = false;
    let mut vec_decl_line = None;
    let mut vec_name = String::new();
    let vec_decl_re = regex::Regex::new(r"let\s+mut\s+(\w+)\s*=\s*Vec::new\(\)").unwrap();

    for (i, line) in lines.iter().enumerate() {
        let line_trimmed = line.trim();
        if vec_decl_re.is_match(line_trimmed) {
            if let Some(caps) = vec_decl_re.captures(line_trimmed) {
                vec_name = caps[1].to_string();
                vec_decl_line = Some(i + 1);
            }
        }

        if line_trimmed.starts_with("for ") || line_trimmed.starts_with("while ") || line_trimmed.contains(".iter()") {
            in_loop = true;
        }

        if in_loop && !vec_name.is_empty() && line_trimmed.contains(&format!("{}.push", vec_name)) {
            if let Some(decl_idx) = vec_decl_line {
                reports.push(OptimizationReport {
                    rule_name: "Vector Capacity Pre-allocation".to_string(),
                    description: format!(
                        "Growing the vector `{}` inside a loop forces Rust to repeatedly reallocate dynamic memory on the heap and copy old elements as capacity thresholds are crossed ($O(N)$ reallocations). Pre-allocating capacity using `Vec::with_capacity(size)` allows a single contiguous memory block to be reserved ($O(1)$ allocations).",
                        vec_name
                    ),
                    impact: "High".to_string(),
                    lines: vec![decl_idx, i + 1],
                    original_snippet: format!("let mut {} = Vec::new(); // inside loop: {}.push(...)", vec_name, vec_name),
                    optimized_snippet: format!("let mut {} = Vec::with_capacity(estimated_size); // pre-allocated contiguous heap space", vec_name),
                    speedup_estimate: "2.0x - 8.0x faster (zero-copy memory growth)".to_string(),
                });
                vec_name = String::new();
                vec_decl_line = None;
            }
        }
    }

    let string_add_re = regex::Regex::new(r"(\w+)\s*\+=\s*").unwrap();
    let mut string_decl_line = None;
    let mut string_name = String::new();
    let string_decl_re = regex::Regex::new(r"let\s+mut\s+(\w+)\s*=\s*(String::new\(\)|String::from|.*\.to_string\(\))").unwrap();

    for (i, line) in lines.iter().enumerate() {
        let line_trimmed = line.trim();
        if string_decl_re.is_match(line_trimmed) {
            if let Some(caps) = string_decl_re.captures(line_trimmed) {
                string_name = caps[1].to_string();
                string_decl_line = Some(i + 1);
            }
        }

        if in_loop && !string_name.is_empty() && (line_trimmed.contains(&format!("{}.push_str", string_name)) || string_add_re.is_match(line_trimmed)) {
            if let Some(decl_idx) = string_decl_line {
                reports.push(OptimizationReport {
                    rule_name: "Inefficient String Expansion".to_string(),
                    description: format!(
                        "Concatenating strings or calling `.push_str()` iteratively on `{}` inside a loop triggers frequent heap reallocation. Pre-allocating string capacity or utilizing the `format!` macro / `std::fmt::Write` reduces allocations and provides memory cache advantages.",
                        string_name
                    ),
                    impact: "High".to_string(),
                    lines: vec![decl_idx, i + 1],
                    original_snippet: format!("let mut {} = String::new(); // looping += or .push_str()", string_name),
                    optimized_snippet: format!("let mut {} = String::with_capacity(estimated_len); // contiguous pre-allocation", string_name),
                    speedup_estimate: "3.0x - 12.0x faster (removes iterative heap copy steps)".to_string(),
                });
                string_name = String::new();
                string_decl_line = None;
            }
        }
    }

    reports
}

fn scan_js_optimizations(code: &str) -> Vec<OptimizationReport> {
    let mut reports = Vec::new();
    let lines: Vec<&str> = code.lines().collect();

    // Rule 1: Scoping issue (var)
    let var_re = regex::Regex::new(r"\bvar\s+(\w+)\b").unwrap();
    for (i, line) in lines.iter().enumerate() {
        if let Some(caps) = var_re.captures(line) {
            let var_name = &caps[1];
            if !line.contains("//") {
                reports.push(OptimizationReport {
                    rule_name: "Inefficient Block Scoping (`var`)".to_string(),
                    description: format!(
                        "Declaring `{}` using `var` makes the variable function-scoped, allowing scope leaks and hoisting bugs. Modern V8 JIT compilers optimize block-scoped `let` and `const` declarations significantly better because the scope lifetimes are strictly defined.",
                        var_name
                    ),
                    impact: "Medium".to_string(),
                    lines: vec![i + 1],
                    original_snippet: line.trim().to_string(),
                    optimized_snippet: line.replace(&format!("var {}", var_name), &format!("const {}", var_name)).trim().to_string(),
                    speedup_estimate: "1.1x - 1.5x faster (improves JIT scope lifetime parsing)".to_string(),
                });
            }
        }
    }

    // Rule 2: Slow Array iteration (for...in)
    for (i, line) in lines.iter().enumerate() {
        let line_trimmed = line.trim();
        if line_trimmed.contains("for") && line_trimmed.contains(" in ") && (line_trimmed.contains("let") || line_trimmed.contains("var")) {
            reports.push(OptimizationReport {
                rule_name: "Slow Object Property Iterator (`for...in`)".to_string(),
                description: "Iterating array elements using `for...in` checks all enumerable prototype properties, adding significant overhead in V8. Standard indexed loops or `for...of` loops bypass prototype trees, running up to 10x faster under TurboFan compilation.".to_string(),
                impact: "High".to_string(),
                lines: vec![i + 1],
                original_snippet: line_trimmed.to_string(),
                optimized_snippet: "for (const item of array)".to_string(),
                speedup_estimate: "4.0x - 10.0x faster (bypasses enumerable prototype chains)".to_string(),
            });
        }
    }

    // Rule 3: Quadratic Array search instead of Set
    let include_re = regex::Regex::new(r"(\w+)\.includes\((\w+)\)").unwrap();
    for (i, line) in lines.iter().enumerate() {
        if let Some(caps) = include_re.captures(line) {
            let arr_name = &caps[1];
            let search_val = &caps[2];
            if !line.contains("//") {
                reports.push(OptimizationReport {
                    rule_name: "Quadratic Array Search ($O(N^2)$ checks)".to_string(),
                    description: format!(
                        "Scanning `{}` linearly inside a loop triggers a $O(N)$ lookup on every run, leading to quadratic time complexity. Converting the array to a `Set` and calling `set.has({})` achieves instantaneous $O(1)$ lookups.",
                        arr_name, search_val
                    ),
                    impact: "High".to_string(),
                    lines: vec![i + 1],
                    original_snippet: line.trim().to_string(),
                    optimized_snippet: format!("const set = new Set({}); // ... set.has({})", arr_name, search_val),
                    speedup_estimate: "50x - 1000x faster (for large datasets; pivots O(N) -> O(1))".to_string(),
                });
            }
        }
    }

    reports
}

// --- Complexity Analysis ---

fn analyze_rust_complexity(code: &str) -> CodeComplexity {
    let lines_count = code.lines().count();
    let mut alloc_estimate = 0;

    for line in code.lines() {
        let line_trimmed = line.trim();
        if line_trimmed.contains(".clone()")
            || line_trimmed.contains("to_string()")
            || line_trimmed.contains("to_owned()")
            || line_trimmed.contains("String::from")
            || line_trimmed.contains("Vec::new()")
        {
            alloc_estimate += 1;
        }
    }

    let complexity = if lines_count < 30 && alloc_estimate < 3 { "Simple" } else if lines_count < 100 && alloc_estimate < 10 { "Moderate" } else { "High" };

    CodeComplexity {
        lines_of_code: lines_count,
        estimated_allocations: alloc_estimate,
        complexity_score: complexity.to_string(),
    }
}

fn analyze_js_complexity(code: &str) -> CodeComplexity {
    let lines_count = code.lines().count();
    let mut alloc_estimate = 0;

    for line in code.lines() {
        let line_trimmed = line.trim();
        if line_trimmed.contains("new Set(")
            || line_trimmed.contains("new Map(")
            || line_trimmed.contains("new Array")
            || line_trimmed.contains(".split(")
            || line_trimmed.contains("JSON.stringify")
        {
            alloc_estimate += 1;
        }
    }

    let complexity = if lines_count < 30 && alloc_estimate < 2 { "Simple" } else if lines_count < 100 && alloc_estimate < 6 { "Moderate" } else { "High" };

    CodeComplexity {
        lines_of_code: lines_count,
        estimated_allocations: alloc_estimate,
        complexity_score: complexity.to_string(),
    }
}

// --- Dynamic Code Generation ---

fn generate_optimized_rust_code(original_code: &str, optimizations: &[OptimizationReport]) -> String {
    let mut optimized = original_code.to_string();
    for opt in optimizations {
        if opt.rule_name == "Redundant Heap Allocation (.clone())" {
            if optimized.contains(&opt.original_snippet) {
                optimized = optimized.replace(&opt.original_snippet, &opt.optimized_snippet);
            }
        }
    }
    optimized
}

fn generate_optimized_js_code(original_code: &str, optimizations: &[OptimizationReport]) -> String {
    let mut optimized = original_code.to_string();
    for opt in optimizations {
        if opt.rule_name == "Inefficient Block Scoping (`var`)" {
            if optimized.contains(&opt.original_snippet) {
                optimized = optimized.replace(&opt.original_snippet, &opt.optimized_snippet);
            }
        }
    }
    optimized
}
