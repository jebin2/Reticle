import { useState, useEffect, useRef } from "react";
import { ImagePlus, FolderOpen } from "lucide-react";
import { type ImageEntry } from "../lib/annotationTypes";
import { loadImageSrc } from "../lib/imageLoader";
import { useImagePicker } from "../lib/useImagePicker";

interface Props {
  images: ImageEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onAddImages: (entries: ImageEntry[]) => void;
}

export default function ImageList({ images, currentIndex, onSelect, onAddImages }: Props) {
  const { openImages, openFolder, loading: adding } = useImagePicker(onAddImages);

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
        <HeaderIconButton Icon={ImagePlus} title="Add images"  disabled={adding} onClick={openImages} />
        <HeaderIconButton Icon={FolderOpen} title="Add folder" disabled={adding} onClick={openFolder} />
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
                <LazyThumbnail entry={img} />
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

// Fetches the thumbnail only while it is visible in the scroll panel.
// An IntersectionObserver triggers the fetch on scroll-into-view and revokes
// the blob URL on scroll-out, keeping memory proportional to visible items.
function LazyThumbnail({ entry }: { entry: ImageEntry }) {
  const [src, setSrc] = useState(entry.src);
  const containerRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Data URLs (drag-drop before file copy completes) — use directly, no observer needed.
    if (entry.src) { setSrc(entry.src); return; }
    if (!entry.filePath || !containerRef.current) return;

    let blobUrl: string | null = null;
    let fetchCanceled = false;

    function load() {
      if (blobUrl || fetchCanceled) return;
      loadImageSrc(entry).then(resolved => {
        if (fetchCanceled) { URL.revokeObjectURL(resolved); return; }
        blobUrl = resolved;
        setSrc(resolved);
      }).catch(() => {});
    }

    function unload() {
      if (!blobUrl) return;
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
      setSrc("");
    }

    const observer = new IntersectionObserver(
      ([e]) => { e.isIntersecting ? load() : unload(); },
      { threshold: 0 },
    );
    observer.observe(containerRef.current);

    return () => {
      fetchCanceled = true;
      observer.disconnect();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [entry.id, entry.filePath, entry.src]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: 76 }}>
      {src
        ? <img src={src} alt={entry.filename} style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", height: 76, background: "var(--surface-2)" }} />
      }
    </div>
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
