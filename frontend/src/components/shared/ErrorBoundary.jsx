import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "20px",
          margin: "20px",
          backgroundColor: "#fee",
          border: "2px solid #c33",
          borderRadius: "8px",
          color: "#333",
        }}>
          <h2 style={{ color: "#c33", marginBottom: "10px" }}>
            Something went wrong
          </h2>
          <p style={{ marginBottom: "10px", color: "#666" }}>
            An error occurred while rendering this component. Please refresh the page and try again.
          </p>
          {import.meta.env.DEV && (
            <details style={{
              marginTop: "10px",
              padding: "10px",
              backgroundColor: "#f5f5f5",
              borderRadius: "4px",
              fontSize: "12px",
            }}>
              <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
                Error Details (Development Only)
              </summary>
              <pre style={{
                marginTop: "10px",
                overflow: "auto",
                color: "#c33",
              }}>
                {this.state.error?.toString()}
                {"\n\n"}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
