import type React from "react";

// ── Hover handlers ─────────────────────────────────────────────────────────────

/** Card border: gray on hover */
export const cardHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "#444";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
  },
};

/** New-item placeholder: accent border + color on hover */
export const accentHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.borderColor = "var(--accent)";
    el.style.color = "var(--accent)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.borderColor = "var(--border)";
    el.style.color = "var(--text-muted)";
  },
};

/** Sidebar / generic item: subtle bg on hover */
export const bgHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.background = "transparent";
  },
};

/** Icon/text-muted button: color → accent on hover */
export const accentColorHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.color = "var(--accent)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
  },
};

/** Delete button: red on hover */
export const deleteHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.color = "#EF4444";
    el.style.background = "rgba(0,0,0,0.65)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.color = "rgba(255,255,255,0.6)";
    el.style.background = "rgba(0,0,0,0.4)";
  },
};

// ── Common style objects ───────────────────────────────────────────────────────

export const panel: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
};

export const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--text-muted)",
  marginBottom: 12,
};

export const statusBadge = (color: string): React.CSSProperties => ({
  padding: "2px 7px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  background: color + "22",
  border: `1px solid ${color}55`,
  color,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
});

/** Dropdown item hover — depends on whether the item is currently selected. */
export function dropdownItemHover(selected: boolean) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (!selected) (e.currentTarget as HTMLElement).style.background = "var(--bg)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.background = selected ? "rgba(59,130,246,0.08)" : "transparent";
    },
  };
}

/** Base muted caption — fontSize 11, text-muted, no font override. */
export const mutedText: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
};

/** Monospace muted caption — mutedText + monospace font. */
export const monoSmall: React.CSSProperties = {
  ...mutedText,
  fontFamily: "monospace",
};

/**
 * Config-strip field label — 10px uppercase muted, used above editable
 * value cells in the RunDetailView header strip.
 */
export const configStripLabel: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: 2,
};

export const pageHeader: React.CSSProperties = {
  height: 56,
  padding: "0 28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

export const primaryBtn: React.CSSProperties = {
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
};

export const ghostBtn: React.CSSProperties = {
  flex: 1,
  padding: "9px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const newItemCard: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px dashed var(--border)",
  borderRadius: 8,
  minHeight: 220,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  color: "var(--text-muted)",
  transition: "border-color 0.15s, color 0.15s",
  fontFamily: "inherit",
};
