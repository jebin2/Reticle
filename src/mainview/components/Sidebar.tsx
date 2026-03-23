import { Layers, Tag, Cpu, Scan, Upload, Plus, BookOpen, LifeBuoy } from "lucide-react";

export type NavPage = "projects" | "annotate" | "train" | "inference" | "export";

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  onNewProject: () => void;
}

const NAV_ITEMS: { id: NavPage; label: string; Icon: React.ElementType }[] = [
  { id: "projects",   label: "Projects",   Icon: Layers },
  { id: "annotate",   label: "Annotate",   Icon: Tag },
  { id: "train",      label: "Train",      Icon: Cpu },
  { id: "inference",  label: "Inference",  Icon: Scan },
  { id: "export",     label: "Export",     Icon: Upload },
];

export default function Sidebar({ activePage, onNavigate, onNewProject }: SidebarProps) {
  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: "var(--accent)",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1" fill="white" fillOpacity="0.9" />
              <rect x="9" y="1" width="6" height="6" rx="1" fill="white" fillOpacity="0.5" />
              <rect x="1" y="9" width="6" height="6" rx="1" fill="white" fillOpacity="0.5" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="white" fillOpacity="0.9" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.3px", color: "var(--text)" }}>
            YOLOStudio
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: active ? "rgba(59,130,246,0.12)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                fontWeight: active ? 500 : 400,
                fontSize: 13,
                textAlign: "left",
                transition: "background 0.15s, color 0.15s",
                marginBottom: 2,
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <Icon size={15} strokeWidth={active ? 2 : 1.5} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* New Project */}
      <div style={{ padding: "8px", borderTop: "1px solid var(--border)" }}>
        <button
          onClick={onNewProject}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px dashed var(--border)",
            cursor: "pointer",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 13,
            fontWeight: 500,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--accent)";
            el.style.color = "var(--accent)";
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--border)";
            el.style.color = "var(--text-muted)";
          }}
        >
          <Plus size={14} />
          New Project
        </button>
      </div>

      {/* Footer links */}
      <div style={{ padding: "8px", borderTop: "1px solid var(--border)" }}>
        {[{ label: "Documentation", Icon: BookOpen }, { label: "Support", Icon: LifeBuoy }].map(({ label, Icon }) => (
          <button
            key={label}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 12,
              textAlign: "left",
              marginBottom: 2,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          >
            <Icon size={13} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}
