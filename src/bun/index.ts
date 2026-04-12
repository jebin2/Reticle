import Electrobun, { BrowserWindow, defineElectrobunRPC, Screen } from "electrobun/bun";
import { readdir, mkdir, copyFile, cp, appendFile, unlink, rm, mkdtemp, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { randomBytes } from "crypto";
import { homedir, tmpdir } from "os";
import {
	YOLO_DIR, TRAIN_SCRIPT, INFER_SCRIPT, EXPORT_SCRIPT,
	YOLO_UTILS_SCRIPT, PUSH_SCRIPT, HUB_LOGS_DIR,
	VENV_PYTHON, runningProcesses,
	prepareEnvironment, runInference, runProcess, runWithPTY, streamProcessOutput, checkpointPath, modelPath as getModelPath,
	coalescePipProgress,
} from "./util";
import { parseSegmentationLine, isTruePolygon } from "./polygon";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"]);

/** Read a newline-delimited log file and return non-empty lines. */
async function readLogFile(logPath: string): Promise<string[]> {
	try {
		const content = await Bun.file(logPath).text();
		return content.split("\n").filter(l => l.trim());
	} catch { return []; }
}

/** Expand a leading ~ to the real home directory. */
const exp = (p: string) => p.replace(/^~/, homedir());

/**
 * Electrobun's openFileDialog splits its result on "," to support multi-select,
 * which breaks filenames that contain commas.  Reassemble by greedily joining
 * adjacent parts until we find a path that exists on disk.
 */
async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function fixCommaSplitPaths(parts: string[]): Promise<string[]> {
  const result: string[] = [];
  let candidate = "";
  for (const part of parts) {
    candidate = candidate ? `${candidate},${part}` : part;
    if (await pathExists(candidate)) {
      result.push(candidate);
      candidate = "";
    }
  }
  return result.length > 0 ? result : parts;
}

// Paths to CLI source files — copied into the compile temp dir by exportCLI.
const CLI_ENTRY  = join(import.meta.dir, "cli.ts");
const UTIL_ENTRY = join(import.meta.dir, "util.ts");

// ── Binary bridge ─────────────────────────────────────────────────────────────
// Serves image files to the renderer by path. Avoids base64 encoding entirely.

const securityToken = randomBytes(32).toString("hex");

const server = Bun.serve({
	port: 0,
	async fetch(req) {
		const headers = new Headers({ "Access-Control-Allow-Origin": "*" });
		const url     = new URL(req.url);
		if (url.searchParams.get("token") !== securityToken)
			return new Response("Unauthorized", { status: 401, headers });
		const filePath = url.searchParams.get("path");
		if (!filePath) return new Response("Missing path", { status: 400, headers });
		const file = Bun.file(filePath);
		if (!(await file.exists())) return new Response("Not found", { status: 404, headers });
		return new Response(file, { headers });
	},
});

// ── Dataset snapshot helpers ──────────────────────────────────────────────────

type SnapEntry = { img: string; lbl: string; mtime: number };

async function scanAnnotatedImages(assetPaths: string[]): Promise<SnapEntry[]> {
	const result: SnapEntry[] = [];
	for (const assetPath of assetPaths) {
		const imagesDir = join(exp(assetPath), "images");
		const labelsDir = join(exp(assetPath), "labels");
		let entries; try { entries = await readdir(imagesDir, { withFileTypes: true }); } catch { continue; }
		for (const entry of entries) {
			if (!entry.isFile() || !IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue;
			const lblPath = join(labelsDir, entry.name.slice(0, entry.name.lastIndexOf(".")) + ".txt");
			const lblFile = Bun.file(lblPath);
			if (!(await lblFile.exists())) continue;
			if (!(await lblFile.text()).trim()) continue;   // empty file = no boxes drawn
			const s = await stat(lblPath);
			result.push({ img: join(imagesDir, entry.name), lbl: lblPath, mtime: Math.floor(s.mtimeMs / 1000) });
		}
	}
	return result;
}

/**
 * Scan an asset's label files and return whether any annotation is a true
 * polygon (not just a bbox converted to an axis-aligned 4-corner rectangle).
 */
async function detectHasPolygons(storagePath: string): Promise<boolean> {
	const labelsDir = join(storagePath, "labels");
	let files: string[];
	try { files = await readdir(labelsDir); } catch { return false; }
	for (const f of files) {
		if (!f.endsWith(".txt")) continue;
		let text: string;
		try { text = await Bun.file(join(labelsDir, f)).text(); } catch { continue; }
		for (const line of text.trim().split("\n")) {
			const pts = parseSegmentationLine(line);
			if (pts && isTruePolygon(pts)) return true;
		}
	}
	return false;
}

/**
 * Refresh a snapshot for resume:
 * - Keep images whose label file still exists and is non-empty (update mtime).
 * - Drop images whose label was deleted or emptied.
 * - Add any newly annotated images from assetPaths not yet in the snapshot.
 *
 * This means resume always trains on the current state of annotations —
 * new and modified labels are included, deleted ones are removed.
 */
async function refreshSnapshot(images: SnapEntry[], assetPaths: string[]): Promise<SnapEntry[]> {
	const kept: SnapEntry[] = [];
	const inSnapshot = new Set<string>();

	for (const e of images) {
		inSnapshot.add(e.img);
		const lblFile = Bun.file(e.lbl);
		if (!(await lblFile.exists())) continue;
		if (!(await lblFile.text()).trim()) continue;   // annotation removed
		const s = await stat(e.lbl);
		kept.push({ img: e.img, lbl: e.lbl, mtime: Math.floor(s.mtimeMs / 1000) });
	}

	// Pick up images annotated since the run was created.
	const current = await scanAnnotatedImages(assetPaths);
	for (const e of current) {
		if (!inSnapshot.has(e.img)) kept.push(e);
	}

	return kept;
}

// ── Recursive image collector ─────────────────────────────────────────────────

async function collectImagePaths(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results = await Promise.all(entries.map(async entry => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) return collectImagePaths(fullPath);
		if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) return [fullPath];
		return [];
	}));
	return results.flat();
}

