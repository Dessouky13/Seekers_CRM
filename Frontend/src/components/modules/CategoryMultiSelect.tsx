import { useState } from "react";
import { X, Plus, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Multi-select category picker.
 *
 * The FIRST selected category is the "primary" — it owns the amount in P&L
 * breakdowns so reports always reconcile to the real total. Extra categories
 * behave as tags for filtering. Clicking the star promotes a category to
 * primary.
 */
export function CategoryMultiSelect({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    onChange([...value, name]);
    setDraft("");
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  // Move a category to position 0 (primary).
  const makePrimary = (name: string) => onChange([name, ...value.filter((v) => v !== name)]);

  const unused = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((cat, i) => {
            const isPrimary = i === 0;
            return (
              <span
                key={cat}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  isPrimary
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-muted/40 text-foreground",
                )}
              >
                {isPrimary ? (
                  <Star className="h-3 w-3 fill-current" aria-label="Primary category" />
                ) : (
                  <button
                    type="button"
                    onClick={() => makePrimary(cat)}
                    title="Make primary (owns the amount in reports)"
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                {cat}
                <button
                  type="button"
                  onClick={() => remove(cat)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${cat}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Add field */}
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();      // don't submit the dialog form
              add(draft);
            }
          }}
          placeholder={value.length ? "Add another…" : "e.g. Tools"}
          className="h-8 text-sm"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md border border-border px-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
          aria-label="Add category"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Quick-pick suggestions */}
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {value.length > 1 && (
        <p className="text-[10px] text-muted-foreground">
          <Star className="inline h-2.5 w-2.5 fill-current text-primary" />{" "}
          <span className="text-primary font-medium">{value[0]}</span> is primary — it owns
          this amount in reports. The rest are tags for filtering.
        </p>
      )}
    </div>
  );
}
