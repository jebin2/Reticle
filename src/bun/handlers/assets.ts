import Electrobun from "electrobun/bun";
import { readdir, mkdir, copyFile, stat } from "fs/promises";
import { join, extname, basename } from "path";
import { homedir } from "os";
import { YOLO_DIR } from "../util";
import { exp, IMAGE_EXTS, detectHasPolygons } from "../common";
import { parseSegmentationLine, isTruePolygon } from "../polygon";

// ── Dialog path helpers ───────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
	try { await stat(p); return true; } catch { return false; }
}

/**
 * Electrobun's openFileDialog splits on "," for multi-select, which breaks
 * filenames containing commas. Re-join adjacent parts until we find a path
 * that exists on disk.
 */
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

// ── Handlers ──────────────────────────────────────────────────────────────────

export const assetHandlers = {
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
};
