// A render error anywhere under here shows a recoverable panel instead of
// unmounting the tree.
//
// This exists because of a real incident: the lead sheet read `lead.name` while
// its query was still in flight, React tore down the whole app, and the user saw
// a white page with no indication of what happened or what to do. The bug was a
// one-line fix; the blank page was the expensive part. A boundary turns "the app
// is broken" into "this panel is broken, here is the reason, try again".
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  /** Shown in the message so the user knows which part failed. */
  label?: string;
  /** Changing any value here clears the error — used to reset on navigation. */
  resetKeys?: unknown[];
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as console.error rather than a toast: this fires during render, and
    // the panel below is already the user-facing half of the report.
    console.error("[ErrorBoundary]", this.props.label ?? "app", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from a broken screen should recover automatically —
    // otherwise the user is stuck on the panel until a full reload.
    if (!this.state.error) return;
    const a = prev.resetKeys ?? [];
    const b = this.props.resetKeys ?? [];
    if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-16">
        <Card className="w-full p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">
                {this.props.label ? `${this.props.label} hit an error` : "Something went wrong"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The rest of the app is unaffected — you can go back or retry this screen.
              </p>
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {error.message || String(error)}
              </pre>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => { window.location.href = "/"; }} className="gap-1.5">
              <Home className="h-3.5 w-3.5" /> Back to Today
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
