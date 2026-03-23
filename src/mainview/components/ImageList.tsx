import { useState, useEffect } from "react";
import { ImagePlus, FolderOpen } from "lucide-react";
import { type ImageEntry } from "../lib/annotationTypes";
import { getRPC } from "../lib/rpc";
import { pathsToImageEntries, loadImageSrc } from "../lib/imageLoader";

interface Props {
  images: ImageEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onAddImages: (entries: ImageEntry[]) => void;
  // Called when a lazy image src has been resolved so the parent can cache it
  onSrcResolved: (id: string, src: string) => void;
}

export default function ImageList({ images, currentIndex, onSelect, onAddImages, onSrcResolved }: Props) {
  const [adding, setAdding] = useState(false);

  async function addFromImages() {
    setAdding(true);
    try {
      const { canceled, paths } = await getRPC().request.openImagesDialog({});
      if (!canceled && paths.length > 0) onAddImages(pathsToImageEntries(paths));
    } finally {
      setAdding(false);
    }
  }

  async function addFromFolder() {
    setAdding(true);
    try {
      const { canceled, paths } = await getRPC().request.openFolderDialog({});
      if (!canceled && paths.length > 0) onAddImages(pathsToImageEntries(paths));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{
      width: 160, minWidth: 160,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 8px 8px 12px",
        borderBottom: "1px solid var(--border)",
        fontSize: 10, fontWeight: 700,
        color: "var(--text-muted)",
        letterSpacing: "0.08em", textTransform: "uppercase",
        display: "flex", alignItems: "center",
      }}>
        <span style={{ flex: 1 }}>Dataset Images</span>
        <span style={{ fontWeight: 400, marginRight: 6 }}>{images.length}</span>
        <HeaderIconButton Icon={ImagePlus} title="Add images"  disabled={adding} onClick={addFromImages} />
        <HeaderIconButton Icon={FolderOpen} title="Add folder" disabled={adding} onClick={addFromFolder} />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
        {images.map((img, i) => {
          const active         = i === currentIndex;
          const hasAnnotations = img.annotations.length > 0;
          return (
            <div
              key={img.id}
              onClick={() => onSelect(i)}
              style={{
                marginBottom: 4, borderRadius: 6, overflow: "hidden",
                cursor: "pointer",
                border: active ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                opacity: hasAnnotations ? 1 : 0.5,
                transition: "opacity 0.15s, border-color 0.15s",
              }}
            >
              <div style={{ position: "relative" }}>
                <LazyThumbnail entry={img} onSrcResolved={onSrcResolved} />
                {hasAnnotations && (
                  <div style={{
                    position: "absolute", top: 4, right: 4,
                    background: "rgba(0,0,0,0.7)", color: "#fff",
                    fontSize: 10, fontWeight: 600, padding: "2px 5px", borderRadius: 3,
                  }}>
                    {img.annotations.length}
                  </div>
                )}
                {img.flagged && (
                  <div style={{
                    position: "absolute", top: 4, left: 4,
                    background: "#EF4444", width: 6, height: 6, borderRadius: "50%",
                  }} />
                )}
              </div>
              <div style={{
                padding: "4px 6px",
                background: active ? "rgba(59,130,246,0.08)" : "var(--surface-2)",
                fontSize: 10, color: active ? "var(--accent)" : "var(--text-muted)",
                fontWeight: active ? 600 : 400,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {img.filename}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Loads the image src lazily when this component mounts.
// Once resolved, propagates the blob URL up so the parent can persist it.
function LazyThumbnail({ entry, onSrcResolved }: {
  entry: ImageEntry;
  onSrcResolved: (id: string, src: string) => void;
}) {
  const [src, setSrc] = useState(entry.src);

  useEffect(() => {
    if (entry.src) { setSrc(entry.src); return; }
    if (!entry.filePath) return;
    loadImageSrc(entry)
      .then(resolved => {
        setSrc(resolved);
        onSrcResolved(entry.id, resolved);
      })
      .catch(() => {}); // broken image shown on failure
  }, [entry.id, entry.filePath, entry.src]);

  if (!src) {
    return <div style={{ width: "100%", height: 76, background: "var(--surface-2)" }} />;
  }
  return (
    <img src={src} alt={entry.filename} style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }} />
  );
}

function HeaderIconButton({ Icon, title, disabled, onClick }: {
  Icon: React.ElementType;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: "none", border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "var(--border)" : "var(--text-muted)",
        padding: "2px 3px", display: "flex", alignItems: "center", borderRadius: 4,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
    >
      <Icon size={12} />
    </button>
  );
}
