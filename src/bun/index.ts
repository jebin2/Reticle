import Electrobun, { BrowserWindow, defineElectrobunRPC, Screen } from "electrobun/bun";
import { randomBytes } from "crypto";
import { runningProcesses } from "./util";
import { assetHandlers }    from "./handlers/assets";
import { trainingHandlers } from "./handlers/training";
import { inferenceHandlers } from "./handlers/inference";
import { exportHandlers }   from "./handlers/export";
import { hubHandlers }      from "./handlers/hub";

// ── Binary bridge ─────────────────────────────────────────────────────────────
// Serves image files to the renderer by path, avoiding base64 encoding.

const securityToken = randomBytes(32).toString("hex");

const server = Bun.serve({
	port: 0,
	async fetch(req) {
		const headers = new Headers({ "Access-Control-Allow-Origin": "*" });
		const url     = new URL(req.url);
		if (url.searchParams.get("token") !== securityToken)
			return new Response("Unauthorized", { status: 401, headers });
		const filePath = url.searchParams.get("path");
		if (!filePath) return new Response("Missing path", { status: 400, headers });
		const file = Bun.file(filePath);
		if (!(await file.exists())) return new Response("Not found", { status: 404, headers });
		return new Response(file, { headers });
	},
});

// ── RPC ───────────────────────────────────────────────────────────────────────

const rpc = defineElectrobunRPC("bun", {
	maxRequestTime: Infinity,
	handlers: {
		requests: {
			getBridgeConfig: async () => ({ port: server.port, token: securityToken }),
			...assetHandlers,
			...trainingHandlers,
			...inferenceHandlers,
			...exportHandlers,
			...hubHandlers,
		} as Record<string, (params?: unknown) => unknown>,
	},
});

// ── Window ────────────────────────────────────────────────────────────────────

const { x, y, width, height } = Screen.getPrimaryDisplay().workArea;
new BrowserWindow({
	title: "Reticle",
	url:   "views://mainview/index.html",
	frame: { x, y, width, height },
	rpc,
});

console.log(`Reticle started - bridge on port ${server.port}`);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function killAll() {
	for (const [, proc] of runningProcesses) {
		try { proc.kill(9); } catch {}
	}
	runningProcesses.clear();
}

Electrobun.events.on("before-quit", () => killAll());
process.on("SIGTERM", () => { killAll(); process.exit(0); });
process.on("SIGINT",  () => { killAll(); process.exit(0); });
process.on("exit",    () => killAll());
