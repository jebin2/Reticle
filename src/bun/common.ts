/**
 * Shared utilities used by multiple RPC handler modules.
 * Pure I/O helpers only — no Electrobun / window dependencies.
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { parseSegmentationLine, isTruePolygon } from "./polygon";

/** Expand a leading ~ to the real home directory. */
export const exp = (p: string) => p.replace(/^~/, homedir());

/** Image file extensions accepted throughout the app. */
export const IMAGE_EXTS = new Set([
	".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif",
]);

/** Read a newline-delimited log file and return non-empty lines. */
export async function readLogFile(logPath: string): Promise<string[]> {
	try {
		const content = await Bun.file(logPath).text();
		return content.split("\n").filter(l => l.trim());
	} catch { return []; }
}

/**
 * Scan an asset's label files and return whether any annotation is a true
 * polygon (not just a bbox converted to an axis-aligned 4-corner rectangle).
 */
export async function detectHasPolygons(storagePath: string): Promise<boolean> {
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
