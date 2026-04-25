import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/electron/main.ts") },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/electron/preload.ts") },
			},
		},
	},
	renderer: {
		root: "src/mainview",
		publicDir: resolve(__dirname, "resources"),
		plugins: [react()],
		optimizeDeps: {
			include: ["react", "react-dom", "react-dom/client", "lucide-react"],
		},
		build: {
			rollupOptions: {
				input: {
					index:  resolve(__dirname, "src/mainview/index.html"),
					splash: resolve(__dirname, "src/mainview/splash.html"),
				},
			},
		},
	},
});
