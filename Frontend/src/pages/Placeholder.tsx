import { useLocation } from "react-router-dom";

export default function Placeholder() {
  const location = useLocation();
  const name = location.pathname.slice(1) || "Page";
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <h1 className="text-xl font-semibold text-foreground capitalize">{name}</h1>
        <p className="text-sm text-muted-foreground mt-2">This section is coming soon.</p>
      </div>
    </div>
  );
}
