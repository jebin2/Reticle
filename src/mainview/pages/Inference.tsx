import { Scan } from "lucide-react";

export default function Inference() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
      background: "var(--bg)",
    }}>
      <Scan size={32} color="var(--border)" strokeWidth={1.5} />
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Inference</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.6 }}>Coming soon — run a trained model on images or webcam</div>
    </div>
  );
}
