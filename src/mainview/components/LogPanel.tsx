import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  lines: string[];
  renderLine: (line: string, index: number) => ReactNode;
  emptyText?: string;
  height?: number | string;
}

export default function LogPanel({
  lines,
  renderLine,
  emptyText = "No log entries yet.",
  height = "100%",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const isAtBottom   = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height,
        overflowY: "auto",
        overflowX: "hidden",
        wordBreak: "break-all",
        padding: "12px 16px",
        border: "1px solid #2E2E2E",
        borderRadius: 8,
        background: "#0e0e0e",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      {lines.length === 0
        ? <div style={{ color: "var(--text-muted)", paddingTop: 16 }}>{emptyText}</div>
        : lines.map(renderLine)
      }
      <div ref={bottomRef} />
    </div>
  );
}
