import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DEVICES } from "../lib/constants";
import { type TrainingRun } from "../lib/types";
import { configStripLabel, dropdownItemHover } from "../lib/styleUtils";

const CONFIG_VALUE_STYLE: React.CSSProperties = {
  fontSize: 12,
  lineHeight: "18px",
  fontFamily: "monospace",
  color: "var(--text)",
};

function ConfigStatField({ label, value, width }: { label: string; value: string; width?: number }) {
  return (
    <div style={{ flexShrink: 0, width }}>
      <div style={configStripLabel}>{label}</div>
      <div style={{ ...CONFIG_VALUE_STYLE, height: 18 }}>{value}</div>
    </div>
  );
}

function ConfigNumField({ label, value, min, max, editable, format, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  editable: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = format ? format(value) : String(value);

  function commit(raw: string) {
    const nextValue = parseInt(raw, 10);
    if (!isNaN(nextValue) && nextValue >= min && nextValue <= max) onChange(nextValue);
    setEditing(false);
  }

  return (
    <div style={{ flexShrink: 0, width: 58 }}>
      <div style={configStripLabel}>{label}</div>
      <div style={{ height: 18, position: "relative" }}>
        <input
          value={editing ? draft : ""}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { setDraft(String(value)); setEditing(true); }}
          onBlur={() => commit(draft)}
          onKeyDown={e => {
            if (e.key === "Enter") commit(draft);
            if (e.key === "Escape") {
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          readOnly={!editing}
          style={{
            ...CONFIG_VALUE_STYLE,
            position: "absolute",
            inset: 0,
            width: "100%",
            padding: 0,
            margin: 0,
            background: "transparent",
            border: "none",
            borderBottom: editing ? "1px solid var(--accent)" : editable ? "1px dashed var(--border)" : "1px solid transparent",
            outline: "none",
            cursor: editable ? "text" : "default",
            color: editing ? "var(--text)" : "transparent",
          }}
        />
        {!editing && <div style={{ ...CONFIG_VALUE_STYLE, pointerEvents: "none" }}>{display}</div>}
      </div>
    </div>
  );
}

function ConfigSelectField({ label, value, options, editable, onChange }: {
  label: string;
  value: string;
  options: string[];
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, width: 72 }}>
      <div style={configStripLabel}>{label}</div>
      <div style={{ height: 18 }}>
        <div
          onClick={() => { if (editable) setOpen(current => !current); }}
          title={editable ? "Click to edit" : undefined}
          style={{
            ...CONFIG_VALUE_STYLE,
            cursor: editable ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderBottom: editable ? "1px dashed var(--border)" : "1px solid transparent",
          }}
        >
          {value}
          {editable && <ChevronDown size={10} style={{ opacity: 0.5 }} />}
        </div>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, minWidth: 90, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}>
          {options.map(option => (
            <div
              key={option}
              onClick={() => { onChange(option); setOpen(false); }}
              style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", color: option === value ? "var(--accent)" : "var(--text)", background: option === value ? "rgba(59,130,246,0.08)" : "transparent" }}
              {...dropdownItemHover(option === value)}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RunConfigStrip({
  run,
  editable,
  onUpdate,
}: {
  run: TrainingRun;
  editable: boolean;
  onUpdate: (patch: Partial<TrainingRun>) => void;
}) {
  return (
    <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--border)", display: "flex", gap: 28, alignItems: "center", flexShrink: 0, flexWrap: "wrap", background: "var(--surface)" }}>
      <ConfigStatField label="Model" value={run.baseModel} width={72} />
      <ConfigNumField label="Epochs" value={run.epochs} min={1} max={10000} editable={editable} onChange={value => onUpdate({ epochs: value })} />
      <ConfigNumField label="Batch" value={run.batchSize} min={-1} max={1024} editable={editable} format={value => value === -1 ? "auto" : String(value)} onChange={value => onUpdate({ batchSize: value })} />
      <ConfigNumField label="Img" value={run.imgsz} min={32} max={1280} editable={editable} format={value => `${value}px`} onChange={value => onUpdate({ imgsz: value })} />
      <ConfigSelectField label="Device" value={run.device} options={DEVICES} editable={editable} onChange={value => onUpdate({ device: value })} />
      <ConfigStatField label="Classes" value={String(run.classMap.length)} width={58} />
    </div>
  );
}
