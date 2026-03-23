import { useState } from "react";
import { ImagePlus, FolderOpen, Loader } from "lucide-react";
import { type ImageEntry } from "../lib/annotationTypes";
import { getRPC } from "../lib/rpc";
import { pathsToImageEntries, filesToImageEntries } from "../lib/imageLoader";

interface Props {
  onLoad: (entries: ImageEntry[]) => void;
}

export default function UploadZone({ onLoad }: Props) {
  const [loading,  setLoading]  = useState(false);
  const [dragging, setDragging] = useState(false);

  async function openImagesDialog() {
    setLoading(true);
    try {
      const { canceled, paths } = await getRPC().request.openImagesDialog({});
      if (!canceled && paths.length > 0) onLoad(pathsToImageEntries(paths));
    } finally {
      setLoading(false);
    }
  }

  async function openFolderDialog() {
    setLoading(true);
    try {
      const { canceled, paths } = await getRPC().request.openFolderDialog({});
      if (!canceled && paths.length > 0) onLoad(pathsToImageEntries(paths));
    } finally {
      setLoading(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setLoading(true);
    try {
      const entries = await filesToImageEntries(Array.from(e.dataTransfer.files));
      if (entries.length > 0) onLoad(entries);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 24,
        background: dragging ? "rgba(59,130,246,0.04)" : "var(--bg)",
        border:     `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 12, margin: 32,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      {loading ? (
        <LoadingState />
      ) : (
        <>
          {/* Icon cluster */}
          <div style={{ display: "flex", gap: 12, opacity: dragging ? 1 : 0.5 }}>
            <IconTile Icon={ImagePlus} />
            <IconTile Icon={FolderOpen} />
          </div>

          {/* Label */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              {dragging ? "Drop image files here" : "Add images to start annotating"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {dragging ? "" : "JPG · PNG · WebP · BMP · GIF · TIFF"}
            </div>
          </div>

          {/* Buttons */}
          {!dragging && (
            <div style={{ display: "flex", gap: 10 }}>
              <UploadButton Icon={ImagePlus} label="Select Images" onClick={openImagesDialog} />
              <UploadButton Icon={FolderOpen} label="Select Folder" onClick={openFolderDialog} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <Loader size={28} color="var(--accent)" style={{ animation: "spin 1s linear infinite" }} />
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading images…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function IconTile({ Icon }: { Icon: React.ElementType }) {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 12,
      background: "var(--surface)", border: "1px solid var(--border)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <Icon size={22} color="var(--accent)" />
    </div>
  );
}

function UploadButton({ Icon, label, onClick }: {
  Icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "8px 16px", borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--surface)", color: "var(--text)",
        fontSize: 13, fontWeight: 500,
        cursor: "pointer", fontFamily: "inherit",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = "var(--accent)";
        el.style.color       = "var(--accent)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = "var(--border)";
        el.style.color       = "var(--text)";
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
