import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  page: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.page}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "var(--bg)", gap: 16, padding: 40,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          Something went wrong in {this.props.page}
        </div>
        <pre style={{
          fontSize: 11, color: "#EF4444", fontFamily: "monospace",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "12px 16px", maxWidth: 560,
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: "8px 18px", borderRadius: 7, border: "none",
            background: "var(--accent)", color: "#fff",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
