import { useState, useMemo } from "react";
import { FolderOpen } from "lucide-react";
import Modal from "./Modal";
import { Field, NumField, inputStyle } from "./FormFields";
import CustomSelect from "./CustomSelect";
import { type TrainingRun, type Asset } from "../lib/types";
import { BASE_MODELS_SEG, BASE_MODELS_DET, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

const DEFAULT_EPOCHS = 100;
const DEFAULT_BATCH  = 16;
const DEFAULT_IMGSZ  = 640;
const DEFAULT_DEVICE = "auto";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onClose: () => void;
  onCreate: (run: TrainingRun) => void;
}

export default function NewRunModal({ assets, runs, onClose, onCreate }: Props) {
  const [name, setName]             = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [baseModel, setBaseModel]   = useState(BASE_MODELS_SEG[0]);
  const [epochs, setEpochs]         = useState(DEFAULT_EPOCHS);
  const [batchSize, setBatchSize]   = useState(DEFAULT_BATCH);
  const [imgsz, setImgsz]           = useState(DEFAULT_IMGSZ);
  const [device, setDevice]         = useState(DEFAULT_DEVICE);
  const [baseFolder, setBaseFolder] = useState("~/.reticle/runs");
  const [picking, setPicking]       = useState(false);

  const nameConflict = name.trim()
    ? [...runs.map(r => r.name), ...assets.map(a => a.name)]
        .some(n => n.toLowerCase() === name.trim().toLowerCase())
    : false;

  const slug       = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const outputPath = slug ? `${baseFolder}/${slug}` : "";

  const classMap = useMemo(() => [...new Map(
    assets.filter(a => selectedAssets.includes(a.id)).flatMap(a => a.classes).map(c => [c, c])
  ).keys()], [assets, selectedAssets]);

  // Determine annotation mode from selected assets.
  // "seg"     — all selected assets have polygons
  // "det"     — all selected assets are bbox-only (hasPolygons === false)
  // "mixed"   — some bbox-only, some polygon (known types differ)
  // "unknown" — at least one asset has hasPolygons undefined (annotated before tracking)
  const annotationMode = useMemo<"seg" | "det" | "mixed" | "unknown">(() => {
    const sel = assets.filter(a => selectedAssets.includes(a.id) && a.annotatedCount > 0);
    if (sel.length === 0) return "unknown";
    const hasUnknown = sel.some(a => a.hasPolygons === undefined);
    if (hasUnknown) return "unknown";
    const anyPoly = sel.some(a => a.hasPolygons === true);
    const anyDet  = sel.some(a => a.hasPolygons === false);
    if (anyPoly && anyDet) return "mixed";
    return anyPoly ? "seg" : "det";
  }, [assets, selectedAssets]);

  // Models available for the current mode. In mixed/unknown the user chooses.
  const [mixedChoice, setMixedChoice] = useState<"seg" | "det">("seg");
  const availableModels = useMemo(() => {
    if (annotationMode === "seg") return BASE_MODELS_SEG;
    if (annotationMode === "det") return BASE_MODELS_DET;
    return mixedChoice === "seg" ? BASE_MODELS_SEG : BASE_MODELS_DET;
  }, [annotationMode, mixedChoice]);

  // Keep baseModel in sync when the available list changes.
  useMemo(() => {
    if (!availableModels.includes(baseModel)) setBaseModel(availableModels[0]);
  }, [availableModels]);

  function toggleAsset(id: string) {
    setSelectedAssets(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!nameEdited) {
        const first = assets.find(a => a.id === next[0]);
        setName(first ? `${first.name.toLowerCase().replace(/\s+/g, "-")}-${baseModel}-v1` : "");
      }
      return next;
    });
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, path } = await getRPC().request.openFolderPathDialog({});
      if (!canceled && path) setBaseFolder(path);
    } finally {
      setPicking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outputPath || selectedAssets.length === 0 || nameConflict) return;
    onCreate({ id: crypto.randomUUID(), name: name.trim(), assetIds: selectedAssets, classMap, baseModel, epochs, batchSize, imgsz, device, outputPath, status: "idle", updatedAt: "just now" });
  }

  const valid = outputPath && selectedAssets.length > 0 && !nameConflict;

  return (
    <Modal width={500} maxHeight="90vh" onClose={onClose}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>New Training Run</h2>

      {assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
          No assets yet. Create and annotate an asset first.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <Field label="Run Name">
            <input
              autoFocus value={name}
              onChange={e => { setName(e.target.value); setNameEdited(true); }}
              placeholder="e.g. vehicles-yolo26n-v1"
              style={{ ...inputStyle, fontFamily: "monospace", borderColor: nameConflict ? "#EF4444" : undefined }}
            />
            {nameConflict && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>Name already used by a run or asset.</div>}
          </Field>

          <Field label="Assets">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {assets.map(a => {
                const selected = selectedAssets.includes(a.id);
                const ready    = a.annotatedCount > 0;
                return (
                  <div
                    key={a.id}
                    onClick={() => ready && toggleAsset(a.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: ready ? "pointer" : "default", border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)", transition: "border-color 0.12s, background 0.12s", opacity: ready ? 1 : 0.5 }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s, border-color 0.15s" }}>
                      {selected && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {a.annotatedCount}/{a.imageCount} annotated · {a.classes.length} classes
                        {!ready && <span style={{ color: "#EF4444", marginLeft: 6 }}>— no annotations</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          {classMap.length > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Merged class map · {classMap.length} classes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {classMap.map((cls, i) => (
                  <span key={cls} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: CLASS_COLORS[i % CLASS_COLORS.length] + "22", color: CLASS_COLORS[i % CLASS_COLORS.length], border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`, fontFamily: "monospace" }}>
                    {i}: {cls}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Annotation mode notice — shown when mode is ambiguous or mixed */}
          {(annotationMode === "mixed" || annotationMode === "unknown") && selectedAssets.length > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#F59E0B", marginBottom: 6 }}>
                {annotationMode === "mixed"
                  ? "Mixed annotation types detected"
                  : "Annotation type unknown"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                {annotationMode === "mixed"
                  ? "Some assets use bounding boxes only, others have polygon annotations. Choose which model type to train:"
                  : "Some assets were annotated before polygon tracking was added. Choose which model type matches your annotations:"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["seg", "det"] as const).map(choice => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => { setMixedChoice(choice); }}
                    style={{
                      padding: "5px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                      border: `1px solid ${mixedChoice === choice ? "#F59E0B" : "var(--border)"}`,
                      background: mixedChoice === choice ? "rgba(245,158,11,0.15)" : "var(--bg)",
                      color: mixedChoice === choice ? "#F59E0B" : "var(--text-muted)",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {choice === "seg" ? "Segmentation (polygon)" : "Detection (bbox only)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Annotation mode badge — shown when mode is unambiguous */}
          {(annotationMode === "seg" || annotationMode === "det") && selectedAssets.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border)", width: "fit-content" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: annotationMode === "seg" ? "#A855F7" : "#3B82F6", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {annotationMode === "seg" ? "Segmentation dataset — using seg models" : "Detection dataset — using detection models"}
              </span>
            </div>
          )}

          <Field label="Base Model">
            <CustomSelect value={baseModel} options={availableModels} onChange={setBaseModel} />
          </Field>

          <Field label="Hyperparameters">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumField label="Epochs"     value={epochs}    min={1}  max={10000} onChange={setEpochs} />
              <NumField label="Batch Size" value={batchSize} min={-1} max={1024}  onChange={setBatchSize} hint="-1 = auto" />
              <NumField label="Image Size" value={imgsz}     min={32} max={1280}  onChange={setImgsz} />
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Device</div>
                <CustomSelect value={device} options={DEVICES} onChange={setDevice} />
              </div>
            </div>
          </Field>

          <Field label="Output Folder">
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{baseFolder}</div>
              <button type="button" onClick={pickFolder} disabled={picking} style={{ padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: picking ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <FolderOpen size={13} /> Browse
              </button>
            </div>
            {slug && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginTop: 5 }}>→ {outputPath}</div>}
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="submit" disabled={!valid} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "none", background: valid ? "var(--accent)" : "var(--border)", color: valid ? "#fff" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Create Run</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
