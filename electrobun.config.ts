import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "YOLOStudio",
		identifier: "yolostudio.app",
		version: "0.1.0",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/main.tsx",
			},
		},
		copy: {
			"src/mainview/index.html":              "views/mainview/index.html",
			"src/mainview/index.css":               "views/mainview/index.css",
			"src/python/train.py":                  "python/train.py",
			"src/python/infer.py":                  "python/infer.py",
			"src/python/export.py":                 "python/export.py",
			"src/python/cli.py":                    "python/cli.py",
			"src/bun/cli.ts":                       "bun/cli.ts",
			"src/bun/util.ts":                      "bun/util.ts",
			// Standalone Python runtime bundled at build time (download-python.ts).
			// Extracted to ~/.yolostudio/python-runtime on first training run.
			"src/python/python-runtime.tar.gz":     "python/python-runtime.tar.gz",
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;
