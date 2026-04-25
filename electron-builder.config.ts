import type { Configuration } from "electron-builder";

export default {
	appId: "nab.app",
	productName: "Nab",
	directories: {
		buildResources: "resources",
		output: "dist",
	},
	files: ["out/**"],
	extraResources: [
		{ from: "resources/app.png",  to: "app.png"  },
		{ from: "resources/app.ico",  to: "app.ico"  },
		{ from: "resources/app.icns", to: "app.icns" },
		{ from: "src/python", to: "python", filter: ["**/*.py"] },
		{ from: "src/bun/cli.ts", to: "bun/cli.ts" },
		{ from: "src/bun/util.ts", to: "bun/util.ts" },
	],
	linux: {
		icon: "resources/app.png",
		target: [{ target: "AppImage" }, { target: "tar.gz" }],
	},
	mac: {
		icon: "resources/app.icns",
		target: [{ target: "dmg" }, { target: "zip" }],
	},
	win: {
		icon: "resources/app.ico",
		target: [{ target: "nsis" }],
	},
} satisfies Configuration;
