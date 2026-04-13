import { appendFile, copyFile, mkdir, rm, stat, readdir, unlink } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import {
	TRAIN_SCRIPT, MODELS_DIR, runningProcesses,
	prepareEnvironment, streamProcessOutput, checkpointPath, modelPath as getModelPath,
} from "../util";
import { exp, IMAGE_EXTS, detectHasPolygons, listAnnotatedImages, readLogFile, type AnnotatedImageEntry } from "../common";
import { parseSegmentationLine, isTruePolygon } from "../polygon";

// ── run-meta.json schema ──────────────────────────────────────────────────────

type RunMeta = {
	classMap: string[];
	assetPaths: string[];
	hasPolygons: boolean;    // true at the time the dataset was last copied
	imageCount: number;      // annotated images in the dataset at copy time
	datasetCopiedAt: number; // Date.now() ms timestamp of the last copy
};

// ── Dataset copy ──────────────────────────────────────────────────────────────

const DATASET_SUBDIR   = join("dataset", "images", "train");
const DATASET_LBL_SUBDIR = join("dataset", "labels", "train");

/**
 * Copy annotated images + labels from asset folders into
 * outputPath/dataset/images/train/ and outputPath/dataset/labels/train/.
 *
 * Progress is appended to logPath as dataset_copy_start / dataset_copy_progress
 * events so the polling loop can surface it in the UI.
 *
 * Filename collisions across assets are resolved by prefixing with the
 * asset folder name — mirrors the logic in the old Python build_dataset.
 */
