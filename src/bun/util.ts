import { appendFile, copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";

// ── Constants ─────────────────────────────────────────────────────────────────

export const IS_WIN            = process.platform === "win32";
export const YOLO_DIR          = join(homedir(), ".nab");
export const RUNTIME_DIR       = join(YOLO_DIR, "python-runtime");
export const VENV_DIR          = join(YOLO_DIR, "venv");
export const RUNTIME_PYTHON    = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
export const VENV_PYTHON       = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
export const VENV_READY_MARKER = join(VENV_DIR, ".ready");
export const CLI_ENTRY         = join(import.meta.dir, "cli.ts");
export const UTIL_ENTRY        = join(import.meta.dir, "util.ts");
export const TRAIN_SCRIPT      = join(import.meta.dir, "../python/train.py");
export const INFER_SCRIPT      = join(import.meta.dir, "../python/infer.py");
export const LOGGER_SCRIPT     = join(import.meta.dir, "../python/logger.py");
export const EXPORT_SCRIPT     = join(import.meta.dir, "../python/export.py");
export const YOLO_UTILS_SCRIPT = join(import.meta.dir, "../python/yolo_utils.py");
export const PUSH_SCRIPT       = join(import.meta.dir, "../python/push_to_hub.py");
export const HUB_LOGS_DIR      = join(YOLO_DIR, "hub-logs");
export const MODELS_DIR        = join(YOLO_DIR, "models");
export const RUNTIME_TARBALL   = join(YOLO_DIR, "python-runtime.tar.gz");

// ── Types ─────────────────────────────────────────────────────────────────────

export type Detection = {
	classIndex: number; label: string; confidence: number;
	cx: number; cy: number; w: number; h: number;
};

type LineHandler = (line: string) => Promise<void>;
type RunProcessOptions = {
	stdinData?: string;
	stdoutHandler?: LineHandler;
	stderrHandler?: LineHandler;
	collectStdout?: boolean;
	collectStderr?: boolean;
	env?: Record<string, string | undefined>;
	runId?: string;
};

// ── Process registry (for stopTraining) ──────────────────────────────────────

export const runningProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function parseLastJsonLine(stdout: string): Record<string, unknown> | null {
	const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
	try { return JSON.parse(line); } catch { return null; }
}

// Strip ANSI/CSI escape sequences and collapse \r-overwritten lines.
export function cleanLine(raw: string): string {
	const segments = raw.split("\r");
	return segments[segments.length - 1].replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

export function coalescePipProgress(log: LineHandler): LineHandler {
	let lastTotal = 0;
	let lastBucket = -1;

	return async (line: string) => {
		const match = line.match(/^Progress\s+(\d+)\s+of\s+(\d+)/i);
		if (!match) {
			await log(line);
			return;
		}

		const done = Number(match[1]);
		const total = Number(match[2]);
		if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return;

		if (total !== lastTotal) {
			lastTotal = total;
			lastBucket = -1;
		}

		const pct = Math.min(100, Math.floor((done / total) * 100));
		const bucket = pct === 100 ? 100 : Math.floor(pct / 5) * 5;
		if (bucket <= lastBucket && pct !== 100) return;
		lastBucket = bucket;

		const doneMB = (done / (1024 * 1024)).toFixed(1);
		const totalMB = (total / (1024 * 1024)).toFixed(1);
		await log(`Download progress ${pct}% (${doneMB}/${totalMB} MB)`);
	};
}

async function streamPipe(
	pipe: ReturnType<typeof Bun.spawn>["stdout"] | ReturnType<typeof Bun.spawn>["stderr"],
	onLine?: LineHandler,
	collect = false,
): Promise<string> {
	if (!pipe || typeof pipe === "number" || !("getReader" in pipe)) return "";
	const decoder = new TextDecoder();
	let text = "";
	let buf = "";
	const reader = pipe.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		const chunk = value;
		const decoded = decoder.decode(chunk, { stream: true });
		if (collect) text += decoded;
		if (!onLine) continue;
		buf += decoded;
		const lines = buf.split(/\r\n|\n|\r/);
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const clean = cleanLine(line);
			if (clean) await onLine(clean);
		}
	}
	const tail = decoder.decode();
	if (collect) text += tail;
	if (onLine) {
		if (tail) buf += tail;
		const clean = cleanLine(buf);
		if (clean) await onLine(clean);
	}
	return text;
}

export async function runProcess(
	cmd: string[],
	{
		stdinData,
		stdoutHandler,
		stderrHandler,
		collectStdout = true,
		collectStderr = true,
		env,
		runId,
	}: RunProcessOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(cmd, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
	});
	if (runId) runningProcesses.set(runId, proc);
	if (stdinData !== undefined && proc.stdin !== null) {
		proc.stdin.write(stdinData);
	}
	proc.stdin?.end();
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			streamPipe(proc.stdout, stdoutHandler, collectStdout),
			streamPipe(proc.stderr, stderrHandler, collectStderr),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	} finally {
		if (runId) runningProcesses.delete(runId);
	}
}

