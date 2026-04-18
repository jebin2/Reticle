import { useState } from "react";
import { BASE_MODELS_DET, BASE_MODELS_SEG } from "../lib/constants";
import Modal from "./Modal";

export interface DatasetUpdateMeta {
  found: boolean;
  classMap: string[];
  imageCount: number;
  hasPolygons: boolean;
  currentHasPolygons: boolean;
  hasPolygonsChanged: boolean;
  newCount: number;
  deletedCount: number;
  modifiedCount: number;
  hasDrift: boolean;
}

interface Props {
  runMeta: DatasetUpdateMeta;
  currentBaseModel: string;
  updating: boolean;
  onConfirm: (newBaseModel: string | null) => void;
  onCancel: () => void;
}

export default function DatasetUpdateModal({ runMeta, currentBaseModel, updating, onConfirm, onCancel }: Props) {
  const changes: string[] = [];
  if (runMeta.newCount > 0) changes.push(`+${runMeta.newCount} new image${runMeta.newCount > 1 ? "s" : ""}`);
  if (runMeta.deletedCount > 0) changes.push(`-${runMeta.deletedCount} deleted image${runMeta.deletedCount > 1 ? "s" : ""}`);
  if (runMeta.modifiedCount > 0) changes.push(`${runMeta.modifiedCount} modified label${runMeta.modifiedCount > 1 ? "s" : ""}`);

  const polyFrom = runMeta.hasPolygons ? "segmentation" : "detection";
  const polyTo = runMeta.currentHasPolygons ? "segmentation" : "detection";
  const newModels = runMeta.currentHasPolygons ? BASE_MODELS_SEG : BASE_MODELS_DET;
  const sizeIndex = (runMeta.currentHasPolygons ? BASE_MODELS_DET : BASE_MODELS_SEG).indexOf(currentBaseModel);
  const [selectedModel, setSelectedModel] = useState(newModels[sizeIndex >= 0 ? sizeIndex : 0]);

  return (
    <Modal width={420} zIndex={1000} onClose={updating ? () => {} : onCancel}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Update Dataset</div>

        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          The following changes have been detected in your asset folders:
        </div>

        <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
          {changes.map(change => (
            <div key={change} style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)" }}>{change}</div>
          ))}
          {changes.length === 0 && runMeta.hasPolygonsChanged && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>annotation type changed</div>
          )}
        </div>

        {runMeta.hasPolygonsChanged && (
          <div style={{ padding: "12px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 2 }}>Annotation type changed</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                Dataset was <strong>{polyFrom}</strong>, annotations are now <strong>{polyTo}</strong>.
                Select the model to use for future runs:
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {newModels.map(model => (
                <label
                  key={model}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: selectedModel === model ? "rgba(59,130,246,0.12)" : "transparent", border: `1px solid ${selectedModel === model ? "rgba(59,130,246,0.4)" : "transparent"}` }}
                >
                  <input
                    type="radio"
                    name="newModel"
                    value={model}
                    checked={selectedModel === model}
                    onChange={() => setSelectedModel(model)}
                    style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)" }}>{model}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          The current dataset copy will be replaced. This run's weights are not affected.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={updating}
            style={{ flex: 1, padding: "9px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: updating ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(runMeta.hasPolygonsChanged ? selectedModel : null)}
            disabled={updating}
            style={{ flex: 1, padding: "9px", borderRadius: 7, border: "none", background: updating ? "var(--border)" : "#F59E0B", color: updating ? "var(--text-muted)" : "#fff", fontSize: 13, fontWeight: 600, cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            {updating
              ? <><span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Copying...</>
              : "Update Dataset"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
