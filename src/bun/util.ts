import { appendFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";

// ── Constants ─────────────────────────────────────────────────────────────────

import { homedir } from "os";

// ── Constants ─────────────────────────────────────────────────────────────────

export const IS_WIN            = process.platform === "win32";
export const YOLO_DIR          = join(homedir(), ".yolostudio");
export const RUNTIME_DIR       = join(YOLO_DIR, "python-runtime");
export const VENV_DIR          = join(YOLO_DIR, "venv");
export const RUNTIME_PYTHON    = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
export const VENV_PYTHON       = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
export const VENV_READY_MARKER = join(VENV_DIR, ".ready");
export const TRAIN_SCRIPT      = join(import.meta.dir, "../python/train.py");
export const INFER_SCRIPT      = join(import.meta.dir, "../python/infer.py");
export const EXPORT_SCRIPT     = join(import.meta.dir, "../python/export.py");
export const YOLO_UTILS_SCRIPT = join(import.meta.dir, "../python/yolo_utils.py");
export const RUNTIME_TARBALL   = join(import.meta.dir, "../python/python-runtime.tar.gz");

// ── Types ─────────────────────────────────────────────────────────────────────

export type Detection = {
	classIndex: number; label: string; confidence: number;
	cx: number; cy: number; w: number; h: number;
};

// ── Process registry (for stopTraining) ──────────────────────────────────────

export const runningProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip ANSI/CSI escape sequences and collapse \r-overwritten lines.
export function cleanLine(raw: string): string {
	const segments = raw.split("\r");
	return segments[segments.length - 1].replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

// Buffer a byte pipe, split on \n, clean each line, call onLine per entry.
export async function pipeLines(
	pipe: AsyncIterable<Uint8Array>,
	onLine: (line: string) => Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buf = "";
	for await (const chunk of pipe) {
		buf += decoder.decode(chunk, { stream: true });
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const clean = cleanLine(line);
			if (clean) await onLine(clean);
		}
	}
	const clean = cleanLine(buf);
	if (clean) await onLine(clean);
}

// Canonical path to the YOLO training checkpoint for a given output directory.
export function checkpointPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "last.pt");
}

// ── downloadPythonRuntime ─────────────────────────────────────────────────────
// Downloads python-build-standalone for the current OS/arch. Used when no
// bundled tarball is present.

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

	await log(`[setup] Fetching Python runtime info for ${platformKey}…`);
	const apiRes = await fetch(
		"https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest",
		{ headers: { "User-Agent": "YOLOStudio" } },
	);
	if (!apiRes.ok) throw new Error(`GitHub API error: ${apiRes.status}`);

	const release = await apiRes.json() as {
		assets: Array<{ name: string; browser_download_url: string }>;
	};
	const asset = release.assets.find(a => a.name.startsWith("cpython-3.12") && a.name.endsWith(suffix));
	if (!asset) throw new Error(`No Python 3.12 asset found for ${platformKey}`);

	await log(`[setup] Downloading Python runtime: ${asset.name}…`);
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

// ── prepareEnvironment ────────────────────────────────────────────────────────
// Ensures the bundled Python runtime + ultralytics venv are ready.
// Returns VENV_PYTHON so the caller can spawn Python directly.

export async function prepareEnvironment(logPath: string, runId: string): Promise<string> {
	return prepareEnvironmentWithOptions(logPath, runId, false);
}

export async function prepareEnvironmentWithOptions(
	logPath: string,
	runId: string,
	echoToStderr: boolean,
): Promise<string> {
	const log = async (text: string) => {
		await appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});
		if (echoToStderr) process.stderr.write(text + "\n");
	};

	async function run(cmd: string[], label: string): Promise<void> {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PYTHONUNBUFFERED: "1" },
		});
		runningProcesses.set(runId, proc);
		try {
			await Promise.all([
				pipeLines(proc.stdout, log).catch(() => {}),
				pipeLines(proc.stderr, log).catch(() => {}),
			]);
			const code = await proc.exited;
			if (code !== 0) {
				await log(`[setup] ✗ ${label} failed (exit ${code})`);
				throw new Error(`${label} failed with exit code ${code}`);
			}
		} finally {
			runningProcesses.delete(runId);
		}
	}

	if (!(await Bun.file(RUNTIME_PYTHON).exists())) {
		// Desktop app: use bundled tarball. Standalone CLI: download for current OS.
		let tarball = RUNTIME_TARBALL;
		if (!(await Bun.file(tarball).exists())) {
			tarball = join(YOLO_DIR, "python-runtime.tar.gz");
			await downloadPythonRuntime(tarball, log);
		}
		await log("[setup] Extracting Python runtime…");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", tarball, "-C", RUNTIME_DIR], "tar extract");
		await log("[setup] Python runtime ready.");
	}

	if (!(await Bun.file(VENV_READY_MARKER).exists())) {
		await log("[setup] Creating virtual environment at ~/.yolostudio/venv…");
		await run([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], "venv create");
		await log("[setup] Virtual environment created.");
		await log("[setup] Installing ultralytics (first run only — may take a few minutes)…");
		await run([VENV_PYTHON, "-m", "pip", "install", "ultralytics"], "pip install");
		await Bun.write(VENV_READY_MARKER, "ready");
		await log("[setup] Environment ready.");
	}

	return VENV_PYTHON;
}

// ── spawnCollect ──────────────────────────────────────────────────────────────
// Spawns a process, writes stdinData, collects stdout + stderr to strings.
// Used by runInference and exportModel to avoid duplicating the pattern.

export async function spawnCollect(
	cmd: string[],
	stdinData: string,
): Promise<{ stdout: string; stderr: string }> {
	const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	proc.stdin.write(stdinData);
	proc.stdin.end();
	const dec = new TextDecoder();
	let stdout = ""; let stderr = "";
	await Promise.all([
		(async () => { for await (const c of proc.stdout) stdout += dec.decode(c); })(),
		(async () => { for await (const c of proc.stderr) stderr += dec.decode(c); })(),
	]);
	await proc.exited;
	return { stdout, stderr };
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
	echoToStderr = false,
): Promise<{ detections: Detection[]; inferenceMs: number; error: string | null }> {
	try {
		await prepareEnvironmentWithOptions(logPath, runId, echoToStderr);
	} catch (err) {
		return { detections: [], inferenceMs: 0, error: `Environment setup failed: ${(err as Error).message}` };
	}

	const t0 = Date.now();
	const { stdout, stderr } = await spawnCollect(
		[VENV_PYTHON, inferScript],
		JSON.stringify({ imagePath, modelPath, confidence }),
	);

	const inferenceMs = Date.now() - t0;
	const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
	try {
		const data = JSON.parse(line);
		if (data.error) return { detections: [], inferenceMs, error: data.error };
		return { detections: data.detections ?? [], inferenceMs, error: null };
	} catch {
		if (stderr.trim()) console.error("[infer] stderr:\n", stderr.trim());
		if (stdout.trim()) console.error("[infer] stdout:\n", stdout.trim());
		const hint = stderr.trim().split("\n").filter(l => l.trim()).pop() ?? "";
		return { detections: [], inferenceMs, error: `Inference failed.${hint ? ` ${hint}` : ""}` };
	}
}
