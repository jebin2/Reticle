import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
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

// ── prepareEnvironment ────────────────────────────────────────────────────────
// Ensures the bundled Python runtime + ultralytics venv are ready.
// Returns VENV_PYTHON so the caller can spawn Python directly.

export async function prepareEnvironment(logPath: string, runId: string): Promise<string> {
	const log = (text: string) =>
		appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});

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
		await log("[setup] Extracting bundled Python runtime…");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], "tar extract");
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
): Promise<{ detections: Detection[]; inferenceMs: number; error: string | null }> {
	try {
		await prepareEnvironment(logPath, runId);
	} catch (err) {
		return { detections: [], inferenceMs: 0, error: `Environment setup failed: ${(err as Error).message}` };
	}

	const t0   = Date.now();
	const proc = Bun.spawn([VENV_PYTHON, inferScript], {
		stdin: "pipe", stdout: "pipe", stderr: "pipe",
	});
	proc.stdin.write(JSON.stringify({ imagePath, modelPath, confidence }));
	proc.stdin.end();

	const decoder = new TextDecoder();
	let stdout = ""; let stderr = "";
	await Promise.all([
		(async () => { for await (const c of proc.stdout) stdout += decoder.decode(c); })(),
		(async () => { for await (const c of proc.stderr) stderr += decoder.decode(c); })(),
	]);
	await proc.exited;

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
