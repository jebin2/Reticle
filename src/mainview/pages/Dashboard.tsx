import { useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { MOCK_PROJECTS, STATUS_LABELS, STATUS_COLORS, CLASS_COLORS, type Project, type ProjectStatus } from "../lib/constants";

const FILTER_TABS: { id: "all" | ProjectStatus; label: string }[] = [
  { id: "all",        label: "All" },
  { id: "annotating", label: "Annotating" },
  { id: "ready",      label: "Ready" },
  { id: "training",   label: "Training" },
  { id: "trained",    label: "Trained" },
];

interface DashboardProps {
  onNewProject: () => void;
}

export default function Dashboard({ onNewProject }: DashboardProps) {
  const [filter, setFilter] = useState<"all" | ProjectStatus>("all");
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);

  const filtered = filter === "all" ? projects : projects.filter(p => p.status === filter);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{
        padding: "24px 28px 0",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.4px", marginBottom: 3 }}>
              Projects
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Manage your custom AI models.
            </p>
          </div>
          <button
            onClick={onNewProject}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 7,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={14} />
            New Project
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {FILTER_TABS.map(tab => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px 6px 0 0",
                  border: "none",
                  background: active ? "var(--surface)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  fontFamily: "inherit",
                  transition: "color 0.15s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Project grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}>
          {filtered.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}

          {/* Create new card */}
          <button
            onClick={onNewProject}
            style={{
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              minHeight: 200,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--text-muted)",
              transition: "border-color 0.15s, color 0.15s",
              fontFamily: "inherit",
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
            <div style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1.5px dashed currentColor",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Plus size={16} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Create New Project</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Start a new training session</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const statusColor = STATUS_COLORS[project.status];
  const statusLabel = STATUS_LABELS[project.status];

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#444"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      {/* Thumbnail */}
      <div style={{
        height: 130,
        background: project.thumbnailColor,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {/* Grid pattern overlay */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }} />

        {/* Status badge */}
        <div style={{
          position: "absolute",
          top: 10,
          left: 10,
          padding: "3px 8px",
          borderRadius: 4,
          background: statusColor + "22",
          border: `1px solid ${statusColor}55`,
          color: statusColor,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}>
          {statusLabel}
        </div>

        {/* 3-dot menu */}
        <button
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.4)",
            border: "none",
            borderRadius: 5,
            padding: "4px 5px",
            cursor: "pointer",
            color: "rgba(255,255,255,0.7)",
            display: "flex",
            alignItems: "center",
          }}
          onClick={e => e.stopPropagation()}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Info */}
      <div style={{ padding: "14px 14px 12px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 10, letterSpacing: "-0.2px" }}>
          {project.name}
        </h3>

        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
              Base Model
            </div>
            <div style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>
              {project.baseModel ?? <span style={{ color: "var(--text-muted)" }}>Not set</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
              {project.mAP != null ? "mAP" : "Images"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>
              {project.mAP != null ? project.mAP.toFixed(3) : project.imageCount}
            </div>
          </div>
        </div>

        {/* Class color dots */}
        {project.classes && project.classes.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
            {project.classes.slice(0, 6).map((cls, i) => (
              <div
                key={cls}
                title={cls}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: CLASS_COLORS[i % CLASS_COLORS.length],
                  flexShrink: 0,
                }}
              />
            ))}
            {project.classes.length > 6 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                +{project.classes.length - 6}
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 2 }}>
              {project.classes.length} class{project.classes.length !== 1 ? "es" : ""}
            </span>
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No classes yet</span>
          </div>
        )}

        {/* Footer */}
        <div style={{
          fontSize: 11,
          color: "var(--text-muted)",
          paddingTop: 10,
          borderTop: "1px solid var(--border)",
        }}>
          Updated {project.updatedAt}
        </div>
      </div>
    </div>
  );
}
