import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: "#0f0f0f", color: "#f7768e", height: "100vh", fontFamily: "monospace", fontSize: 13 }}>
          <strong>Render error</strong>
          <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "#c9d1d9" }}>
            {this.state.error.message}
          </pre>
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "#6e7681", fontSize: 11 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
