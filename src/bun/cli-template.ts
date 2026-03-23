#!/usr/bin/env bun
/**
 * YOLOStudio Standalone CLI
 *
 * Mirrors runInference from index.ts — same prepareEnvironment flow,
 * same infer.py protocol. Single-file Bun executable.
 *
 * Usage:
 *   ./detect photo.jpg
 *   ./detect photo.jpg --conf 0.7
 *   ./detect photo.jpg --conf 0.5 --output results/
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { appendFileSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir, tmpdir } from "os";
import { createHash } from "crypto";

// ── Embedded at bun build --compile time ──────────────────────────────────────
const modelFile  = Bun.file(new URL("./model.pt",  import.meta.url));
const inferPyFile = Bun.file(new URL("./infer.py", import.meta.url));

// ── Paths — identical to index.ts ─────────────────────────────────────────────
const IS_WIN          = process.platform === "win32";
const YOLO_DIR        = join(homedir(), ".yolostudio");
const RUNTIME_DIR     = join(YOLO_DIR, "python-runtime");
const VENV_DIR        = join(YOLO_DIR, "venv");
const RUNTIME_PYTHON  = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
const VENV_PYTHON     = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
const VENV_READY      = join(VENV_DIR, ".ready");
const SETUP_LOG       = join(YOLO_DIR, "cli-setup.log");

// ── Logging (mirrors appendFile pattern in index.ts) ──────────────────────────
function log(text: string) {
  console.log(text);
  try { appendFileSync(SETUP_LOG, text + "\n"); } catch {}
}

// ── prepareEnvironment — same logic as index.ts ───────────────────────────────
async function prepareEnvironment() {
  async function run(cmd: string[], label: string) {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const dec = new TextDecoder();
    await Promise.all([
      (async () => { for await (const c of proc.stdout) process.stdout.write(dec.decode(c)); })(),
      (async () => { for await (const c of proc.stderr) process.stderr.write(dec.decode(c)); })(),
    ]);
    const code = await proc.exited;
    if (code !== 0) throw new Error(`${label} failed (exit ${code})`);
  }

  if (!existsSync(RUNTIME_PYTHON)) {
    log("[setup] Extracting bundled Python runtime…");
    mkdirSync(RUNTIME_DIR, { recursive: true });
    // No bundled tarball in standalone CLI — fall back to system python3
    log("[setup] No bundled runtime found; using system python3.");
  }

  if (!existsSync(VENV_READY)) {
    const python3 = existsSync(RUNTIME_PYTHON) ? RUNTIME_PYTHON
      : (IS_WIN ? "python" : "python3");
    log("[setup] Creating virtual environment at ~/.yolostudio/venv…");
    await run([python3, "-m", "venv", "--clear", VENV_DIR], "venv create");
    log("[setup] Installing ultralytics (first run only — may take a few minutes)…");
    await run([VENV_PYTHON, "-m", "pip", "install", "ultralytics"], "pip install");
    writeFileSync(VENV_READY, "ready");
    log("[setup] Environment ready.");
  }
}

// ── runInference — same spawn + JSON protocol as index.ts ────────────────────
async function runInference(imagePath: string, modelPath: string, confidence: number) {
  const inferPyPath = join(tmpdir(), "yolostudio_infer.py");
  writeFileSync(inferPyPath, await inferPyFile.text());

  const t0   = Date.now();
  const proc = Bun.spawn([VENV_PYTHON, inferPyPath], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify({ imagePath, modelPath, confidence }));
  proc.stdin.end();

  const dec = new TextDecoder();
  let stdout = ""; let stderr = "";
  await Promise.all([
    (async () => { for await (const c of proc.stdout) stdout += dec.decode(c); })(),
    (async () => { for await (const c of proc.stderr) stderr += dec.decode(c); })(),
  ]);
  await proc.exited;
  const inferenceMs = Date.now() - t0;

  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    const data = JSON.parse(line);
    if (data.error) throw new Error(data.error);
    return { detections: data.detections ?? [], inferenceMs };
  } catch {
    if (stderr.trim()) console.error("[infer stderr]", stderr.trim().split("\n").pop());
    throw new Error(`Failed to parse inference output`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`Usage: ./${basename(Bun.argv[1])} <image.jpg> [options]`);
    console.log("\nOptions:");
    console.log("  --conf    Confidence threshold 0–1  (default: 0.5)");
    process.exit(0);
  }

  const imagePath = resolve(args[0]);
  let confidence = 0.5;
  for (let i = 1; i < args.length; i++)
    if ((args[i] === "--conf" || args[i] === "-c") && args[i + 1])
      confidence = parseFloat(args[++i]);

  if (!existsSync(imagePath)) {
    console.error(`Error: image not found: ${imagePath}`);
    process.exit(1);
  }

  await prepareEnvironment();

  // Extract embedded model to ~/.yolostudio/models/ (cached by content hash)
  const modelBytes = await modelFile.bytes();
  const modelHash  = createHash("sha1").update(modelBytes.slice(0, 4096)).digest("hex").slice(0, 8);
  const modelsDir  = join(YOLO_DIR, "models");
  mkdirSync(modelsDir, { recursive: true });
  const modelPath  = join(modelsDir, `model_${modelHash}.pt`);
  if (!existsSync(modelPath)) {
    process.stdout.write("Extracting model... ");
    writeFileSync(modelPath, modelBytes);
    console.log("done");
  }

  console.log(`Detecting: ${basename(imagePath)}  (conf ≥ ${confidence})`);
  const { detections, inferenceMs } = await runInference(imagePath, modelPath, confidence);

  console.log(`\n✓ ${detections.length} object(s) detected in ${inferenceMs}ms\n`);
  for (const d of detections)
    console.log(`  ${d.label.padEnd(20)} ${(d.confidence * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
