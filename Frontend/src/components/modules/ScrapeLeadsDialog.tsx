import { useState } from "react";
import { Sparkles, ChevronLeft, Loader2, MapPin, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const SCRAPE_WEBHOOK_URL = "https://n8n.srv1131703.hstgr.cloud/webhook/3f8ea5dc-2c42-4ec8-ada8-f1f1c6ec713e";

type Source = "google_maps" | "linkedin";

interface Props {
  trigger?: React.ReactNode;
}

export function ScrapeLeadsDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setSource(null); };

  const handleSubmit = async (payload: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch(SCRAPE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Webhook returned HTTP ${res.status}`);
      }
      toast.success("Scrape job kicked off — leads will start flowing in shortly.");
      setOpen(false);
      reset();
    } catch (err: any) {
      toast.error(`Scrape failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5 h-8">
            <Sparkles className="h-3.5 w-3.5" /> Scrape Leads
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {source && (
              <button
                onClick={() => setSource(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Back to source picker"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <Sparkles className="h-4 w-4 text-primary" />
            {source === null && "Scrape Leads — pick a source"}
            {source === "google_maps" && "Scrape from Google Maps"}
            {source === "linkedin"    && "Scrape from LinkedIn"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">
            {source === null
              ? "Where should we pull leads from? Each source uses a different Apify actor."
              : "Fill in the filters below. Results stream into your CRM lead list as they come in."}
          </p>
        </DialogHeader>

        {source === null ? (
          <SourcePicker onPick={setSource} />
        ) : source === "google_maps" ? (
          <GoogleMapsForm submitting={submitting} onSubmit={handleSubmit} />
        ) : (
          <LinkedInForm submitting={submitting} onSubmit={handleSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Step 1: Source picker ──────────────────────────────
function SourcePicker({ onPick }: { onPick: (s: Source) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 py-2">
      <button
        onClick={() => onPick("google_maps")}
        className="group rounded-lg border-2 border-border bg-card p-4 text-left hover:border-primary/50 hover:bg-muted/30 transition-all"
      >
        <MapPin className="h-6 w-6 text-primary mb-2" />
        <div className="text-sm font-semibold text-foreground">Google Maps</div>
        <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
          Local businesses by niche + location. Best for restaurants, clinics, agencies, retailers in any city.
        </div>
      </button>
      <button
        onClick={() => onPick("linkedin")}
        className="group rounded-lg border-2 border-border bg-card p-4 text-left hover:border-primary/50 hover:bg-muted/30 transition-all"
      >
        <Linkedin className="h-6 w-6 text-primary mb-2" />
        <div className="text-sm font-semibold text-foreground">LinkedIn</div>
        <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
          People by title + location + industry. Best for B2B decision-makers and SaaS / corporate prospects.
        </div>
      </button>
    </div>
  );
}

// ─── Step 2a: Google Maps form ──────────────────────────
function GoogleMapsForm({
  submitting, onSubmit,
}: {
  submitting: boolean;
  onSubmit:   (payload: Record<string, unknown>) => void;
}) {
  const [language, setLanguage] = useState("en");

  const handle = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      source:      "google_maps",
      search_term: (fd.get("search_term") as string).trim(),
      location:    (fd.get("location") as string).trim(),
      max_results: Number(fd.get("max_results")) || 100,
      language,
    });
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <Label>Search term / niche *</Label>
        <Input name="search_term" required placeholder="e.g. dental clinics, marketing agencies" className="mt-1" />
        <p className="text-[10px] text-muted-foreground mt-1">What kind of businesses you want to find.</p>
      </div>
      <div>
        <Label>Location *</Label>
        <Input name="location" required placeholder="e.g. Dubai, UAE — or Cairo, Egypt" className="mt-1" />
        <p className="text-[10px] text-muted-foreground mt-1">City + country. Be specific.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Max results</Label>
          <Input name="max_results" type="number" min="1" max="2000" defaultValue="100" className="mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1">~$0.001 each.</p>
        </div>
        <div>
          <Label>Language</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">Arabic</SelectItem>
              <SelectItem value="fr">French</SelectItem>
              <SelectItem value="de">German</SelectItem>
              <SelectItem value="es">Spanish</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="ghost" type="button" disabled={submitting}>Cancel</Button></DialogClose>
        <Button type="submit" disabled={submitting} className="gap-1.5">
          {submitting ? <><Loader2 className="h-3 w-3 animate-spin" /> Submitting…</> : <><Sparkles className="h-3.5 w-3.5" /> Start scrape</>}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Step 2b: LinkedIn form ─────────────────────────────
function LinkedInForm({
  submitting, onSubmit,
}: {
  submitting: boolean;
  onSubmit:   (payload: Record<string, unknown>) => void;
}) {
  const [companySize, setCompanySize] = useState("11-200");

  const handle = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      source:       "linkedin",
      keywords:     (fd.get("keywords") as string).trim(),
      location:     (fd.get("location") as string).trim(),
      industry:     (fd.get("industry") as string).trim() || undefined,
      company_size: companySize,
      max_results:  Number(fd.get("max_results")) || 100,
    });
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <Label>Keywords / job title *</Label>
        <Input name="keywords" required placeholder="e.g. marketing manager, founder, CTO" className="mt-1" />
      </div>
      <div>
        <Label>Location *</Label>
        <Input name="location" required placeholder="e.g. Cairo, Egypt — or Dubai, UAE" className="mt-1" />
      </div>
      <div>
        <Label>Industry</Label>
        <Input name="industry" placeholder="e.g. Marketing & Advertising, SaaS, Real Estate" className="mt-1" />
        <p className="text-[10px] text-muted-foreground mt-1">Use LinkedIn's industry names. Leave blank for any.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Company size</Label>
          <Select value={companySize} onValueChange={setCompanySize}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1-10">1-10 (very small)</SelectItem>
              <SelectItem value="11-200">11-200 (SMB)</SelectItem>
              <SelectItem value="201-500">201-500 (mid-market)</SelectItem>
              <SelectItem value="501-1000">501-1000</SelectItem>
              <SelectItem value="1001-5000">1001-5000</SelectItem>
              <SelectItem value="5001+">5001+ (enterprise)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Max results</Label>
          <Input name="max_results" type="number" min="1" max="2000" defaultValue="100" className="mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1">~$0.004 each.</p>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="ghost" type="button" disabled={submitting}>Cancel</Button></DialogClose>
        <Button type="submit" disabled={submitting} className="gap-1.5">
          {submitting ? <><Loader2 className="h-3 w-3 animate-spin" /> Submitting…</> : <><Sparkles className="h-3.5 w-3.5" /> Start scrape</>}
        </Button>
      </DialogFooter>
    </form>
  );
}
