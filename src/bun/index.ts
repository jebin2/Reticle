import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { readdir, mkdir, copyFile, appendFile, unlink, rm, mkdtemp } from "fs/promises";
import { join, extname, basename } from "path";
import { randomBytes } from "crypto";
import { homedir, tmpdir } from "os";
import {
	YOLO_DIR, TRAIN_SCRIPT, INFER_SCRIPT, EXPORT_SCRIPT,
	VENV_PYTHON, runningProcesses,
	prepareEnvironment, runInference,
	pipeLines, checkpointPath,
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
				const studioFile = join(homedir(), ".yolostudio", "studio.json");
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
				const studioDir = join(homedir(), ".yolostudio");
				await mkdir(studioDir, { recursive: true });
				await Bun.write(join(studioDir, "studio.json"), JSON.stringify({ assets, runs }, null, 2));
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
				const logPath = join(config.outputPath, "train.log");
				await appendFile(logPath, JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }) + "\n");

				const venvPython = await prepareEnvironment(logPath, config.id);
				await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[setup] Starting training…" }) + "\n");

				const proc = Bun.spawn([venvPython, TRAIN_SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
				runningProcesses.set(config.id, proc);
				proc.stdin.write(JSON.stringify(config));
				proc.stdin.end();

				pipeLines(proc.stdout, line => appendFile(logPath, line + "\n").catch(console.error))
					.then(() => runningProcesses.delete(config.id)).catch(console.error);
				pipeLines(proc.stderr, text =>
					appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(console.error)
				).catch(console.error);

				return { started: true };
			},

			readTrainingLog: async ({ outputPath }: { outputPath: string }) => {
				const logPath = join(outputPath, "train.log");
				try {
					const content = await Bun.file(logPath).text();
					return { lines: content.split("\n").filter(l => l.trim()) };
				} catch { return { lines: [] }; }
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
				const proc = Bun.spawn([VENV_PYTHON, EXPORT_SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
				proc.stdin.write(JSON.stringify({ modelPath, format }));
				proc.stdin.end();
				const dec = new TextDecoder();
				let stdout = ""; let stderr = "";
				await Promise.all([
					(async () => { for await (const c of proc.stdout) stdout += dec.decode(c); })(),
					(async () => { for await (const c of proc.stderr) stderr += dec.decode(c); })(),
				]);
				await proc.exited;
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

			exportCLI: async ({ outputPath, runName, destDir }: {
				outputPath: string; runName: string; destDir: string;
			}) => {
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { bundlePath: "", error: "Model weights not found." };

				const safeName  = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const outBinary = join(destDir, `${safeName}-detect${process.platform === "win32" ? ".exe" : ""}`);

				// Temp dir: cli.ts + util.ts (its import) + model.pt + infer.py (embedded assets)
				const buildDir = await mkdtemp(join(tmpdir(), "yolostudio-cli-"));
				try {
					await copyFile(CLI_ENTRY,    join(buildDir, "cli.ts"));
					await copyFile(UTIL_ENTRY,   join(buildDir, "util.ts"));
					await copyFile(modelPath,    join(buildDir, "model.pt"));
					await copyFile(INFER_SCRIPT, join(buildDir, "infer.py"));

					const proc = Bun.spawn(
						[process.execPath, "build", "--compile", join(buildDir, "cli.ts"), "--outfile", outBinary],
						{ stdout: "pipe", stderr: "pipe" },
					);
					let stderr = "";
					for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
					const exitCode = await proc.exited;
					if (exitCode !== 0)
						return { bundlePath: "", error: `Compile failed: ${stderr.trim().split("\n").pop()}` };
				} finally {
					await rm(buildDir, { recursive: true, force: true }).catch(() => {});
				}

				return { bundlePath: outBinary, error: null };
			},

			revealInFilesystem: async ({ path }: { path: string }) => {
				const dir = path.includes(".") && !path.endsWith("/")
					? path.split("/").slice(0, -1).join("/") : path;
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
