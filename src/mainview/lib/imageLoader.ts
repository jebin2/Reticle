import { type ImageEntry } from "./annotationTypes";
import { getBridgeUrl } from "./rpc";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"]);

function fileBasename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function hasImageExt(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTS.has(name.slice(dot).toLowerCase());
}

// Convert native file-system paths (from RPC dialog) to ImageEntries.
// src is empty — loaded lazily via loadImageSrc() when the image is first displayed.
export function pathsToImageEntries(paths: string[]): ImageEntry[] {
  return paths
    .filter(p => hasImageExt(fileBasename(p)))
    .map(p => ({
      id:          crypto.randomUUID(),
      filename:    fileBasename(p),
      src:         "",  // loaded lazily — see loadImageSrc()
      filePath:    p,
      annotations: [],
    }));
}

// Fetch an image from the binary bridge and return a blob URL.
// views:// scheme cannot load http://localhost directly as <img src>, so we
// must go through fetch() first. The caller is responsible for revoking the URL
// when the entry is discarded (URL.revokeObjectURL).
export async function loadImageSrc(entry: ImageEntry): Promise<string> {
  if (entry.src) return entry.src;
  if (!entry.filePath) return "";
  const response = await fetch(getBridgeUrl(entry.filePath));
  if (!response.ok) throw new Error(`Bridge fetch failed for ${entry.filename}: ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// Convert File objects (drag-drop) to ImageEntries via FileReader → data URL.
// No file-path is available for dragged files in the WebView, so we use data URLs.
export async function filesToImageEntries(files: File[]): Promise<ImageEntry[]> {
  const images = files.filter(f => hasImageExt(f.name));
  return Promise.all(
    images.map(async file => ({
      id:          crypto.randomUUID(),
      filename:    file.name,
      src:         await readAsDataUrl(file),
      annotations: [],
    }))
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
