import Modal from "./Modal";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Metric({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0, marginTop: 3 }} />
      <div><span style={{ fontWeight: 600, color: "var(--text)" }}>{name}</span> - {desc}</div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

export default function TrainingMetricsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal width={520} maxHeight="85vh" zIndex={1000} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Understanding Your Training Metrics</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, padding: 0 }}>x</button>
      </div>

      <Section title="Loss Curves - Lower is Better">
        <p>Loss measures how wrong the model is. All three curves should steadily fall and flatten as training progresses.</p>
        <Metric color="#F97316" name="Box Loss" desc="How accurately the model places bounding boxes around objects. High early on - drops fast." />
        <Metric color="#22C55E" name="Cls Loss" desc="How confidently the model identifies the correct class (e.g. car vs. truck). Drops steadily with more examples." />
        <Metric color="#A78BFA" name="Dfl Loss" desc="Distribution Focal Loss - fine-tunes box edge sharpness. Usually the smallest of the three." />
        <Callout>A healthy run looks like a smooth downward curve that levels off near the end. Spiky or rising loss usually means your learning rate is too high, or your dataset has noisy labels.</Callout>
      </Section>

      <Section title="Accuracy Metrics - Higher is Better">
        <Metric color="var(--accent)" name="mAP @ .50" desc="Mean Average Precision at 50% overlap. The main score: 0 = useless, 1 = perfect. Aim for >0.70 for reliable detection." />
        <Metric color="var(--accent)" name="mAP @ .50:.95" desc="Stricter score averaged across overlap thresholds 50%-95%. More demanding - good models score 0.40-0.60+." />
        <Metric color="var(--accent)" name="Precision" desc="Of all detections made, what fraction were correct? High precision means few false alarms." />
        <Metric color="var(--accent)" name="Recall" desc="Of all real objects, what fraction did the model find? High recall means few missed detections." />
        <Callout>Precision and recall trade off against each other. A good model balances both above 0.80.</Callout>
      </Section>

      <Section title="Dataset Size Guidelines">
        <p>YOLO learns by seeing many examples. Small datasets lead to overfitting - the model memorises training images but fails on new ones.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <Row label="< 50 images" value="Too few - expect poor results" color="#EF4444" />
          <Row label="50-200 images" value="Borderline - use data augmentation" color="#F59E0B" />
          <Row label="200-500 images" value="Good starting point" color="#22C55E" />
          <Row label="500+ images" value="Excellent - model can generalise well" color="#22C55E" />
        </div>
        <Callout>Aim for at least 50-100 annotated images per class. More diversity beats sheer quantity.</Callout>
      </Section>

      <Section title="Early Stopping">
        <p>If the model stops improving for several epochs in a row, training halts automatically. This is normal and saves time - it means the model has converged. You'll see the <span style={{ color: "#F59E0B", fontFamily: "monospace", fontWeight: 700 }}>EARLY STOP</span> badge when this happens.</p>
      </Section>
    </Modal>
  );
}
