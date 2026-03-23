/**
 * YOLOStudio Standalone CLI
 * Compiled via: bun build --compile cli.ts --outfile <name>-detect
 *
 * Usage:
 *   ./detect photo.jpg
 *   ./detect photo.jpg --conf 0.7
 */

import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { YOLO_DIR, runInference } from "./util";

// Embedded at compile time by bun build --compile
const modelFile  = Bun.file(new URL("./model.pt",  import.meta.url));
const inferPyFile = Bun.file(new URL("./infer.py", import.meta.url));

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(`Usage: ./${basename(Bun.argv[1])} <image.jpg> [--conf 0.5]`);
	console.log("\nOptions:");
	console.log("  --conf    Confidence threshold 0–1  (default: 0.5)");
	process.exit(0);
}

const imagePath = args[0];
let confidence  = 0.5;
for (let i = 1; i < args.length; i++)
	if ((args[i] === "--conf" || args[i] === "-c") && args[i + 1])
		confidence = parseFloat(args[++i]);

if (!existsSync(imagePath)) {
	console.error(`Error: image not found: ${imagePath}`);
	process.exit(1);
}

// ── Extract embedded model → ~/.yolostudio/models/ (cached by content hash) ──

const modelBytes = await modelFile.bytes();
const modelHash  = createHash("sha1").update(modelBytes.slice(0, 4096)).digest("hex").slice(0, 8);
const modelsDir  = join(YOLO_DIR, "models");
await mkdir(modelsDir, { recursive: true });
const modelPath  = join(modelsDir, `model_${modelHash}.pt`);
if (!existsSync(modelPath)) {
	process.stdout.write("Extracting model... ");
	await writeFile(modelPath, modelBytes);
	console.log("done");
}

// ── Extract embedded infer.py → temp ─────────────────────────────────────────

const inferPyPath = join(tmpdir(), "yolostudio_infer.py");
await writeFile(inferPyPath, await inferPyFile.text());

// ── Run inference (same util function as the desktop app) ─────────────────────

const logPath = join(YOLO_DIR, "cli-setup.log");
const { detections, inferenceMs, error } = await runInference(
	imagePath, modelPath, confidence, inferPyPath, logPath, "cli",
);

if (error) {
	console.error("Error:", error);
	process.exit(1);
}

console.log(`\n✓  ${detections.length} object(s) detected in ${inferenceMs}ms\n`);
for (const d of detections)
	console.log(`   ${d.label.padEnd(20)} ${(d.confidence * 100).toFixed(1)}%`);