async function copyDatasetFiles(
	assetPaths: string[],
	outputPath: string,
	logPath: string,
): Promise<{ imageCount: number; hasPolygons: boolean }> {
	const imgDir = join(exp(outputPath), DATASET_SUBDIR);
	const lblDir = join(exp(outputPath), DATASET_LBL_SUBDIR);

	// Wipe any previous copy so stale files don't survive.
	try { await rm(join(exp(outputPath), "dataset"), { recursive: true, force: true }); } catch {}
	await mkdir(imgDir, { recursive: true });
	await mkdir(lblDir, { recursive: true });

	const allEntries = (await Promise.all(assetPaths.map(p => listAnnotatedImages(p)))).flat();
	const total = allEntries.length;

	await appendFile(logPath, JSON.stringify({ type: "dataset_copy_start", total }) + "\n");

	const seen        = new Set<string>();
	let   hasPolygons = false;
	const REPORT_EVERY = 10;

	for (let i = 0; i < allEntries.length; i++) {
		const entry = allEntries[i];

		// Collision-safe destination name.
		const srcName = basename(entry.imgPath);
		let   destName = srcName;
		if (seen.has(destName)) {
			const assetBase = basename(dirname(dirname(entry.imgPath)));
			destName = `${assetBase}__${srcName}`;
		}
		seen.add(destName);

		const destStem = destName.slice(0, destName.lastIndexOf("."));
		await copyFile(entry.imgPath,   join(imgDir, destName));
		await copyFile(entry.labelPath, join(lblDir, `${destStem}.txt`));

		// Detect polygons inline while the label file is already in scope.
		if (!hasPolygons) {
			const text = await Bun.file(entry.labelPath).text();
			for (const line of text.trim().split("\n")) {
				const pts = parseSegmentationLine(line);
				if (pts && isTruePolygon(pts)) { hasPolygons = true; break; }
			}
		}

		if ((i + 1) % REPORT_EVERY === 0 || i === allEntries.length - 1) {
			await appendFile(logPath, JSON.stringify({ type: "dataset_copy_progress", done: i + 1, total }) + "\n");
		}
	}

	return { imageCount: total, hasPolygons };
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
		const datasetPath = join(exp(config.outputPath), "dataset");

		await appendFile(logPath, JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }) + "\n");

		let imageCount: number;
		let hasPolygons: boolean;

		if (config.fresh) {
			// Copy a fresh snapshot of the current annotated images.
			const result = await copyDatasetFiles(config.assetPaths, config.outputPath, logPath);
			imageCount   = result.imageCount;
			hasPolygons  = result.hasPolygons;
			const meta: RunMeta = {
				classMap:        config.classMap,
				assetPaths:      config.assetPaths,
				hasPolygons,
				imageCount,
				datasetCopiedAt: Date.now(),
			};
			await Bun.write(metaPath, JSON.stringify(meta, null, 2));
		} else {
			// Resume: use the existing dataset copy as-is.
			try {
				const meta: RunMeta = JSON.parse(await Bun.file(metaPath).text());
				imageCount  = meta.imageCount  ?? 0;
				hasPolygons = meta.hasPolygons ?? false;
			} catch {
				imageCount = 0; hasPolygons = false;
			}

			// Safety: if the dataset directory is missing (e.g. pre-refactor run),
			// fall back to a fresh copy so the run can proceed.
			const imgDir = join(datasetPath, "images", "train");
			let datasetExists = false;
			try { datasetExists = (await stat(imgDir)).isDirectory(); } catch {}

			if (!datasetExists) {
				await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[dataset] Dataset missing — copying from assets..." }) + "\n");
				const result = await copyDatasetFiles(config.assetPaths, config.outputPath, logPath);
				imageCount   = result.imageCount;
				hasPolygons  = result.hasPolygons;
				const meta: RunMeta = {
					classMap:        config.classMap,
					assetPaths:      config.assetPaths,
					hasPolygons,
					imageCount,
					datasetCopiedAt: Date.now(),
				};
				await Bun.write(metaPath, JSON.stringify(meta, null, 2));
			}
		}

		const venvPython = await prepareEnvironment(logPath, config.id);
		await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[setup] Starting training..." }) + "\n");

		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn([venvPython, TRAIN_SCRIPT], {
				stdin: "pipe", stdout: "pipe", stderr: "pipe",
				env: { ...process.env, PYTHONUNBUFFERED: "1" },
			});
		} catch (spawnErr) {
			await appendFile(logPath, JSON.stringify({
				type: "error",
				message: `Failed to start Python process: ${(spawnErr as Error).message}`,
			}) + "\n");
			return { started: false };
		}

		runningProcesses.set(config.id, proc);
		// Pass datasetPath and modelsDir to Python; Python writes data.yaml and trains from there.
		await mkdir(MODELS_DIR, { recursive: true });
		const stdin = proc.stdin as import("bun").FileSink;
		stdin.write(JSON.stringify({ ...config, datasetPath, modelsDir: MODELS_DIR }));
		stdin.end();

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

	/**
	 * Returns the run's stored metadata plus a drift summary comparing the
	 * current state of the asset folders against the last dataset copy.
	 *
	 * Called when RunDetailView opens so the UI can surface an "Update Dataset"
	 * banner if annotations have changed since the last Start.
	 */
	readRunMeta: async ({ outputPath }: { outputPath: string }) => {
		const EMPTY = {
			found:               false,
			classMap:            [] as string[],
			imageCount:          0,
			hasPolygons:         false,
			currentHasPolygons:  false,
			hasPolygonsChanged:  false,
			newCount:            0,
			deletedCount:        0,
			modifiedCount:       0,
			hasDrift:            false,
		};
		try {
			const meta: RunMeta = JSON.parse(await Bun.file(join(exp(outputPath), "run-meta.json")).text());

			// Count images currently in the copied dataset.
			const datasetImgDir = join(exp(outputPath), DATASET_SUBDIR);
			let datasetImageCount = 0;
			try {
				const files = await readdir(datasetImgDir);
				datasetImageCount = files.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase())).length;
			} catch {}

			// Count current annotated images across all asset folders.
			const assetPaths: string[] = meta.assetPaths ?? [];
			const currentEntries: AnnotatedImageEntry[] = (
				await Promise.all(assetPaths.map(p => listAnnotatedImages(p)))
			).flat();
			const currentCount = currentEntries.length;

			// Image count drift.
			const newCount     = Math.max(0, currentCount - datasetImageCount);
			const deletedCount = Math.max(0, datasetImageCount - currentCount);

			// Label modification: any label file whose mtime is newer than the copy.
			const copiedAt      = meta.datasetCopiedAt ?? 0;
			const modifiedCount = currentEntries.filter(e => e.mtime * 1000 > copiedAt).length;

			// Polygon type drift.
			const polyResults          = await Promise.all(assetPaths.map(p => detectHasPolygons(exp(p))));
			const currentHasPolygons   = polyResults.some(Boolean);
			const hasPolygonsChanged   = currentHasPolygons !== (meta.hasPolygons ?? false);

			const hasDrift = newCount > 0 || deletedCount > 0 || modifiedCount > 0 || hasPolygonsChanged;

			return {
				found:              true,
				classMap:           meta.classMap      ?? [],
				imageCount:         meta.imageCount     ?? datasetImageCount,
				hasPolygons:        meta.hasPolygons    ?? false,
				currentHasPolygons,
				hasPolygonsChanged,
				newCount,
				deletedCount,
				modifiedCount,
				hasDrift,
			};
		} catch { return EMPTY; }
	},

	/**
	 * Wipe and re-copy the dataset from the asset folders.
	 * Only valid when the run is not actively training (enforced by the UI).
	 */
	updateDataset: async ({ outputPath }: { outputPath: string }) => {
		const metaPath = join(exp(outputPath), "run-meta.json");
		const meta: RunMeta = JSON.parse(await Bun.file(metaPath).text());

		// Re-use copyDatasetFiles without a log path (no training in progress).
		// Write progress to a temp update log so we don't pollute train.log.
		const updateLogPath = join(exp(outputPath), "dataset-update.log");
		await Bun.write(updateLogPath, "");

		const { imageCount, hasPolygons } = await copyDatasetFiles(
			meta.assetPaths, outputPath, updateLogPath,
		);

		const updated: RunMeta = {
			...meta,
			hasPolygons,
			imageCount,
			datasetCopiedAt: Date.now(),
		};
		await Bun.write(metaPath, JSON.stringify(updated, null, 2));
		await unlink(updateLogPath).catch(() => {});

		return { imageCount, hasPolygons, previousHasPolygons: meta.hasPolygons };
	},

	checkWeights: async ({ outputPaths }: { outputPaths: string[] }) => {
		const results: Record<string, boolean> = {};
		await Promise.all(outputPaths.map(async p => {
			results[p] = await Bun.file(getModelPath(exp(p))).exists();
		}));
		return { results };
	},
};
