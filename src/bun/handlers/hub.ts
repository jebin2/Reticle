import { spawn } from "child_process";
import { mkdir, appendFile } from "fs/promises";
import { join } from "path";
import {
	HUB_LOGS_DIR, PUSH_SCRIPT, VENV_PYTHON,
	prepareEnvironment, streamProcessOutput, coalescePipProgress,
	runWithPTY, modelPath as getModelPath, safeName,
} from "../util";
import { exp, readLogFile } from "../common";

export const hubHandlers = {
	startHubPush: async ({ outputPath, repoId, token, runName }: {
		outputPath: string; repoId: string; token: string; runName: string;
	}) => {
		const jobId   = crypto.randomUUID();
		const logPath = join(HUB_LOGS_DIR, `${jobId}.log`);
		await mkdir(HUB_LOGS_DIR, { recursive: true });

		(async () => {
			const log = (line: string) => appendFile(logPath, line + "\n").catch(console.error);
			try {
				await prepareEnvironment(logPath, jobId);
			} catch (err) {
				await log(JSON.stringify({ type: "error", message: `Environment setup failed: ${(err as Error).message}` }));
				return;
			}
			await log(JSON.stringify({ type: "progress", text: "Checking huggingface_hub package..." }));
			const pipLogger = coalescePipProgress(async (text: string) => log(JSON.stringify({ type: "stderr", text })));
			const { exitCode: pipExit } = await runWithPTY(
				[VENV_PYTHON, "-m", "pip", "install", "--progress-bar", "raw", "huggingface_hub"],
				{ stdoutHandler: pipLogger, stderrHandler: pipLogger },
			);
			if (pipExit !== 0) {
				await log(JSON.stringify({ type: "error", message: "Failed to install huggingface_hub package." }));
				return;
			}
			const proc = spawn(VENV_PYTHON, [PUSH_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
			const safe = safeName(runName);
			proc.stdin?.write(JSON.stringify({ modelPath: getModelPath(exp(outputPath)), repoId, token, fileName: `${safe}.pt` }), "utf-8");
			proc.stdin?.end();
			await streamProcessOutput(proc, {
				stdoutHandler: line => log(line),
				stderrHandler: text => log(JSON.stringify({ type: "stderr", text })),
			});
		})();

		return { jobId };
	},

	readHubLog: async ({ jobId }: { jobId: string }) => {
		return { lines: await readLogFile(join(HUB_LOGS_DIR, `${jobId}.log`)) };
	},
};
