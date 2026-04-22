import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Nab",
		identifier: "nab.app",
		version: "0.1.0",
		icon: "resources/icon_transparent.png",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		win: {
			icon: "resources/icon_transparent.ico",
		},
		linux: {
			icon: "resources/icon_transparent.png",
		},
		mac: {
			icons: "resources/icon.iconset",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/main.tsx",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"resources/icon_transparent.png": "views/mainview/icon.png",
			"src/python/train.py": "python/train.py",
			"src/python/infer.py": "python/infer.py",
			"src/python/export.py": "python/export.py",
			"src/python/yolo_utils.py": "python/yolo_utils.py",
			"src/python/cli.py": "python/cli.py",
			"src/python/push_to_hub.py": "python/push_to_hub.py",
			"src/python/logger.py": "python/logger.py",
			"src/bun/cli.ts": "bun/cli.ts",
			"src/bun/util.ts": "bun/util.ts",
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;
