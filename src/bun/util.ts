import { spawn, type ChildProcess } from "child_process";
import { access, appendFile, copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";

// ── Resource paths ────────────────────────────────────────────────────────────
// Resolved lazily so the module can be imported in non-Electron environments
// (e.g. vitest) without crashing.

function resolveResourceDirs(): { pythonDir: string; bunDir: string } {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { app } = require("electron") as typeof import("electron");
		const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "src");
		return { pythonDir: join(base, "python"), bunDir: join(base, "bun") };
	} catch {
		const base = join(process.cwd(), "src");
		return { pythonDir: join(base, "python"), bunDir: join(base, "bun") };
	}
}

const { pythonDir: PYTHON_DIR, bunDir: BUN_DIR } = resolveResourceDirs();

// ── Constants ─────────────────────────────────────────────────────────────────

export const IS_WIN            = process.platform === "win32";
export const YOLO_DIR          = join(homedir(), ".nab");
export const RUNTIME_DIR       = join(YOLO_DIR, "python-runtime");
export const VENV_DIR          = join(YOLO_DIR, "venv");
export const RUNTIME_PYTHON    = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
export const VENV_PYTHON       = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
export const VENV_READY_MARKER = join(VENV_DIR, ".ready");
export const CLI_ENTRY         = join(BUN_DIR, "cli.ts");
export const UTIL_ENTRY        = join(BUN_DIR, "util.ts");
export const TRAIN_SCRIPT      = join(PYTHON_DIR, "train.py");
export const INFER_SCRIPT      = join(PYTHON_DIR, "infer.py");
export const LOGGER_SCRIPT     = join(PYTHON_DIR, "logger.py");
export const EXPORT_SCRIPT     = join(PYTHON_DIR, "export.py");
export const YOLO_UTILS_SCRIPT = join(PYTHON_DIR, "yolo_utils.py");
export const PUSH_SCRIPT       = join(PYTHON_DIR, "push_to_hub.py");
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

// ── Process registry ──────────────────────────────────────────────────────────

export const runningProcesses = new Map<string, ChildProcess>();

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

export async function fileExists(p: string): Promise<boolean> {
	try { await access(p); return true; } catch { return false; }
}

export function coalescePipProgress(log: LineHandler): LineHandler {
	let lastTotal = 0;
	let lastBucket = -1;

	return async (line: string) => {
		const match = line.match(/^Progress\s+(\d+)\s+of\s+(\d+)/i);
		if (!match) { await log(line); return; }

		const done  = Number(match[1]);
		const total = Number(match[2]);
		if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return;

		if (total !== lastTotal) { lastTotal = total; lastBucket = -1; }

		const pct    = Math.min(100, Math.floor((done / total) * 100));
		const bucket = pct === 100 ? 100 : Math.floor(pct / 5) * 5;
		if (bucket <= lastBucket && pct !== 100) return;
		lastBucket = bucket;

		const doneMB  = (done  / (1024 * 1024)).toFixed(1);
		const totalMB = (total / (1024 * 1024)).toFixed(1);
		await log(`Download progress ${pct}% (${doneMB}/${totalMB} MB)`);
	};
}

// ── Stream helpers (Node.js Readable streams) ─────────────────────────────────

function streamPipe(
	readable: NodeJS.ReadableStream | null | undefined,
	onLine?: LineHandler,
	collect = false,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!readable) { resolve(""); return; }
		let text = "";
		let buf  = "";

		readable.on("data", (chunk: Buffer | string) => {
			const decoded = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
			if (collect) text += decoded;
			if (!onLine) return;
			buf += decoded;
			const lines = buf.split(/\r\n|\n|\r/);
			buf = lines.pop() ?? "";
			for (const line of lines) {
				const clean = cleanLine(line);
				if (clean) onLine(clean).catch(() => {});
			}
		});

		readable.on("end", () => {
			if (onLine && buf) {
				const clean = cleanLine(buf);
				if (clean) {
					onLine(clean).catch(() => {}).finally(() => resolve(text));
					return;
				}
			}
			resolve(text);
		});

		readable.on("error", reject);
	});
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
	const [executable, ...args] = cmd;
	const proc = spawn(executable, args, {
		stdio: ["pipe", "pipe", "pipe"],
		env:   env ? { ...process.env, ...env } : process.env as Record<string, string>,
	});

	if (runId) runningProcesses.set(runId, proc);

	proc.stdin?.write(stdinData ?? "", "utf-8");
	proc.stdin?.end();

	try {
		const exitCodePromise = new Promise<number>(resolve =>
			proc.on("close", code => resolve(code ?? 0))
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			streamPipe(proc.stdout, stdoutHandler, collectStdout),
			streamPipe(proc.stderr, stderrHandler, collectStderr),
			exitCodePromise,
		]);
		return { stdout, stderr, exitCode };
	} finally {
		if (runId) runningProcesses.delete(runId);
	}
}

