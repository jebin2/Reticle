import { Upload } from "lucide-react";

export default function Export() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
      background: "var(--bg)",
    }}>
      <Upload size={32} color="var(--border)" strokeWidth={1.5} />
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Export</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.6 }}>Coming soon — export trained models to ONNX, CoreML, TFLite, TensorRT</div>
    </div>
  );
}