export async function streamProcessOutput(
	proc: ReturnType<typeof Bun.spawn>,
	handlers: {
		stdoutHandler?: LineHandler;
		stderrHandler?: LineHandler;
	},
): Promise<void> {
	await Promise.all([
		streamPipe(proc.stdout, handlers.stdoutHandler, false),
		streamPipe(proc.stderr, handlers.stderrHandler, false),
	]);
}

// Canonical paths to YOLO weight files for a given output directory.
// The nested "weights/weights" structure is what Ultralytics writes by default
// when project=outputPath and name="weights".
export function checkpointPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "last.pt");
}

export function modelPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "best.pt");
}

// ── downloadPythonRuntime ─────────────────────────────────────────────────────
// Downloads python-build-standalone for the current OS/arch into the local
// Nab cache under ~/.nab.

const PYTHON_PLATFORM_MAP: Record<string, string> = {
	"linux-x64":    "x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
	"linux-arm64":  "aarch64-unknown-linux-gnu-install_only_stripped.tar.gz",
	"darwin-x64":   "x86_64-apple-darwin-install_only_stripped.tar.gz",
	"darwin-arm64": "aarch64-apple-darwin-install_only_stripped.tar.gz",
	"win32-x64":    "x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
};

export async function downloadPythonRuntime(
	destPath: string,
	log: (text: string) => Promise<void>,
): Promise<void> {
	const platformKey = `${process.platform}-${process.arch}`;
	const suffix = PYTHON_PLATFORM_MAP[platformKey];
	if (!suffix) throw new Error(`Unsupported platform for Python download: ${platformKey}`);

	await log(`[setup] Fetching Python runtime info for ${platformKey}...`);
	const apiRes = await fetch(
		"https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest",
		{ headers: { "User-Agent": "Nab" } },
	);
	if (!apiRes.ok) throw new Error(`GitHub API error: ${apiRes.status}`);

	const release = await apiRes.json() as {
		assets: Array<{ name: string; browser_download_url: string }>;
	};
	const asset = release.assets.find(a => a.name.startsWith("cpython-3.12") && a.name.endsWith(suffix));
	if (!asset) throw new Error(`No Python 3.12 asset found for ${platformKey}`);

	await log(`[setup] Downloading Python runtime: ${asset.name}...`);
	const dlRes = await fetch(asset.browser_download_url);
	if (!dlRes.ok || !dlRes.body) throw new Error(`Download failed: ${dlRes.status}`);

	await mkdir(YOLO_DIR, { recursive: true });
	const chunks: Uint8Array[] = [];
	const reader = dlRes.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const c of chunks) { buf.set(c, offset); offset += c.length; }
	await writeFile(destPath, buf);
	await log("[setup] Python runtime downloaded.");
}

// ── PTY wrapper ───────────────────────────────────────────────────────────────
// Runs a command inside a pseudo-terminal so tools like pip can stream progress.
// Output still goes through runProcess/cleanLine before reaching the UI.

export async function runWithPTY(
	cmd: string[],
	options: RunProcessOptions = {},
): Promise<{ exitCode: number }> {
	if (process.platform !== "linux" && process.platform !== "darwin") {
		const { exitCode } = await runProcess(cmd, options);
		return { exitCode };
	}

	let ptyCmd: string[];
	if (process.platform === "linux") {
		const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
		ptyCmd = ["script", "-q", "-e", "-c", cmd.map(shellQuote).join(" "), "/dev/null"];
	} else {
		ptyCmd = ["script", "-q", "/dev/null", ...cmd];
	}

	const { exitCode } = await runProcess(ptyCmd, options);
	return { exitCode };
}

// ── prepareEnvironment ────────────────────────────────────────────────────────
// Ensures the cached Python runtime + ultralytics venv are ready.
// Returns VENV_PYTHON so the caller can spawn Python directly.

