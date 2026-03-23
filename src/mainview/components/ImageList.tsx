import { type ImageEntry } from "../lib/annotationTypes";

interface Props {
  images: ImageEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export default function ImageList({ images, currentIndex, onSelect }: Props) {
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
        padding: "10px 12px 8px",
        borderBottom: "1px solid var(--border)",
        fontSize: 10, fontWeight: 700,
        color: "var(--text-muted)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>Dataset Images</span>
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{images.length}</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
        {images.map((img, i) => {
          const active = i === currentIndex;
          const hasAnnotations = img.annotations.length > 0;
          return (
            <div
              key={img.id}
              onClick={() => onSelect(i)}
              style={{
                marginBottom: 4,
                borderRadius: 6,
                overflow: "hidden",
                cursor: "pointer",
                border: active
                  ? "1.5px solid var(--accent)"
                  : "1.5px solid transparent",
                opacity: hasAnnotations ? 1 : 0.5,
                transition: "opacity 0.15s, border-color 0.15s",
              }}
            >
              {/* Thumbnail */}
              <div style={{ position: "relative" }}>
                <img
                  src={img.src}
                  alt={img.filename}
                  style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }}
                />
                {/* annotation badge */}
                {hasAnnotations && (
                  <div style={{
                    position: "absolute", top: 4, right: 4,
                    background: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    fontSize: 10, fontWeight: 600,
                    padding: "2px 5px", borderRadius: 3,
                  }}>
                    {img.annotations.length}
                  </div>
                )}
                {/* flagged */}
                {img.flagged && (
                  <div style={{
                    position: "absolute", top: 4, left: 4,
                    background: "#EF4444",
                    width: 6, height: 6, borderRadius: "50%",
                  }} />
                )}
              </div>
              {/* filename */}
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
