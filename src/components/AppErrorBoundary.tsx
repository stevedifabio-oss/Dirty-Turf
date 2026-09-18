import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

type State = { failed: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dirty Turf app render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-crash" role="alert">
        <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
        <TriangleAlert size={26} />
        <h1>The app could not finish loading.</h1>
        <p>Your saved measurements are still on this device. Reload the app to try again.</p>
        <button type="button" onClick={() => window.location.reload()}><RefreshCw size={18} /> Reload app</button>
      </main>
    );
  }
}
