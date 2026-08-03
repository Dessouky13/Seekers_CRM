// A sequence step that needs a person: the message is written, the link is
// ready, all that is missing is a human pressing send.
//
// The outcome buttons are the point. There is no compliant free way to check
// whether a number is on WhatsApp, so the list learns from what happens here —
// "Sent" confirms the number works, "No WhatsApp" retires it.
import { useState } from "react";
import { MessageCircle, Phone, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { renderTemplate, whatsappLink, telLink } from "@/lib/whatsapp";
import { useRecordTouchOutcome, type TouchOutcome } from "@/hooks/useManualTouch";
import type { WorklistAction } from "@/hooks/useWorklist";

const OUTCOMES: { key: TouchOutcome; label: string; destructive?: boolean }[] = [
  { key: "sent",           label: "Sent" },
  { key: "replied",        label: "They replied" },
  { key: "no_whatsapp",    label: "No WhatsApp" },
  { key: "wrong_number",   label: "Wrong number" },
  { key: "not_interested", label: "Not interested", destructive: true },
];

export function ManualTouchCard({ action }: { action: WorklistAction }) {
  const record = useRecordTouchOutcome();
  const [copied, setCopied] = useState(false);

  const isWhatsapp = action.channel === "whatsapp";
  const message = renderTemplate(action.message ?? "", {
    name:    action.title,
    company: action.subtitle ?? undefined,
  });
  const phone = action.phoneE164 ?? "";

  // The backend guarantees this on every manual_touch action (and has a
  // regression test for it), so this only matters if that ever regresses.
  // A button that looks pressable but silently does nothing is worse than one
  // that is visibly disabled with an explanation.
  const missingEnrollment = !action.enrollmentId;

  const submit = (outcome: TouchOutcome) => {
    if (!action.enrollmentId) return;
    record.mutate(
      { enrollmentId: action.enrollmentId, outcome },
      {
        onSuccess: () => toast.success(
          outcome === "no_whatsapp" ? "Marked — this lead will be tried on another channel"
          : outcome === "wrong_number" ? "Number cleared"
          : "Recorded",
        ),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — clipboard access was blocked");
    }
  };

  return (
    <Card className="border-border/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <Badge variant="outline" className="gap-1 border-emerald-500/30 text-[11px] uppercase tracking-wide text-emerald-400">
          {isWhatsapp ? <MessageCircle className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
          {isWhatsapp ? "WhatsApp" : "Call"}
        </Badge>
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-tight text-foreground">{action.title}</h2>
      {action.subtitle && <p className="text-sm text-muted-foreground">{action.subtitle}</p>}
      {phone && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{phone}</p>}

      {/* The backend fills `message` identically for whatsapp and call steps
          (both read the step's body_template) — a call step's body is a
          script to read, not a WhatsApp message, so it gets its own label
          and the amber tone the call badge above already uses. Withholding
          this for calls left the person about to dial with nothing to say. */}
      {message && (
        <div className={cn(
          "mt-4 rounded-lg border-l-2 px-4 py-3",
          isWhatsapp ? "border-emerald-500/60 bg-emerald-500/5" : "border-amber-500/60 bg-amber-500/5",
        )}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isWhatsapp ? "Message to send" : "Call script"}
          </p>
          <p
            className="whitespace-pre-line text-sm text-foreground/90"
            aria-label={isWhatsapp ? "WhatsApp message" : "Call script"}
          >
            {message}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phone && (
          <Button asChild className="gap-1.5">
            {/* Opens WhatsApp Business when that is the installed app. */}
            <a
              href={isWhatsapp ? whatsappLink(phone, message) : telLink(phone)}
              target={isWhatsapp ? "_blank" : undefined}
              rel={isWhatsapp ? "noopener noreferrer" : undefined}
            >
              {isWhatsapp
                ? <><MessageCircle className="h-4 w-4" /> Open WhatsApp</>
                : <><Phone className="h-4 w-4" /> Call</>}
            </a>
          </Button>
        )}
        {isWhatsapp && message && (
          // Fallback for a desktop with no WhatsApp installed.
          <Button variant="outline" className="gap-1.5" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy message"}
          </Button>
        )}
      </div>

      <div className="mt-4 border-t border-border/50 pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          What happened?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.filter((o) => isWhatsapp || o.key !== "no_whatsapp").map((o) => (
            <Button
              key={o.key}
              size="sm"
              variant={o.key === "sent" ? "default" : "outline"}
              disabled={record.isPending || missingEnrollment}
              title={missingEnrollment
                ? "Can't record an outcome — this card is missing its enrollment id. Reload, or report this as a bug."
                : undefined}
              onClick={() => submit(o.key)}
              className={o.destructive ? "text-destructive" : undefined}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {missingEnrollment
            ? "This card is missing its enrollment id, so no outcome can be recorded. Reload, or report this as a bug."
            : "The sequence stays paused until you record an outcome."}
        </p>
      </div>
    </Card>
  );
}