export async function prepareEnvironment(
	logPath: string,
	runId: string,
	stderrHandler?: LineHandler,
): Promise<string> {
	const log = async (text: string) => {
		await appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});
		await stderrHandler?.(text);
	};

	const runOpts = {
		stdoutHandler: log,
		stderrHandler: log,
		collectStdout: false,
		collectStderr: false,
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
		runId,
	};

	async function run(cmd: string[], label: string): Promise<void> {
		const { exitCode } = await runProcess(cmd, runOpts);
		if (exitCode !== 0) {
			await log(`[setup] error: ${label} failed (exit ${exitCode})`);
			throw new Error(`${label} failed with exit code ${exitCode}`);
		}
	}

	// Keep pip progress textual so the UI shows download movement without
	// rich/PTY cursor controls corrupting the log view.
	async function runPip(packages: string[], label: string): Promise<void> {
		const pipLog = coalescePipProgress(log);
		const cmd = [VENV_PYTHON, "-m", "pip", "install", "--progress-bar", "raw", ...packages];
		const { exitCode } = await runWithPTY(cmd, {
			...runOpts,
			stdoutHandler: pipLog,
			stderrHandler: pipLog,
		});
		if (exitCode !== 0) {
			await log(`[setup] error: ${label} failed (exit ${exitCode})`);
			throw new Error(`${label} failed with exit code ${exitCode}`);
		}
	}

	if (!(await Bun.file(RUNTIME_PYTHON).exists())) {
		if (!(await Bun.file(RUNTIME_TARBALL).exists()))
			await downloadPythonRuntime(RUNTIME_TARBALL, log);
		await log("[setup] Extracting Python runtime...");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], "tar extract");
		await log("[setup] Python runtime ready.");
	}

	// Verify the venv is healthy (e.g. symlinks may point to an old path after a
	// project rename). If the Python binary can't be executed, wipe and recreate.
	const venvOk = await Bun.file(VENV_READY_MARKER).exists() &&
		await new Promise<boolean>(resolve => {
			try {
				const p = Bun.spawn([VENV_PYTHON, "-c", "import sys; sys.exit(0)"], {
					stdout: "ignore", stderr: "ignore",
				});
				p.exited.then(code => resolve(code === 0)).catch(() => resolve(false));
			} catch { resolve(false); }
		});

	if (!venvOk) {
		if (await Bun.file(VENV_READY_MARKER).exists()) {
			await log("[setup] Virtual environment is broken — recreating...");
			await rm(VENV_DIR, { recursive: true, force: true }).catch(() => {});
			await unlink(VENV_READY_MARKER).catch(() => {});
		}
		await log("[setup] Creating virtual environment at ~/.nab/venv...");
		await run([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], "venv create");
		await log("[setup] Virtual environment created.");
		await log("[setup] Installing ultralytics (first run only - may take a few minutes)...");
		await runPip(["ultralytics", "psutil"], "pip install ultralytics psutil");
		await Bun.write(VENV_READY_MARKER, "ready");
		await log("[setup] Environment ready.");
	}

	return VENV_PYTHON;
}

// ── buildCLIArtifact ──────────────────────────────────────────────────────────
// Compiles a self-contained CLI binary (bun build --compile) that bundles the
// model weights and inference scripts. Returns null on success, error string on failure.

export async function buildCLIArtifact(modelPath: string, outBinary: string, runId: string): Promise<string | null> {
	const buildDir = await mkdtemp(join(tmpdir(), "nab-cli-"));
	let stderr = "";

	try {
		await copyFile(CLI_ENTRY,        join(buildDir, "cli.ts"));
		await copyFile(UTIL_ENTRY,       join(buildDir, "util.ts"));
		await copyFile(modelPath,        join(buildDir, "model.pt"));
		await copyFile(INFER_SCRIPT,     join(buildDir, "infer.py"));
		await copyFile(LOGGER_SCRIPT,    join(buildDir, "logger.py"));
		await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

		const proc = Bun.spawn(
			["bun", "build", "--compile", "--minify", join(buildDir, "cli.ts"), "--outfile", outBinary],
			{ stdout: "pipe", stderr: "pipe" },
		);
		runningProcesses.set(runId, proc);
		try {
			await streamProcessOutput(proc, {
				stderrHandler: async line => { stderr += line + "\n"; },
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) return stderr.trim() || "Unknown build failure";
			return null;
		} finally {
			runningProcesses.delete(runId);
		}
	} finally {
		await rm(buildDir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── runInference ──────────────────────────────────────────────────────────────
// Calls prepareEnvironment then spawns inferScript with the standard JSON
// stdin → JSON stdout protocol. Used by both the desktop RPC handler and CLI.

export async function runInference(
	imagePath:   string,
	modelPath:   string,
	confidence:  number,
	inferScript: string,
	logPath:     string,
	runId:       string,
	stderrHandler?: LineHandler,
): Promise<{ detections: Detection[]; inferenceMs: number; error: string | null }> {
	try {
		await prepareEnvironment(logPath, runId, stderrHandler);
	} catch (err) {
		return { detections: [], inferenceMs: 0, error: `Environment setup failed: ${(err as Error).message}` };
	}

	const logStderr = async (text: string) => {
		await appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});
		await stderrHandler?.(text);
	};

	const t0 = Date.now();
	const { stdout, stderr } = await runProcess(
		[VENV_PYTHON, inferScript],
		{
			stdinData: JSON.stringify({ imagePath, modelPath, confidence }),
			stderrHandler: logStderr,
		},
	);

	const inferenceMs = Date.now() - t0;
	const data = parseLastJsonLine(stdout);
	if (!data) {
		if (stderr.trim()) console.error("[infer] stderr:\n", stderr.trim());
		if (stdout.trim()) console.error("[infer] stdout:\n", stdout.trim());
		const hint = stderr.trim().split("\n").filter(l => l.trim()).pop() ?? "";
		return { detections: [], inferenceMs, error: `Inference failed.${hint ? ` ${hint}` : ""}` };
	}
	if (data.error) return { detections: [], inferenceMs, error: data.error as string };
	return { detections: (data.detections ?? []) as Detection[], inferenceMs, error: null };
}
