import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from "electron";
import { randomBytes } from "crypto";
import { createServer } from "http";
import { createReadStream, existsSync } from "fs";
import { extname, join } from "path";
import { runningProcesses } from "../bun/util";
import { assetHandlers } from "../bun/handlers/assets";
import { trainingHandlers } from "../bun/handlers/training";
import { inferenceHandlers } from "../bun/handlers/inference";
import { exportHandlers } from "../bun/handlers/export";
import { hubHandlers } from "../bun/handlers/hub";

// ── Startup optimisations ─────────────────────────────────────────────────────

app.commandLine.appendSwitch("disable-features",
	"HardwareMediaKeyHandling,MediaSessionService,Translate,AutofillServerCommunication");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-client-side-phishing-detection");
app.commandLine.appendSwitch("disable-hang-monitor");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("no-default-browser-check");
app.commandLine.appendSwitch("metrics-recording-only");
app.commandLine.appendSwitch("safebrowsing-disable-auto-update");

// ── Single-instance lock ──────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

// ── Binary bridge ─────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
	".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".png": "image/png",  ".webp": "image/webp",
	".bmp": "image/bmp",  ".gif":  "image/gif",
	".tiff": "image/tiff", ".tif": "image/tiff",
};

const securityToken = randomBytes(32).toString("hex");

const server = createServer((req, res) => {
	const cors = { "Access-Control-Allow-Origin": "*" };
	const url  = new URL(req.url!, "http://localhost");
	if (url.searchParams.get("token") !== securityToken) {
		res.writeHead(401, cors); res.end("Unauthorized"); return;
	}
	const filePath = url.searchParams.get("path");
	if (!filePath) { res.writeHead(400, cors); res.end("Missing path"); return; }
	if (!existsSync(filePath)) { res.writeHead(404, cors); res.end("Not found"); return; }
	const mime = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
	res.writeHead(200, { ...cors, "Content-Type": mime });
	createReadStream(filePath).pipe(res);
});
server.listen(0);

// ── IPC handlers ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allHandlers: Record<string, (params?: any) => unknown> = {
	getBridgeConfig: async () => ({
		port:      (server.address() as { port: number }).port,
		token:     securityToken,
		isWindows: process.platform === "win32",
	}),
	...assetHandlers,
	...trainingHandlers,
	...inferenceHandlers,
	...exportHandlers,
	...hubHandlers,
};

for (const [channel, handler] of Object.entries(allHandlers)) {
	ipcMain.handle(channel, (_event, params) => handler(params));
}

// ── Windows ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const resourcesPath = app.isPackaged
	? process.resourcesPath
	: join(app.getAppPath(), "resources");

function createSplash(): BrowserWindow {
	const splash = new BrowserWindow({
		width:           320,
		height:          320,
		frame:           false,
		resizable:       false,
		center:          true,
		transparent:     true,
		webPreferences:  { nodeIntegration: false, contextIsolation: true },
	});

	if (process.env["ELECTRON_RENDERER_URL"]) {
		splash.loadURL(new URL("/splash.html", process.env["ELECTRON_RENDERER_URL"]).href);
	} else {
		splash.loadFile(join(__dirname, "../renderer/splash.html"));
	}

	return splash;
}

function createMainWindow(splash: BrowserWindow): BrowserWindow {
	const win = new BrowserWindow({
		title:           "Nab",
		show:            false,
		backgroundColor: "#0F0F0F",
		icon:            join(resourcesPath, "app.png"),
		webPreferences:  {
			preload:          join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration:  false,
		},
	});

	if (process.env["ELECTRON_RENDERER_URL"]) {
		win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		win.loadFile(join(__dirname, "../renderer/index.html"));
	}

	// When the main app is ready: maximise + show it, then close the splash.
	let revealed = false;
	const reveal = () => {
		if (revealed) return;
		revealed = true;
		win.maximize();
		win.show();
		if (!splash.isDestroyed()) splash.close();
	};

	win.once("ready-to-show", reveal);
	// Failsafe: if ready-to-show never fires (e.g. very slow machine), show after 8 s.
	setTimeout(reveal, 8000);

	win.on("close", (e) => {
		if (!isQuitting) { e.preventDefault(); win.hide(); }
	});

	return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
	const splash = createSplash();
	mainWindow    = createMainWindow(splash);

	app.on("second-instance", () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	});

	app.on("activate", () => {
		if (!mainWindow || mainWindow.isDestroyed()) {
			const s = createSplash();
			mainWindow = createMainWindow(s);
		} else {
			mainWindow.show();
		}
	});

	try {
		tray = new Tray(nativeImage.createFromPath(join(resourcesPath, "app.png")));
		tray.setToolTip("Nab");
		tray.setContextMenu(Menu.buildFromTemplate([
			{ label: "Open Nab", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
			{ type:  "separator" },
			{ label: "Quit",     click: () => { isQuitting = true; app.quit(); } },
		]));
		tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
	} catch {
		// Tray not supported on all Linux DEs.
	}
});

app.on("window-all-closed", () => { /* keep process alive */ });

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function killAll(): void {
	for (const [, proc] of runningProcesses) {
		try { proc.kill(9); } catch {}
	}
	runningProcesses.clear();
}

app.on("before-quit", () => { isQuitting = true; killAll(); });
process.on("SIGTERM", () => { killAll(); process.exit(0); });
process.on("SIGINT",  () => { killAll(); process.exit(0); });
process.on("exit",    () => killAll());
