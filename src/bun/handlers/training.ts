import { readdir, mkdir, appendFile, unlink, stat } from "fs/promises";
import { join, extname } from "path";
import {
	TRAIN_SCRIPT, runningProcesses,
	prepareEnvironment, streamProcessOutput, checkpointPath, modelPath as getModelPath,
} from "../util";
import { exp, IMAGE_EXTS, readLogFile, detectHasPolygons } from "../common";

// ── Dataset snapshot ──────────────────────────────────────────────────────────

export type SnapEntry = { img: string; lbl: string; mtime: number };

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
			if (!(await lblFile.text()).trim()) continue;
			const s = await stat(lblPath);
			result.push({ img: join(imagesDir, entry.name), lbl: lblPath, mtime: Math.floor(s.mtimeMs / 1000) });
		}
	}
	return result;
}

/**
 * Refresh a snapshot for resume:
 * - Keep images whose label file still exists and is non-empty (update mtime).
 * - Drop images whose label was deleted or emptied.
 * - Add any newly annotated images from assetPaths not yet in the snapshot.
 */
async function refreshSnapshot(images: SnapEntry[], assetPaths: string[]): Promise<SnapEntry[]> {
	const kept: SnapEntry[] = [];
	const inSnapshot = new Set<string>();

	for (const e of images) {
		inSnapshot.add(e.img);
		const lblFile = Bun.file(e.lbl);
		if (!(await lblFile.exists())) continue;
		if (!(await lblFile.text()).trim()) continue;
		const s = await stat(e.lbl);
		kept.push({ img: e.img, lbl: e.lbl, mtime: Math.floor(s.mtimeMs / 1000) });
	}

	const current = await scanAnnotatedImages(assetPaths);
	for (const e of current) {
		if (!inSnapshot.has(e.img)) kept.push(e);
	}

	return kept;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const trainingHandlers = {
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

		let images: SnapEntry[];
		if (config.fresh) {
			images = await scanAnnotatedImages(config.assetPaths);
			await Bun.write(metaPath, JSON.stringify({ classMap: config.classMap, assetPaths: config.assetPaths, images }));
		} else {
			try {
				const meta       = JSON.parse(await Bun.file(metaPath).text());
				const assetPaths = meta.assetPaths ?? config.assetPaths;
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
		proc.stdin.write(JSON.stringify({ ...config, images }));
		proc.stdin.end();

		streamProcessOutput(proc, {
			stdoutHandler: line => appendFile(logPath, line + "\n").catch(console.error),
			stderrHandler: text =>
				appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(console.error),
		}).then(() => runningProcesses.delete(config.id)).catch(console.error);

		return { started: true };
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
					if (!(await _lf.text()).trim()) continue;
					const imgPath = join(imagesDir, entry.name);
					if (!snap.has(imgPath)) { newCount++; continue; }
					const s = await stat(lblPath);
					if (Math.floor(s.mtimeMs / 1000) !== snap.get(imgPath)) modifiedCount++;
				}
			}
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
};
