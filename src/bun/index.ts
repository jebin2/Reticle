import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { readdir, mkdir, copyFile, appendFile } from "fs/promises";
import { join, extname, basename } from "path";
import { randomBytes } from "crypto";
import { homedir } from "os";

const IMAGE_EXTS   = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"]);
const TRAIN_SCRIPT = join(import.meta.dir, "../python/train.py");

// Tracks active training subprocesses keyed by run ID.
const runningProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

// ── binary bridge ─────────────────────────────────────────────────────────────
// Serves image files to the renderer by path. Avoids base64 encoding entirely.

const securityToken = randomBytes(32).toString("hex");

const server = Bun.serve({
	port: 0, // random available port
	async fetch(req) {
		const headers = new Headers({ "Access-Control-Allow-Origin": "*" });
		const url = new URL(req.url);

		if (url.searchParams.get("token") !== securityToken)
			return new Response("Unauthorized", { status: 401, headers });

		const filePath = url.searchParams.get("path");
		if (!filePath) return new Response("Missing path", { status: 400, headers });

		const file = Bun.file(filePath);
		if (!(await file.exists())) return new Response("Not found", { status: 404, headers });

		return new Response(file, { headers });
	},
});

// ── recursive image collector ─────────────────────────────────────────────────

async function collectImagePaths(dir: string): Promise<string[]> {
	const paths: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	await Promise.all(entries.map(async entry => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			const sub = await collectImagePaths(fullPath);
			for (const p of sub) paths.push(p);
		} else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) {
			paths.push(fullPath);
		}
	}));
	return paths;
}

// ── RPC ───────────────────────────────────────────────────────────────────────

const rpc = defineElectrobunRPC("bun", {
	maxRequestTime: Infinity,
	handlers: {
		requests: {
			getBridgeConfig: async () => ({
				port:  server.port,
				token: securityToken,
			}),

			openImagesDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder:        homedir(),
					allowedFileTypes:      "*.jpg,*.jpeg,*.png,*.webp,*.bmp,*.gif,*.tiff,*.tif",
					canChooseFiles:        true,
					canChooseDirectory:    false,
					allowsMultipleSelection: true,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				return { canceled, paths: canceled ? [] : filePaths };
			},

			loadStudio: async () => {
				const studioFile = join(homedir(), ".yolostudio", "studio.json");
				try {
					const file = Bun.file(studioFile);
					if (await file.exists()) return JSON.parse(await file.text());
				} catch (err) {
					console.error("Failed to parse studio.json:", err);
				}
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
					startingFolder:        homedir(),
					canChooseFiles:        false,
					canChooseDirectory:    true,
					allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				if (canceled) return { canceled: true, paths: [] };

				const paths = await collectImagePaths(filePaths[0]);
				paths.sort((a, b) =>
					a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
				);
				return { canceled: false, paths };
			},

			loadAssetData: async ({ storagePath }: { storagePath: string }) => {
				const imagesDir = join(storagePath, "images");
				const labelsDir = join(storagePath, "labels");
				await mkdir(imagesDir, { recursive: true });
				await mkdir(labelsDir, { recursive: true });

				const imageFiles = (await readdir(imagesDir))
					.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));

				const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>> = {};
				for (const filename of imageFiles) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					try {
						const text = await Bun.file(labelPath).text();
						labels[filename] = text.trim().split("\n").filter(Boolean).map(line => {
							const [ci, cx, cy, w, h] = line.split(" ").map(Number);
							return { classIndex: ci, cx, cy, w, h };
						});
					} catch {
						labels[filename] = [];
					}
				}

				let classes: string[] = [];
				try {
					const text = await Bun.file(join(storagePath, "classes.txt")).text();
					classes = text.trim().split("\n").filter(Boolean);
				} catch {}

				return {
					images:  imageFiles.map(f => ({ filename: f, filePath: join(imagesDir, f) })),
					labels,
					classes,
				};
			},

			saveAnnotations: async ({ storagePath, labels, classes }: {
				storagePath: string;
				labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>>;
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
					if (file.sourcePath && file.sourcePath !== dest) {
						await copyFile(file.sourcePath, dest);
					} else if (file.dataUrl) {
						const [, b64] = file.dataUrl.split(",");
						await Bun.write(dest, Buffer.from(b64, "base64"));
					}
					results.push({ filename: basename(file.filename), filePath: dest });
				}
				return { images: results };
			},

			openFolderPathDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder:        homedir(),
					canChooseFiles:        false,
					canChooseDirectory:    true,
					allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				return canceled
					? { canceled: true, path: "" }
					: { canceled: false, path: filePaths[0] };
			},

			startTraining: async (config: {
				id: string; name: string; assetPaths: string[]; classMap: string[];
				baseModel: string; epochs: number; batchSize: number; imgsz: number;
				device: string; outputPath: string;
			}) => {
				await mkdir(config.outputPath, { recursive: true });
				const logPath = join(config.outputPath, "train.log");

				// Write start entry to log.
				await appendFile(logPath, JSON.stringify({
					type: "start", timestamp: new Date().toISOString(), config,
				}) + "\n");

				const proc = Bun.spawn(["python3", TRAIN_SCRIPT], {
					stdin:  "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});

				runningProcesses.set(config.id, proc);

				// Write JSON config to Python stdin then close it.
				proc.stdin.write(JSON.stringify(config));
				proc.stdin.end();

				// Stream stdout → log file (fire-and-forget).
				(async () => {
					const decoder = new TextDecoder();
					let   buffer  = "";
					for await (const chunk of proc.stdout) {
						buffer += decoder.decode(chunk, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";
						for (const line of lines) {
							if (!line.trim()) continue;
							await appendFile(logPath, line + "\n").catch(console.error);
						}
					}
					if (buffer.trim()) await appendFile(logPath, buffer + "\n").catch(console.error);
					runningProcesses.delete(config.id);
				})().catch(console.error);

				// Stream stderr → log file as typed entries.
				(async () => {
					const decoder = new TextDecoder();
					for await (const chunk of proc.stderr) {
						const text = decoder.decode(chunk).trim();
						if (text) await appendFile(logPath,
							JSON.stringify({ type: "stderr", text }) + "\n"
						).catch(console.error);
					}
				})().catch(console.error);

				return { started: true };
			},

			readTrainingLog: async ({ outputPath }: { outputPath: string }) => {
				const logPath = join(outputPath, "train.log");
				try {
					const content = await Bun.file(logPath).text();
					const lines   = content.split("\n").filter(l => l.trim());
					return { lines };
				} catch {
					return { lines: [] };
				}
			},

			stopTraining: async ({ runId }: { runId: string }) => {
				const proc = runningProcesses.get(runId);
				if (proc) {
					proc.kill();
					runningProcesses.delete(runId);
				}
				return {};
			},
		},
	},
});

// ── window ────────────────────────────────────────────────────────────────────

const mainWindow = new BrowserWindow({
	title: "YOLOStudio",
	url:   "views://mainview/index.html",
	frame: { width: 1280, height: 800, x: 100, y: 80 },
	rpc,
});

console.log(`YOLOStudio started — bridge on port ${server.port}`);
