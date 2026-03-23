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
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css":  "views/mainview/index.css",
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;