// ── RPC ───────────────────────────────────────────────────────────────────────

const rpc = defineElectrobunRPC("bun", {
	maxRequestTime: Infinity,
	handlers: {
		requests: {
			getBridgeConfig: async () => ({ port: server.port, token: securityToken }),

			openImagesDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder: homedir(), allowedFileTypes: "*.jpg,*.jpeg,*.png,*.webp,*.bmp,*.gif,*.tiff,*.tif",
					canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: true,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				if (canceled) return { canceled: true, paths: [] };
				const fixed = await fixCommaSplitPaths(filePaths);
				return { canceled: false, paths: fixed };
			},

			loadStudio: async () => {
				const studioFile = join(YOLO_DIR, "studio.json");
				try {
					const file = Bun.file(studioFile);
					if (await file.exists()) {
						const data = JSON.parse(await file.text());
						if (Array.isArray(data.runs)) {
							data.runs = data.runs.map((r: { status: string }) =>
								r.status === "training" || r.status === "installing"
									? { ...r, status: "paused" } : r
							);
						}
						// Recompute hasPolygons from disk on every load — label files are the
						// authoritative source. Only persist if something changed.
						if (Array.isArray(data.assets)) {
							let dirty = false;
							await Promise.all(data.assets.map(async (asset: { storagePath?: string; hasPolygons?: boolean }) => {
								if (!asset.storagePath) return;
								const detected = await detectHasPolygons(exp(asset.storagePath));
								if (detected !== asset.hasPolygons) {
									asset.hasPolygons = detected;
									dirty = true;
								}
							}));
							if (dirty) await Bun.write(studioFile, JSON.stringify(data, null, 2));
						}
						return data;
					}
				} catch (err) { console.error("Failed to parse studio.json:", err); }
				return { assets: [], runs: [] };
			},

			saveStudio: async ({ assets, runs }: { assets: unknown[]; runs: unknown[] }) => {
				await mkdir(YOLO_DIR, { recursive: true });
				await Bun.write(join(YOLO_DIR, "studio.json"), JSON.stringify({ assets, runs }, null, 2));
				return {};
			},

			openFolderDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder: homedir(), canChooseFiles: false,
					canChooseDirectory: true, allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				if (canceled) return { canceled: true, paths: [] };
				const [folderPath] = await fixCommaSplitPaths(filePaths);
				const paths = await collectImagePaths(folderPath);
				paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
				return { canceled: false, paths };
			},

			loadAssetData: async ({ storagePath }: { storagePath: string }) => {
				const imagesDir = join(exp(storagePath), "images");
				const labelsDir = join(exp(storagePath), "labels");
				await mkdir(imagesDir, { recursive: true });
				await mkdir(labelsDir, { recursive: true });
				const imageFiles = (await readdir(imagesDir)).filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
				const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number; points?: Array<{ x: number; y: number }> }>> = {};
				for (const filename of imageFiles) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					try {
						const text = await Bun.file(labelPath).text();
						labels[filename] = text.trim().split("\n").filter(Boolean).map(line => {
							const parts = line.split(" ").map(Number);
							const classIndex = parts[0];
							// YOLO segmentation: class x1 y1 x2 y2 ... (≥7 tokens, even count of coords)
							const segPts = parseSegmentationLine(line);
							if (segPts) {
								const xs = segPts.map(p => p.x);
								const ys = segPts.map(p => p.y);
								const minX = Math.min(...xs), maxX = Math.max(...xs);
								const minY = Math.min(...ys), maxY = Math.max(...ys);
								const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
								const w  = maxX - minX,       h  = maxY - minY;
								// If the polygon is exactly the 4-corner axis-aligned rectangle that
								// saveAnnotations generates for a plain bbox (TL TR BR BL), treat it
								// as a bbox — don't set points — so hasPolygons stays false.
								return isTruePolygon(segPts)
									? { classIndex, cx, cy, w, h, points: segPts }
									: { classIndex, cx, cy, w, h };
							}
							const [ci, cx, cy, w, h] = parts;
							return { classIndex: ci, cx, cy, w, h };
						});
					} catch { labels[filename] = []; }
				}
				let classes: string[] = [];
				try {
					const text = await Bun.file(join(exp(storagePath), "classes.txt")).text();
					classes = text.trim().split("\n").filter(Boolean);
				} catch {}
				return { images: imageFiles.map(f => ({ filename: f, filePath: join(imagesDir, f) })), labels, classes };
			},

			saveAnnotations: async ({ storagePath, labels, classes }: {
				storagePath: string;
				labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number; points?: Array<{ x: number; y: number }> }>>;
				classes: string[];
			}) => {
				const labelsDir = join(exp(storagePath), "labels");
				await mkdir(labelsDir, { recursive: true });
				for (const [filename, anns] of Object.entries(labels)) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					const content   = anns.map(a => {
						let pts = a.points;
						if (!pts || pts.length < 3) {
							// Convert bbox to 4-corner polygon (TL, TR, BR, BL)
							const l = a.cx - a.w / 2, r = a.cx + a.w / 2;
							const t = a.cy - a.h / 2, b = a.cy + a.h / 2;
							pts = [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
						}
						return `${a.classIndex} ${pts.map(p => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`).join(" ")}`;
					}).join("\n");
					await Bun.write(labelPath, content);
				}
				await Bun.write(join(exp(storagePath), "classes.txt"), classes.join("\n"));
				return {};
			},

			importImages: async ({ storagePath, files }: {
				storagePath: string;
				files: Array<{ filename: string; sourcePath?: string; dataUrl?: string }>;
			}) => {
				const imagesDir = join(exp(storagePath), "images");
				await mkdir(imagesDir, { recursive: true });
				const results: Array<{ filename: string; filePath: string }> = [];
				for (const file of files) {
					const dest = join(imagesDir, basename(file.filename));
					if (file.sourcePath && file.sourcePath !== dest) await copyFile(file.sourcePath, dest);
					else if (file.dataUrl) {
						const [, b64] = file.dataUrl.split(",");
						await Bun.write(dest, Buffer.from(b64, "base64"));
					}
					results.push({ filename: basename(file.filename), filePath: dest });
				}
				return { images: results };
			},

			openFolderPathDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder: homedir(), canChooseFiles: false,
					canChooseDirectory: true, allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				if (canceled) return { canceled: true, path: "" };
				const [folderPath] = await fixCommaSplitPaths(filePaths);
				return { canceled: false, path: folderPath };
			},

			startTraining: async (config: {
				id: string; name: string; assetPaths: string[]; classMap: string[];
				baseModel: string; epochs: number; batchSize: number; imgsz: number;
				device: string; outputPath: string; fresh: boolean;
			}) => {
				await mkdir(exp(config.outputPath), { recursive: true });
				if (config.fresh) {
					await unlink(checkpointPath(exp(config.outputPath))).catch(() => {});
					await unlink(join(exp(config.outputPath), "train.log")).catch(() => {});
				}
				const logPath  = join(exp(config.outputPath), "train.log");
				const metaPath = join(exp(config.outputPath), "run-meta.json");

				// Build or prune the locked image snapshot.
				let images: SnapEntry[];
				if (config.fresh) {
					images = await scanAnnotatedImages(config.assetPaths);
					await Bun.write(metaPath, JSON.stringify({ classMap: config.classMap, assetPaths: config.assetPaths, images }));
				} else {
					try {
						const meta        = JSON.parse(await Bun.file(metaPath).text());
						const assetPaths  = meta.assetPaths ?? config.assetPaths;
						images = await refreshSnapshot(meta.images ?? [], assetPaths);
						await Bun.write(metaPath, JSON.stringify({ classMap: meta.classMap ?? config.classMap, assetPaths, images }));
					} catch {
						// No meta yet (run predates this feature) — build fresh snapshot.
						images = await scanAnnotatedImages(config.assetPaths);
						await Bun.write(metaPath, JSON.stringify({ classMap: config.classMap, assetPaths: config.assetPaths, images }));
					}
				}

				await appendFile(logPath, JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }) + "\n");

				const venvPython = await prepareEnvironment(logPath, config.id);
				await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[setup] Starting training..." }) + "\n");

				const proc = Bun.spawn([venvPython, TRAIN_SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
				runningProcesses.set(config.id, proc);
				// Pass locked image list to Python instead of raw assetPaths.
				proc.stdin.write(JSON.stringify({ ...config, images }));
				proc.stdin.end();

				streamProcessOutput(proc, {
					stdoutHandler: line => appendFile(logPath, line + "\n").catch(console.error),
					stderrHandler: text =>
						appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(console.error),
				}).then(() => runningProcesses.delete(config.id)).catch(console.error);

				return { started: true };
			},

			readTrainingLog: async ({ outputPath }: { outputPath: string }) => {
				return { lines: await readLogFile(join(exp(outputPath), "train.log")) };
			},

			readRunMeta: async ({ outputPath }: { outputPath: string }) => {
				const EMPTY = { found: false, classMap: [] as string[], imageCount: 0, newCount: 0, modifiedCount: 0, hasPolygons: false };
				try {
					const meta = JSON.parse(await Bun.file(join(exp(outputPath), "run-meta.json")).text());
					const snap = new Map<string, number>(
						(meta.images ?? []).map((e: SnapEntry) => [e.img, e.mtime])
					);
					let newCount = 0, modifiedCount = 0;
					for (const assetPath of (meta.assetPaths ?? [])) {
						const imagesDir = join(exp(assetPath), "images");
						const labelsDir = join(exp(assetPath), "labels");
						let entries; try { entries = await readdir(imagesDir, { withFileTypes: true }); } catch { continue; }
						for (const entry of entries) {
							if (!entry.isFile() || !IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue;
							const lblPath = join(labelsDir, entry.name.slice(0, entry.name.lastIndexOf(".")) + ".txt");
							const _lf = Bun.file(lblPath);
							if (!(await _lf.exists())) continue;
							if (!(await _lf.text()).trim()) continue;   // empty = unannotated
							const imgPath = join(imagesDir, entry.name);
							if (!snap.has(imgPath)) { newCount++; continue; }
							const s = await stat(lblPath);
							if (Math.floor(s.mtimeMs / 1000) !== snap.get(imgPath)) modifiedCount++;
						}
					}
					// Check if current annotations have true polygons (user may have added them after pausing).
					const assetPaths: string[] = meta.assetPaths ?? [];
					const polyResults = await Promise.all(assetPaths.map(p => detectHasPolygons(exp(p))));
					const hasPolygons = polyResults.some(Boolean);
					return { found: true, classMap: meta.classMap ?? [], imageCount: snap.size, newCount, modifiedCount, hasPolygons };
				} catch { return EMPTY; }
			},

			checkWeights: async ({ outputPaths }: { outputPaths: string[] }) => {
				const results: Record<string, boolean> = {};
				await Promise.all(outputPaths.map(async p => {
					results[p] = await Bun.file(getModelPath(exp(p))).exists();
				}));
				return { results };
			},

			runInference: async ({ imagePath, outputPath, confidence }: {
				imagePath: string; outputPath: string; confidence: number;
			}) => {
				const weights = getModelPath(exp(outputPath));
				if (!(await Bun.file(weights).exists()))
					return { detections: [], inferenceMs: 0, error: "Model weights not found." };
				return runInference(
					exp(imagePath), weights, confidence,
					INFER_SCRIPT,
					join(YOLO_DIR, "infer-setup.log"),
					"inference",
				);
			},

			exportModel: async ({ outputPath, format }: { outputPath: string; format: string }) => {
				const modelPath = getModelPath(exp(outputPath));
				if (!(await Bun.file(modelPath).exists()))
					return { exportedPath: "", fileSize: 0, error: "Model weights not found." };
				if (format === "pt") {
					const size = (await Bun.file(modelPath).size) ?? 0;
					return { exportedPath: modelPath, fileSize: size, error: null };
				}
				const { stdout, stderr } = await runProcess([VENV_PYTHON, EXPORT_SCRIPT], {
					stdinData: JSON.stringify({ modelPath, format }),
					stderrHandler: async () => {},
				});
				const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
				try {
					const data = JSON.parse(line);
					if (data.error) return { exportedPath: "", fileSize: 0, error: data.error };
					const fileSize = (await Bun.file(data.exportedPath).size) ?? 0;
					return { exportedPath: data.exportedPath, fileSize, error: null };
				} catch {
					const hint = stderr.trim().split("\n").filter(Boolean).pop() ?? "";
					return { exportedPath: "", fileSize: 0, error: `Export failed.${hint ? ` ${hint}` : ""}` };
				}
			},

			buildAndDownloadCLI: async ({ outputPath, runName, runId }: { outputPath: string; runName: string; runId: string }) => {
				const modelPath = getModelPath(exp(outputPath));
				if (!(await Bun.file(modelPath).exists()))
					return { filePath: "", filename: "", error: "Model weights not found." };

				const safeName   = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const binaryName = `${safeName}-cli${process.platform === "win32" ? ".exe" : ""}`;
				const outBinary  = join(tmpdir(), binaryName);

				const buildDir = await mkdtemp(join(tmpdir(), "reticle-cli-"));
				try {
					await copyFile(CLI_ENTRY,         join(buildDir, "cli.ts"));
					await copyFile(UTIL_ENTRY,        join(buildDir, "util.ts"));
					await copyFile(modelPath,         join(buildDir, "model.pt"));
					await copyFile(INFER_SCRIPT,      join(buildDir, "infer.py"));
					await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

					const proc = Bun.spawn(
						[process.execPath, "build", "--compile", "--minify", "--bytecode", join(buildDir, "cli.ts"), "--outfile", outBinary],
						{ stdout: "pipe", stderr: "pipe" },
					);
					runningProcesses.set(runId, proc);
					let stderr = "";
					for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
					const exitCode = await proc.exited;
					runningProcesses.delete(runId);
					if (exitCode !== 0)
						return { filePath: "", filename: "", error: `Compile failed: ${stderr.trim().split("\n").pop()}` };
				} finally {
					await rm(buildDir, { recursive: true, force: true }).catch(() => {});
				}

				return { filePath: outBinary, filename: binaryName, error: null };
			},

		exportCLI: async ({ outputPath, runName, destDir }: {
				outputPath: string; runName: string; destDir: string;
			}) => {
				const modelPath = getModelPath(exp(outputPath));
				if (!(await Bun.file(modelPath).exists()))
					return { bundlePath: "", error: "Model weights not found." };

				const safeName  = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const outBinary = join(destDir, `${safeName}-detect${process.platform === "win32" ? ".exe" : ""}`);

				// Temp dir: cli.ts + util.ts (its import) + embedded Python assets.
				const buildDir = await mkdtemp(join(tmpdir(), "reticle-cli-"));
				try {
					await copyFile(CLI_ENTRY,    join(buildDir, "cli.ts"));
					await copyFile(UTIL_ENTRY,   join(buildDir, "util.ts"));
					await copyFile(modelPath,    join(buildDir, "model.pt"));
					await copyFile(INFER_SCRIPT, join(buildDir, "infer.py"));
					await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

					const proc = Bun.spawn(
						[process.execPath, "build", "--compile", "--minify", "--bytecode", join(buildDir, "cli.ts"), "--outfile", outBinary],
						{ stdout: "pipe", stderr: "pipe" },
					);
					runningProcesses.set(runId, proc);
					let stderr = "";
					for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
					const exitCode = await proc.exited;
					runningProcesses.delete(runId);
					if (exitCode !== 0)
						return { bundlePath: "", error: `Compile failed: ${stderr.trim().split("\n").pop()}` };
				} finally {
					await rm(buildDir, { recursive: true, force: true }).catch(() => {});
				}

				return { bundlePath: outBinary, error: null };
			},

			cancelExport: async ({ runId }: { runId: string }) => {
				const proc = runningProcesses.get(runId);
				if (proc) { proc.kill(9); runningProcesses.delete(runId); }
				return {};
			},

		downloadExport: async ({ outputPath, format, runName, runId }: { outputPath: string; format: string; runName: string; runId: string }) => {
				const modelPath = getModelPath(exp(outputPath));
				if (!(await Bun.file(modelPath).exists()))
					return { filePath: "", filename: "", error: "Model weights not found." };

				let exportedPath: string;

				if (format === "pt") {
					exportedPath = modelPath;
				} else {
					const { stdout, stderr } = await runProcess([VENV_PYTHON, EXPORT_SCRIPT], {
						stdinData: JSON.stringify({ modelPath, format }),
						stderrHandler: async () => {},
						runId,
					});
					const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
					try {
						const data = JSON.parse(line);
						if (data.error) return { filePath: "", filename: "", error: data.error };
						exportedPath = data.exportedPath;
					} catch {
						const hint = stderr.trim().split("\n").filter(Boolean).pop() ?? "";
						return { filePath: "", filename: "", error: `Export failed.${hint ? ` ${hint}` : ""}` };
					}
				}

				const FORMAT_EXT: Record<string, string> = {
					pt:       ".pt",
					onnx:     ".onnx",
					tflite:   ".tflite",
					coreml:   "",
					openvino: "",
				};
				const safeName = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const ext      = FORMAT_EXT[format] ?? extname(exportedPath);
				const destName = ext ? `${safeName}${ext}` : `${safeName}_${format}`;

				const srcStat = await stat(exportedPath);
				if (srcStat.isDirectory()) {
					// Zip the directory so the bridge server can serve it as a single file.
					const parent   = dirname(exportedPath);
					const dirName  = basename(exportedPath);
					const zipPath  = join(parent, `${dirName}.zip`);
					const proc     = Bun.spawn(["zip", "-r", "-q", zipPath, dirName], { cwd: parent, stdout: "pipe", stderr: "pipe" });
					runningProcesses.set(runId, proc);
					const exitCode = await proc.exited;
					runningProcesses.delete(runId);
					if (exitCode !== 0) return { filePath: "", filename: "", error: "Failed to create zip archive for export." };
					return { filePath: zipPath, filename: `${destName}.zip`, error: null };
				}

				return { filePath: exportedPath, filename: destName, error: null };
			},

		downloadFile: async ({ srcPath }: { srcPath: string }) => {
				const downloadsDir = join(homedir(), "Downloads");
				await mkdir(downloadsDir, { recursive: true });
				const destPath = join(downloadsDir, basename(exp(srcPath)));
				const srcStat  = await stat(exp(srcPath));
				if (srcStat.isDirectory()) {
					await cp(exp(srcPath), destPath, { recursive: true });
				} else {
					await copyFile(exp(srcPath), destPath);
				}
				return { savedPath: destPath, error: null };
			},

			deleteFolder: async ({ folderPath }: { folderPath: string }) => {
				try {
					await rm(exp(folderPath), { recursive: true, force: true });
				} catch {}
				return {};
			},

			stopTraining: async ({ runId, clearCheckpoint, outputPath }: {
				runId: string; clearCheckpoint?: boolean; outputPath?: string;
			}) => {
				const proc = runningProcesses.get(runId);
				if (proc) { proc.kill(9); runningProcesses.delete(runId); }
				if (clearCheckpoint && outputPath) {
					await unlink(checkpointPath(exp(outputPath))).catch(() => {});
					await unlink(join(exp(outputPath), "train.log")).catch(() => {});
				}
				return {};
			},

			startHubPush: async ({ outputPath, repoId, token, runName }: {
				outputPath: string; repoId: string; token: string; runName: string;
			}) => {
				const jobId   = crypto.randomUUID();
				const logPath = join(HUB_LOGS_DIR, `${jobId}.log`);
				await mkdir(HUB_LOGS_DIR, { recursive: true });

				// Fire-and-forget: env setup, pip install, then push.
				(async () => {
					const log = (line: string) => appendFile(logPath, line + "\n").catch(console.error);
					try {
						await prepareEnvironment(logPath, jobId);
					} catch (err) {
						await log(JSON.stringify({ type: "error", message: `Environment setup failed: ${(err as Error).message}` }));
						return;
					}
					await log(JSON.stringify({ type: "progress", text: "Checking huggingface_hub package..." }));
					const pipLogger = coalescePipProgress(async (text: string) => log(JSON.stringify({ type: "stderr", text })));
					const { exitCode: pipExit } = await runWithPTY(
						[VENV_PYTHON, "-m", "pip", "install", "--progress-bar", "raw", "huggingface_hub"],
						{ stdoutHandler: pipLogger, stderrHandler: pipLogger },
					);
					if (pipExit !== 0) {
						await log(JSON.stringify({ type: "error", message: "Failed to install huggingface_hub package." }));
						return;
					}
					const proc = Bun.spawn([VENV_PYTHON, PUSH_SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
					const safeName = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
					proc.stdin.write(JSON.stringify({ modelPath: getModelPath(exp(outputPath)), repoId, token, fileName: `${safeName}.pt` }));
					proc.stdin.end();
					await streamProcessOutput(proc, {
						stdoutHandler: line => log(line),
						stderrHandler: text => log(JSON.stringify({ type: "stderr", text })),
					});
				})();

				return { jobId };
			},

			readHubLog: async ({ jobId }: { jobId: string }) => {
				return { lines: await readLogFile(join(HUB_LOGS_DIR, `${jobId}.log`)) };
			},
		},
	},
});

// ── Window ────────────────────────────────────────────────────────────────────

const { x, y, width, height } = Screen.getPrimaryDisplay().workArea;
const mainWindow = new BrowserWindow({
	title: "Reticle",
	url:   "views://mainview/index.html",
	frame: { x, y, width, height },
	rpc,
});

console.log(`Reticle started - bridge on port ${server.port}`);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Kill every child process we spawned before the app exits.

function killAll() {
	for (const [, proc] of runningProcesses) {
		try { proc.kill(9); } catch {}
	}
	runningProcesses.clear();
}

Electrobun.events.on("before-quit", () => killAll());

// Fallback for SIGTERM / SIGINT (e.g. `kill` from terminal or Ctrl-C in dev).
process.on("SIGTERM", () => { killAll(); process.exit(0); });
process.on("SIGINT",  () => { killAll(); process.exit(0); });
process.on("exit",    () => killAll());
