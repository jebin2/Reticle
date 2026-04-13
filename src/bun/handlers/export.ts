import { mkdir, copyFile, cp, rm, mkdtemp, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { homedir, tmpdir } from "os";
import {
	INFER_SCRIPT, YOLO_UTILS_SCRIPT, EXPORT_SCRIPT, VENV_PYTHON,
	runningProcesses, runProcess, modelPath as getModelPath, streamProcessOutput,
} from "../util";
import { exp } from "../common";

// Paths to CLI source files — copied into the compile temp dir.
const CLI_ENTRY  = join(import.meta.dir, "../cli.ts");
const UTIL_ENTRY = join(import.meta.dir, "../util.ts");

async function buildCLIArtifact(modelPath: string, outBinary: string, runId: string): Promise<string | null> {
	const buildDir = await mkdtemp(join(tmpdir(), "reticle-cli-"));
	let stderr = "";

	try {
		await copyFile(CLI_ENTRY, join(buildDir, "cli.ts"));
		await copyFile(UTIL_ENTRY, join(buildDir, "util.ts"));
		await copyFile(modelPath, join(buildDir, "model.pt"));
		await copyFile(INFER_SCRIPT, join(buildDir, "infer.py"));
		await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

		const proc = Bun.spawn(
			[process.execPath, "build", "--compile", "--minify", "--bytecode", join(buildDir, "cli.ts"), "--outfile", outBinary],
			{ stdout: "pipe", stderr: "pipe" },
		);
		runningProcesses.set(runId, proc);
		try {
			await streamProcessOutput(proc, {
				stderrHandler: async line => { stderr += line + "\n"; },
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) return stderr.trim().split("\n").pop() ?? "Unknown build failure";
			return null;
		} finally {
			runningProcesses.delete(runId);
		}
	} finally {
		await rm(buildDir, { recursive: true, force: true }).catch(() => {});
	}
}

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

	buildAndDownloadCLI: async ({ outputPath, runName, runId }: {
		outputPath: string; runName: string; runId: string;
	}) => {
		const modelPath = getModelPath(exp(outputPath));
		if (!(await Bun.file(modelPath).exists()))
			return { filePath: "", filename: "", error: "Model weights not found." };

		const safeName   = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
		const binaryName = `${safeName}-cli${process.platform === "win32" ? ".exe" : ""}`;
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

		const safeName  = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
		const outBinary = join(destDir, `${safeName}-detect${process.platform === "win32" ? ".exe" : ""}`);
		const buildError = await buildCLIArtifact(modelPath, outBinary, runId);
		if (buildError) return { bundlePath: "", error: `Compile failed: ${buildError}` };

		return { bundlePath: outBinary, error: null };
	},

	cancelExport: async ({ runId }: { runId: string }) => {
		const proc = runningProcesses.get(runId);
		if (proc) { proc.kill(9); runningProcesses.delete(runId); }
		return {};
	},

	downloadExport: async ({ outputPath, format, runName, runId }: {
		outputPath: string; format: string; runName: string; runId: string;
	}) => {
		const modelPath = getModelPath(exp(outputPath));
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
			pt: ".pt", onnx: ".onnx", tflite: ".tflite", coreml: "", openvino: "",
		};
		const safeName = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
		const ext      = FORMAT_EXT[format] ?? extname(exportedPath);
		const destName = ext ? `${safeName}${ext}` : `${safeName}_${format}`;

		const srcStat = await stat(exportedPath);
		if (srcStat.isDirectory()) {
			const parent   = dirname(exportedPath);
			const dirName  = basename(exportedPath);
			const zipPath  = join(parent, `${dirName}.zip`);
			const proc     = Bun.spawn(["zip", "-r", "-q", zipPath, dirName], { cwd: parent, stdout: "pipe", stderr: "pipe" });
			runningProcesses.set(runId, proc);
			const exitCode = await proc.exited;
			runningProcesses.delete(runId);
			if (exitCode !== 0) return { filePath: "", filename: "", error: "Failed to create zip archive for export." };
			return { filePath: zipPath, filename: `${destName}.zip`, error: null };
		}

		return { filePath: exportedPath, filename: destName, error: null };
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
