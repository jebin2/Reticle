import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { readdir, mkdir, copyFile, cp, appendFile, unlink, rm, mkdtemp, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { randomBytes } from "crypto";
import { homedir, tmpdir } from "os";
import {
	YOLO_DIR, TRAIN_SCRIPT, INFER_SCRIPT, EXPORT_SCRIPT,
	YOLO_UTILS_SCRIPT,
	VENV_PYTHON, runningProcesses,
	prepareEnvironment, runInference, runProcess, streamProcessOutput, checkpointPath,
} from "./util";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"]);

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
		const imagesDir = join(assetPath, "images");
		const labelsDir = join(assetPath, "labels");
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

async function pruneSnapshot(images: SnapEntry[]): Promise<SnapEntry[]> {
	const kept: SnapEntry[] = [];
	for (const e of images) {
		if (!(await Bun.file(e.lbl).exists())) continue;
		const s = await stat(e.lbl);
		if (Math.floor(s.mtimeMs / 1000) !== e.mtime) continue;
		kept.push(e);
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
				return { canceled, paths: canceled ? [] : filePaths };
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
				const paths = await collectImagePaths(filePaths[0]);
				paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
				return { canceled: false, paths };
			},

			loadAssetData: async ({ storagePath }: { storagePath: string }) => {
				const imagesDir = join(storagePath, "images");
				const labelsDir = join(storagePath, "labels");
				await mkdir(imagesDir, { recursive: true });
				await mkdir(labelsDir, { recursive: true });
				const imageFiles = (await readdir(imagesDir)).filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
				const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>> = {};
				for (const filename of imageFiles) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					try {
						const text = await Bun.file(labelPath).text();
						labels[filename] = text.trim().split("\n").filter(Boolean).map(line => {
							const [ci, cx, cy, w, h] = line.split(" ").map(Number);
							return { classIndex: ci, cx, cy, w, h };
						});
					} catch { labels[filename] = []; }
				}
				let classes: string[] = [];
				try {
					const text = await Bun.file(join(storagePath, "classes.txt")).text();
					classes = text.trim().split("\n").filter(Boolean);
				} catch {}
				return { images: imageFiles.map(f => ({ filename: f, filePath: join(imagesDir, f) })), labels, classes };
			},

			saveAnnotations: async ({ storagePath, labels, classes }: {
				storagePath: string;
				labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>>;
				classes: string[];
			}) => {
				const labelsDir = join(storagePath, "labels");
				await mkdir(labelsDir, { recursive: true });
				for (const [filename, anns] of Object.entries(labels)) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					const content   = anns.map(a =>
						`${a.classIndex} ${a.cx.toFixed(6)} ${a.cy.toFixed(6)} ${a.w.toFixed(6)} ${a.h.toFixed(6)}`
					).join("\n");
					await Bun.write(labelPath, content);
				}
				await Bun.write(join(storagePath, "classes.txt"), classes.join("\n"));
				return {};
			},

			importImages: async ({ storagePath, files }: {
				storagePath: string;
				files: Array<{ filename: string; sourcePath?: string; dataUrl?: string }>;
			}) => {
				const imagesDir = join(storagePath, "images");
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
				return canceled ? { canceled: true, path: "" } : { canceled: false, path: filePaths[0] };
			},

			startTraining: async (config: {
				id: string; name: string; assetPaths: string[]; classMap: string[];
				baseModel: string; epochs: number; batchSize: number; imgsz: number;
				device: string; outputPath: string; fresh: boolean;
			}) => {
				await mkdir(config.outputPath, { recursive: true });
				if (config.fresh) {
					await unlink(checkpointPath(config.outputPath)).catch(() => {});
					await unlink(join(config.outputPath, "train.log")).catch(() => {});
				}
				const logPath  = join(config.outputPath, "train.log");
				const metaPath = join(config.outputPath, "run-meta.json");

				// Build or prune the locked image snapshot.
				let images: SnapEntry[];
				if (config.fresh) {
					images = await scanAnnotatedImages(config.assetPaths);
					await Bun.write(metaPath, JSON.stringify({ classMap: config.classMap, assetPaths: config.assetPaths, images }));
				} else {
					try {
						const meta = JSON.parse(await Bun.file(metaPath).text());
						images = await pruneSnapshot(meta.images ?? []);
						await Bun.write(metaPath, JSON.stringify({ classMap: meta.classMap ?? config.classMap, assetPaths: meta.assetPaths ?? config.assetPaths, images }));
					} catch {
						// No meta yet (run predates this feature) — build fresh snapshot.
						images = await scanAnnotatedImages(config.assetPaths);
						await Bun.write(metaPath, JSON.stringify({ classMap: config.classMap, assetPaths: config.assetPaths, images }));
					}
				}

				await appendFile(logPath, JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }) + "\n");

				const venvPython = await prepareEnvironment(logPath, config.id);
				await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[setup] Starting training…" }) + "\n");

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
				const logPath = join(outputPath, "train.log");
				try {
					const content = await Bun.file(logPath).text();
					return { lines: content.split("\n").filter(l => l.trim()) };
				} catch { return { lines: [] }; }
			},

			readRunMeta: async ({ outputPath }: { outputPath: string }) => {
				const EMPTY = { found: false, classMap: [] as string[], imageCount: 0, newCount: 0, modifiedCount: 0 };
				try {
					const meta = JSON.parse(await Bun.file(join(outputPath, "run-meta.json")).text());
					const snap = new Map<string, number>(
						(meta.images ?? []).map((e: SnapEntry) => [e.img, e.mtime])
					);
					let newCount = 0, modifiedCount = 0;
					for (const assetPath of (meta.assetPaths ?? [])) {
						const imagesDir = join(assetPath, "images");
						const labelsDir = join(assetPath, "labels");
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
					return { found: true, classMap: meta.classMap ?? [], imageCount: snap.size, newCount, modifiedCount };
				} catch { return EMPTY; }
			},

			runInference: async ({ imagePath, outputPath, confidence }: {
				imagePath: string; outputPath: string; confidence: number;
			}) => {
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { detections: [], inferenceMs: 0, error: "Model weights not found." };
				return runInference(
					imagePath, modelPath, confidence,
					INFER_SCRIPT,
					join(YOLO_DIR, "infer-setup.log"),
					"inference",
				);
			},

			exportModel: async ({ outputPath, format }: { outputPath: string; format: string }) => {
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
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
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { filePath: "", filename: "", error: "Model weights not found." };

				const safeName   = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const binaryName = `${safeName}-cli${process.platform === "win32" ? ".exe" : ""}`;
				const outBinary  = join(tmpdir(), binaryName);

				const buildDir = await mkdtemp(join(tmpdir(), "yolostudio-cli-"));
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
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { bundlePath: "", error: "Model weights not found." };

				const safeName  = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const outBinary = join(destDir, `${safeName}-detect${process.platform === "win32" ? ".exe" : ""}`);

				// Temp dir: cli.ts + util.ts (its import) + embedded Python assets.
				const buildDir = await mkdtemp(join(tmpdir(), "yolostudio-cli-"));
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
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
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
					const exitCode = await proc.exited;
					if (exitCode !== 0) return { filePath: "", filename: "", error: "Failed to create zip archive for export." };
					return { filePath: zipPath, filename: `${destName}.zip`, error: null };
				}

				return { filePath: exportedPath, filename: destName, error: null };
			},

		downloadFile: async ({ srcPath }: { srcPath: string }) => {
				const downloadsDir = join(homedir(), "Downloads");
				await mkdir(downloadsDir, { recursive: true });
				const destPath = join(downloadsDir, basename(srcPath));
				const srcStat  = await stat(srcPath);
				if (srcStat.isDirectory()) {
					await cp(srcPath, destPath, { recursive: true });
				} else {
					await copyFile(srcPath, destPath);
				}
				return { savedPath: destPath, error: null };
			},

			deleteFolder: async ({ folderPath }: { folderPath: string }) => {
				try {
					await rm(folderPath.replace(/^~/, process.env.HOME ?? ""), { recursive: true, force: true });
				} catch {}
				return {};
			},

			revealInFilesystem: async ({ path }: { path: string }) => {
				const dir = path.split("/").slice(0, -1).join("/") || "/";
				const cmd = process.platform === "darwin"
					? ["open", "-R", path]
					: process.platform === "win32" ? ["explorer", `/select,${path}`] : ["xdg-open", dir];
				Bun.spawn(cmd);
				return {};
			},

			stopTraining: async ({ runId, clearCheckpoint, outputPath }: {
				runId: string; clearCheckpoint?: boolean; outputPath?: string;
			}) => {
				const proc = runningProcesses.get(runId);
				if (proc) { proc.kill(9); runningProcesses.delete(runId); }
				if (clearCheckpoint && outputPath) {
					await unlink(checkpointPath(outputPath)).catch(() => {});
					await unlink(join(outputPath, "train.log")).catch(() => {});
				}
				return {};
			},
		},
	},
});

// ── Window ────────────────────────────────────────────────────────────────────

const mainWindow = new BrowserWindow({
	title: "YOLOStudio",
	url:   "views://mainview/index.html",
	frame: { width: 1280, height: 800, x: 100, y: 80 },
	rpc,
});

console.log(`YOLOStudio started — bridge on port ${server.port}`);
