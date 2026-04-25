import { dialog } from "electron";
import { readFile, readdir, mkdir, copyFile, writeFile } from "fs/promises";
import { join, extname, basename } from "path";
import { homedir } from "os";
import { YOLO_DIR, fileExists } from "../util";
import { exp, IMAGE_EXTS, detectHasPolygons } from "../common";
import { parseYoloLabels, serializeYoloLabels, type AnnotationRecord } from "../yoloLabels";
import { pathExists, collectImagePaths, sortPathsNumerically } from "../pathUtils";

// ── Handlers ──────────────────────────────────────────────────────────────────

export const assetHandlers = {
	openImagesDialog: async () => {
		const result = await dialog.showOpenDialog({
			defaultPath: homedir(),
			properties:  ["openFile", "multiSelections"],
			filters:     [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif"] }],
		});
		if (result.canceled || result.filePaths.length === 0)
			return { canceled: true, paths: [] };
		return { canceled: false, paths: result.filePaths };
	},

	openFolderDialog: async () => {
		const result = await dialog.showOpenDialog({
			defaultPath: homedir(),
			properties:  ["openDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0)
			return { canceled: true, paths: [] };
		const [folderPath] = result.filePaths;
		if (!(await pathExists(folderPath))) return { canceled: true, paths: [] };
		const paths = sortPathsNumerically(await collectImagePaths(folderPath));
		return { canceled: false, paths };
	},

	openFolderPathDialog: async () => {
		const result = await dialog.showOpenDialog({
			defaultPath: homedir(),
			properties:  ["openDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0)
			return { canceled: true, path: "" };
		return { canceled: false, path: result.filePaths[0] };
	},

	loadStudio: async () => {
		const studioFile = join(YOLO_DIR, "studio.json");
		try {
			if (await fileExists(studioFile)) {
				const data = JSON.parse(await readFile(studioFile, "utf-8"));
				if (Array.isArray(data.runs)) {
					data.runs = data.runs.map((r: { status: string }) =>
						r.status === "training" || r.status === "installing"
							? { ...r, status: "paused" } : r
					);
				}
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
					if (dirty) await writeFile(studioFile, JSON.stringify(data, null, 2));
				}
				return data;
			}
		} catch (err) { console.error("Failed to parse studio.json:", err); }
		return { assets: [], runs: [] };
	},

	saveStudio: async ({ assets, runs }: { assets: unknown[]; runs: unknown[] }) => {
		await mkdir(YOLO_DIR, { recursive: true });
		await writeFile(join(YOLO_DIR, "studio.json"), JSON.stringify({ assets, runs }, null, 2));
		return {};
	},

	loadAssetData: async ({ storagePath }: { storagePath: string }) => {
		const imagesDir = join(exp(storagePath), "images");
		const labelsDir = join(exp(storagePath), "labels");
		await mkdir(imagesDir, { recursive: true });
		await mkdir(labelsDir, { recursive: true });
		const imageFiles = (await readdir(imagesDir)).filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
		const labels: Record<string, AnnotationRecord[]> = {};
		for (const filename of imageFiles) {
			const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
			try {
				labels[filename] = parseYoloLabels(await readFile(labelPath, "utf-8"));
			} catch { labels[filename] = []; }
		}
		let classes: string[] = [];
		try {
			const text = await readFile(join(exp(storagePath), "classes.txt"), "utf-8");
			classes = text.trim().split("\n").filter(Boolean);
		} catch {}
		return { images: imageFiles.map(f => ({ filename: f, filePath: join(imagesDir, f) })), labels, classes };
	},

	saveAnnotations: async ({ storagePath, labels, classes }: {
		storagePath: string;
		labels: Record<string, AnnotationRecord[]>;
		classes: string[];
	}) => {
		const labelsDir = join(exp(storagePath), "labels");
		await mkdir(labelsDir, { recursive: true });
		for (const [filename, anns] of Object.entries(labels)) {
			const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
			await writeFile(labelPath, serializeYoloLabels(anns));
		}
		await writeFile(join(exp(storagePath), "classes.txt"), classes.join("\n"));
		return {};
	},

	ensureDir: async ({ path }: { path: string }) => {
		await mkdir(exp(path), { recursive: true });
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
				await writeFile(dest, Buffer.from(b64, "base64"));
			}
			results.push({ filename: basename(file.filename), filePath: dest });
		}
		return { images: results };
	},
};
