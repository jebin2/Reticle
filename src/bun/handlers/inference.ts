import { join } from "path";
import { YOLO_DIR, INFER_SCRIPT, runInference as runInferenceUtil, modelPath as getModelPath, fileExists } from "../util";
import { exp } from "../common";

export const inferenceHandlers = {
	runInference: async ({ imagePath, outputPath, confidence }: {
		imagePath: string; outputPath: string; confidence: number;
	}) => {
		const weights = getModelPath(exp(outputPath));
		if (!(await fileExists(weights)))
			return { detections: [], inferenceMs: 0, error: "Model weights not found." };
		return runInferenceUtil(
			exp(imagePath), weights, confidence,
			INFER_SCRIPT,
			join(YOLO_DIR, "infer-setup.log"),
			"inference",
		);
	},
};
