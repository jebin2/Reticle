/**
 * Shared utilities used by multiple RPC handler modules.
 * Pure I/O helpers only — no framework dependencies.
 */

import { readFile, readdir, stat } from "fs/promises";
import { extname, join } from "path";
import { homedir } from "os";
import { fileExists } from "./util";
import { parseSegmentationLine, isTruePolygon } from "./polygon";

/** Expand a leading ~ to the real home directory. */
export const exp = (p: string) => p.replace(/^~/, homedir());

/** Image file extensions accepted throughout the app. */
export const IMAGE_EXTS = new Set([
	".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif",
]);

export type AnnotatedImageEntry = {
	imgPath: string;
	labelPath: string;
	mtime: number;
};

export async function readLogFile(logPath: string): Promise<string[]> {
	try {
		const content = await readFile(logPath, "utf-8");
		return content.split("\n").filter(l => l.trim());
	} catch { return []; }
}

export async function checkFileHasPolygon(labelPath: string): Promise<boolean> {
	let text: string;
	try { text = await readFile(labelPath, "utf-8"); } catch { return false; }
	for (const line of text.trim().split("\n")) {
		const pts = parseSegmentationLine(line);
		if (pts && isTruePolygon(pts)) return true;
	}
	return false;
}

export async function detectHasPolygons(storagePath: string): Promise<boolean> {
	const labelsDir = join(storagePath, "labels");
	let files: string[];
	try { files = await readdir(labelsDir); } catch { return false; }
	for (const f of files) {
		if (!f.endsWith(".txt")) continue;
		if (await checkFileHasPolygon(join(labelsDir, f))) return true;
	}
	return false;
}

export async function listAnnotatedImages(assetPath: string): Promise<AnnotatedImageEntry[]> {
	const imagesDir = join(exp(assetPath), "images");
	const labelsDir = join(exp(assetPath), "labels");
	let entries: Array<{ name: string; isFile(): boolean }>;
	try {
		entries = await readdir(imagesDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const result: AnnotatedImageEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue;
		const labelPath = join(labelsDir, entry.name.slice(0, entry.name.lastIndexOf(".")) + ".txt");
		if (!(await fileExists(labelPath))) continue;
		const text = await readFile(labelPath, "utf-8").catch(() => "");
		if (!text.trim()) continue;
		const labelStat = await stat(labelPath);
		result.push({
			imgPath: join(imagesDir, entry.name),
			labelPath,
			mtime: Math.floor(labelStat.mtimeMs / 1000),
		});
	}

	return result;
}
