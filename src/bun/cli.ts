/**
 * YOLOStudio Standalone CLI
 * Compiled via: bun build --compile cli.ts --outfile <name>-detect
 *
 * Usage:
 *   ./detect photo.jpg
 *   ./detect photo.jpg --conf 0.7
 *   ./detect photo.jpg --log_path run.log --output_path results.json
 */

import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { YOLO_DIR, runInference } from "./util";

// Embedded at compile time by bun build --compile
// `with { type: "file" }` tells Bun to embed the file and gives back a path.
import modelPtPath from "./model.pt" with { type: "file" };
import inferPyPath from "./infer.py" with { type: "file" };
import yoloUtilsPyPath from "./yolo_utils.py" with { type: "file" };

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(`Usage: ./${basename(Bun.argv[1])} <image.jpg> [options]`);
	console.log("\nOptions:");
	console.log("  --conf         Confidence threshold 0–1  (default: 0.5)");
	console.log("  --log_path     Save setup log to file    (default: ~/.yolostudio/cli-setup.log)");
	console.log("  --output_path  Save detections as JSON   (default: none)");
	process.exit(0);
}

const imagePath = args[0];
let confidence = 0.5;
let logPath = join(YOLO_DIR, "cli-setup.log");
let outputPath = "";

for (let i = 1; i < args.length; i++) {
	if ((args[i] === "--conf") && args[i + 1]) confidence = parseFloat(args[++i]);
	if ((args[i] === "--log_path") && args[i + 1]) logPath = args[++i];
	if ((args[i] === "--output_path") && args[i + 1]) outputPath = args[++i];
}

if (!existsSync(imagePath)) {
	console.error(`Error: image not found: ${imagePath}`);
	process.exit(1);
}

// ── Extract embedded model → ~/.yolostudio/models/ (cached by content hash) ──

const modelBytes = await Bun.file(modelPtPath).bytes();
const modelHash = createHash("sha1").update(modelBytes.slice(0, 4096)).digest("hex").slice(0, 8);
const modelsDir = join(YOLO_DIR, "models");
await mkdir(modelsDir, { recursive: true });
const modelPath = join(modelsDir, `model_${modelHash}.pt`);
if (!existsSync(modelPath)) {
	process.stdout.write("Extracting model... ");
	await writeFile(modelPath, modelBytes);
	console.log("done");
}

// ── Extract embedded Python helpers → temp ───────────────────────────────────

const inferDir = join(tmpdir(), "yolostudio-infer");
await mkdir(inferDir, { recursive: true });
const inferPyTmpPath = join(inferDir, "infer.py");
await writeFile(inferPyTmpPath, await Bun.file(inferPyPath).text());
await writeFile(join(inferDir, "yolo_utils.py"), await Bun.file(yoloUtilsPyPath).text());

// ── Run inference (same util function as the desktop app) ─────────────────────

const { detections, inferenceMs, error } = await runInference(
	imagePath, modelPath, confidence, inferPyTmpPath, logPath, "cli", true,
);

if (error) {
	console.error("Error:", error);
	process.exit(1);
}

console.log(`\n✓  ${detections.length} object(s) detected in ${inferenceMs}ms\n`);
for (const d of detections)
	console.log(`   ${d.label.padEnd(20)} ${(d.confidence * 100).toFixed(1)}%`);

// ── Save JSON output if requested ─────────────────────────────────────────────

if (outputPath) {
	await writeFile(outputPath, JSON.stringify({ imagePath, inferenceMs, detections }, null, 2));
	console.log(`\nDetections saved → ${outputPath}`);
}
