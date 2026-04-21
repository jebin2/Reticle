import { appendFile, mkdir, copyFile, cp, rm, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { homedir, tmpdir } from "os";
import {
	EXPORT_SCRIPT, VENV_PYTHON,
	IS_WIN, runProcess, runningProcesses, modelPath as getModelPath,
	buildCLIArtifact, coalescePipProgress, parseLastJsonLine, safeName,
} from "../util";
import { exp, readLogFile } from "../common";


// ── Handlers ──────────────────────────────────────────────────────────────────

export const exportHandlers = {
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
		const data = parseLastJsonLine(stdout);
		if (!data) {
			const hint = stderr.trim().split("\n").filter(Boolean).pop() ?? "";
			return { exportedPath: "", fileSize: 0, error: `Export failed.${hint ? ` ${hint}` : ""}` };
		}
		if (data.error) return { exportedPath: "", fileSize: 0, error: data.error as string };
		const fileSize = (await Bun.file(data.exportedPath as string).size) ?? 0;
		return { exportedPath: data.exportedPath as string, fileSize, error: null };
	},

	buildAndDownloadCLI: async ({ outputPath, runName, runId }: {
		outputPath: string; runName: string; runId: string;
	}) => {
		const modelPath = getModelPath(exp(outputPath));
		if (!(await Bun.file(modelPath).exists()))
			return { filePath: "", filename: "", error: "Model weights not found." };

		const name       = safeName(runName);
		const binaryName = `${name}-cli${IS_WIN ? ".exe" : ""}`;
		const outBinary  = join(tmpdir(), binaryName);
		const buildError = await buildCLIArtifact(modelPath, outBinary, runId);
		if (buildError) return { filePath: "", filename: "", error: `Compile failed: ${buildError}` };

		return { filePath: outBinary, filename: binaryName, error: null };
	},

	exportCLI: async ({ outputPath, runName, destDir, runId }: {
		outputPath: string; runName: string; destDir: string; runId: string;
	}) => {
		const modelPath = getModelPath(exp(outputPath));
		if (!(await Bun.file(modelPath).exists()))
			return { bundlePath: "", error: "Model weights not found." };

		const name      = safeName(runName);
		const outBinary = join(destDir, `${name}-detect${IS_WIN ? ".exe" : ""}`);
		const buildError = await buildCLIArtifact(modelPath, outBinary, runId);
		if (buildError) return { bundlePath: "", error: `Compile failed: ${buildError}` };

		return { bundlePath: outBinary, error: null };
	},

	cancelExport: async ({ runId }: { runId: string }) => {
		const proc = runningProcesses.get(runId);
		if (proc) { proc.kill(9); runningProcesses.delete(runId); }
		return {};
	},

	startExport: async ({ outputPath, format, runName, runId }: {
		outputPath: string; format: string; runName: string; runId: string;
	}) => {
		const modelPath = getModelPath(exp(outputPath));
		if (!(await Bun.file(modelPath).exists()))
			return { error: "Model weights not found." };

		const logPath = join(exp(outputPath), `export-${runId}.log`);
		const log = (line: string) => appendFile(logPath, line + "\n").catch(console.error);

		const FORMAT_EXT: Record<string, string> = {
			pt: ".pt", onnx: ".onnx", tflite: ".tflite", coreml: "", openvino: "",
		};
		const name = safeName(runName);

		(async () => {
			if (format === "pt") {
				await log(JSON.stringify({ type: "done", filePath: modelPath, filename: `${name}.pt` }));
				return;
			}

			const pipLogger = coalescePipProgress(async (text: string) =>
				log(JSON.stringify({ type: "stderr", text }))
			);

			const { stdout } = await runProcess([VENV_PYTHON, EXPORT_SCRIPT], {
				stdinData: JSON.stringify({ modelPath, format }),
				stderrHandler: pipLogger,
				collectStdout: true,
				collectStderr: false,
				runId,
			});

			const data = parseLastJsonLine(stdout);
			if (!data) {
				await log(JSON.stringify({ type: "error", message: "Export failed: unexpected output from export script." }));
				return;
			}
			if (data.error) {
				await log(JSON.stringify({ type: "error", message: data.error as string }));
				return;
			}
			const exportedPath = data.exportedPath as string;

			const ext      = FORMAT_EXT[format] ?? extname(exportedPath);
			const destName = ext ? `${name}${ext}` : `${name}_${format}`;

			const srcStat = await stat(exportedPath);
			if (srcStat.isDirectory()) {
				const parent  = dirname(exportedPath);
				const dirName = basename(exportedPath);
				const zipPath = join(parent, `${dirName}.zip`);
				const proc    = Bun.spawn(["zip", "-r", "-q", zipPath, dirName], { cwd: parent, stdout: "pipe", stderr: "pipe" });
				runningProcesses.set(runId, proc);
				const exitCode = await proc.exited;
				runningProcesses.delete(runId);
				if (exitCode !== 0) {
					await log(JSON.stringify({ type: "error", message: "Failed to create zip archive for export." }));
					return;
				}
				await log(JSON.stringify({ type: "done", filePath: zipPath, filename: `${destName}.zip` }));
				return;
			}

			await log(JSON.stringify({ type: "done", filePath: exportedPath, filename: destName }));
		})();

		return { error: null };
	},

	readExportLog: async ({ outputPath, runId }: { outputPath: string; runId: string }) => {
		return { lines: await readLogFile(join(exp(outputPath), `export-${runId}.log`)) };
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
};