export async function streamProcessOutput(
	proc: ChildProcess,
	handlers: { stdoutHandler?: LineHandler; stderrHandler?: LineHandler },
): Promise<void> {
	await Promise.all([
		streamPipe(proc.stdout, handlers.stdoutHandler, false),
		streamPipe(proc.stderr, handlers.stderrHandler, false),
	]);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function checkpointPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "last.pt");
}

export function modelPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "best.pt");
}

// ── downloadPythonRuntime ─────────────────────────────────────────────────────

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

	if (!(await fileExists(RUNTIME_PYTHON))) {
		if (!(await fileExists(RUNTIME_TARBALL)))
			await downloadPythonRuntime(RUNTIME_TARBALL, log);
		await log("[setup] Extracting Python runtime...");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], "tar extract");
		await log("[setup] Python runtime ready.");
	}

	const venvOk = (await fileExists(VENV_READY_MARKER)) &&
		await new Promise<boolean>(resolve => {
			try {
				const p = spawn(VENV_PYTHON, ["-c", "import sys; sys.exit(0)"], { stdio: "ignore" });
				p.on("close", code => resolve(code === 0));
				p.on("error", () => resolve(false));
			} catch { resolve(false); }
		});

	if (!venvOk) {
		if (await fileExists(VENV_READY_MARKER)) {
			await log("[setup] Virtual environment is broken — recreating...");
			await rm(VENV_DIR, { recursive: true, force: true }).catch(() => {});
			await unlink(VENV_READY_MARKER).catch(() => {});
		}
		await log("[setup] Creating virtual environment at ~/.nab/venv...");
		await run([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], "venv create");
		await log("[setup] Virtual environment created.");
		await log("[setup] Installing ultralytics (first run only - may take a few minutes)...");
		await runPip(["ultralytics", "psutil"], "pip install ultralytics psutil");
		await writeFile(VENV_READY_MARKER, "ready");
		await log("[setup] Environment ready.");
	} else {
		const psutilOk = await new Promise<boolean>(resolve => {
			try {
				const p = spawn(VENV_PYTHON, ["-c", "import psutil"], { stdio: "ignore" });
				p.on("close", code => resolve(code === 0));
				p.on("error", () => resolve(false));
			} catch { resolve(false); }
		});
		if (!psutilOk) {
			await log("[setup] Installing psutil...");
			await runPip(["psutil"], "pip install psutil");
		}
	}

	return VENV_PYTHON;
}

// ── buildCLIArtifact ──────────────────────────────────────────────────────────

export async function buildCLIArtifact(modelPath: string, outBinary: string, runId: string): Promise<string | null> {
	const buildDir = await mkdtemp(join(tmpdir(), "nab-cli-"));
	let stderr = "";

	try {
		await copyFile(CLI_ENTRY,         join(buildDir, "cli.ts"));
		await copyFile(UTIL_ENTRY,        join(buildDir, "util.ts"));
		await copyFile(modelPath,         join(buildDir, "model.pt"));
		await copyFile(INFER_SCRIPT,      join(buildDir, "infer.py"));
		await copyFile(LOGGER_SCRIPT,     join(buildDir, "logger.py"));
		await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

		const buildArgs = ["build", "--compile", "--minify", join(buildDir, "cli.ts"), "--outfile", outBinary];
		const proc = spawn("bun", buildArgs, { stdio: ["ignore", "pipe", "pipe"] });
		runningProcesses.set(runId, proc);
		try {
			await streamProcessOutput(proc, {
				stderrHandler: async line => { stderr += line + "\n"; },
			});
			const exitCode = await new Promise<number>(resolve => proc.on("close", code => resolve(code ?? 0)));
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
