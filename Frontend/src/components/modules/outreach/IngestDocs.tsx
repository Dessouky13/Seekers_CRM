// Setup & Ingestion tab (admin) — documentation for the lead-ingest and
// reply-detection webhooks, downloadable n8n workflow cards, and the CSV import
// panel.
//
// The workflow templates used to be static files under `public/n8n/`, which
// Vercel serves to the whole internet — the same directory that once published
// a live AUTOMATION_API_KEY at a URL anyone could fetch. They now come from
// GET /outreach/n8n-workflows/:file, which requires a signed-in user, and the
// download is assembled here from the JSON. The full setup guide left the
// served bundle altogether and lives in the repository at docs/n8n/SETUP.md.
import { useState } from "react";
import { FileText, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { CsvImportPanel } from "@/components/modules/CsvImportPanel";

export function IngestDocs() {
  const apiBase = (import.meta.env.VITE_API_URL as string) ?? "https://agency.seekersai.org/api/v1";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">How to push leads into the CRM</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Use this webhook from <strong>n8n</strong>, Apollo, Instantly, or any tool that can POST JSON.
          Authentication is via API key set on the VPS as <code className="bg-muted px-1 py-0.5 rounded text-[10px]">AUTOMATION_API_KEY</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Endpoint</p>
        <pre className="bg-muted/40 rounded-lg p-3 text-xs overflow-x-auto"><code>POST {apiBase}/outreach/leads/ingest
Headers:
  Content-Type: application/json
  X-API-Key: {`<your AUTOMATION_API_KEY>`}

Body:
{`{
  "name": "Jane Doe",
  "company": "Acme Corp",
  "email": "jane@acme.com",
  "phone": "+1 555-555-1234",
  "source": "apollo",
  "category": "SaaS",
  "deal_value": 5000,
  "notes": "Reached out via LinkedIn first"
}`}

Response:
{`{ "id": "uuid", "created": true, "deduped": false }`}
</code></pre>
        <p className="text-xs text-muted-foreground">
          The endpoint is idempotent by email (case-insensitive). Existing leads get patched with any missing fields but their data is preserved.
          If a matching active sequence has <strong>auto-enroll</strong> turned on for the same category, the lead is automatically enrolled.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reply detection webhook</p>
        <pre className="bg-muted/40 rounded-lg p-3 text-xs overflow-x-auto"><code>POST {apiBase}/outreach/webhooks/reply
Headers:
  Content-Type: application/json
  X-API-Key: {`<your AUTOMATION_API_KEY>`}

Body:
{`{
  "from_email": "jane@acme.com",
  "subject":    "Re: Quick question",
  "body_preview": "Sounds good — let's set up a call."
}`}

Response:
{`{ "matched": true, "leadId": "uuid", "pausedCount": 1 }`}
</code></pre>
        <p className="text-xs text-muted-foreground">
          When a lead replies, this pauses all their active enrollments (status → <code>replied</code>),
          adds a reply activity to the timeline, and moves the lead from <code>new_lead</code> → <code>contacted</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready-to-import n8n workflows</p>
        <p className="text-xs text-muted-foreground">
          Pre-built workflows per lead source — each maps the source's exact field shape to our /leads/ingest endpoint. Import any combination you want; they share the same Seekers CRM API Key credential.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <WorkflowCard
            file="seekers-crm-automation.json"
            title="Main workflow"
            description="Generic ingestion webhook + IMAP reply detection. Universal."
            tag="Core"
          />
          <WorkflowCard
            file="seekers-apollo-workflow.json"
            title="Apollo"
            description="Native webhook from Apollo sequences. Auto-skips contacts without email."
            tag="Apollo"
          />
          <WorkflowCard
            file="seekers-snov-workflow.json"
            title="Snov.io"
            description="Webhook from Snov.io drip campaigns or list exports. 50 free credits/mo."
            tag="Snov"
          />
          <WorkflowCard
            file="seekers-apify-google-maps.json"
            title="Apify — Google Maps"
            description="Scheduled scraper for local businesses by niche+location. Great for MENA. $5 buys ~5000 leads."
            tag="Apify"
          />
          <WorkflowCard
            file="seekers-apify-linkedin-employees.json"
            title="Apify — LinkedIn Employees"
            description="Pass target company LinkedIn URLs → scrape every employee with title + profile. ~$4 per 1000 employees."
            tag="Apify"
          />
          <WorkflowCard
            file="seekers-rb2b-workflow.json"
            title="RB2B"
            description="Identifies anonymous website visitors as leads. Tagged 'rb2b-inbound' for warm prioritization."
            tag="Inbound"
          />
          <WorkflowCard
            file="seekers-whatsapp-notifications.json"
            title="WhatsApp Notifications (Twilio)"
            description="Subscribe to CRM events → WhatsApp messages via Twilio. New leads, replies, stage changes, sequence completions."
            tag="WhatsApp"
          />
          <WorkflowCard
            file="seekers-firecrawl-search.json"
            title="Firecrawl Search & Extract"
            description="Web search → LLM-powered structured extraction. Best for niche directories, blog roundups, anything not in Maps/LinkedIn. Free tier: 1k credits/mo."
            tag="Firecrawl"
          />
        </div>
        <p className="pt-1 text-[11px] text-muted-foreground">
          Full setup guide: <code className="bg-muted px-1 py-0.5 rounded">docs/n8n/SETUP.md</code> in
          the repository. It is deliberately not published with the app — it used
          to be, and it exposed a production API key to anyone who asked for it.
        </p>
      </div>

      {/* Already have a list — from one of the workflows above, a scrape, or a
          spreadsheet someone put together? This is the fast path in: no
          webhook or n8n setup needed. */}
      <p className="text-xs text-muted-foreground px-1">
        Already have a list from one of the workflows above, a scrape, or a spreadsheet? Skip the setup — paste or upload it directly below.
      </p>
      <CsvImportPanel />
    </div>
  );
}

function WorkflowCard({ file, title, description, tag }: {
  file:        string;
  title:       string;
  description: string;
  tag:         string;
}) {
  const [downloading, setDownloading] = useState(false);

  /**
   * Fetch the template through the authenticated API, then hand the browser a
   * Blob to save.
   *
   * A plain `<a href download>` cannot carry the bearer token, which is the
   * whole reason these files used to live in `public/` — and the whole reason
   * they were readable by the internet. Building the download here is what lets
   * the endpoint require a session.
   */
  const download = async () => {
    setDownloading(true);
    try {
      const workflow = await apiFetch<unknown>(`/outreach/n8n-workflows/${file}`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      a.click();
      // Revoked on the next tick, not immediately: revoking synchronously after
      // click() can cancel the save in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download that workflow");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button type="button" onClick={download} disabled={downloading} className="block w-full text-left">
      <div className="rounded-lg border border-border bg-muted/20 p-3 hover:border-primary/40 hover:bg-muted/40 transition-colors h-full">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <Badge variant="secondary" className="text-[9px] uppercase">{tag}</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{description}</p>
        <div className="mt-2 flex items-center gap-1 text-[10px] text-primary">
          {downloading
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Downloading…</>
            : <><FileText className="h-3 w-3" /> Download .json</>}
        </div>
      </div>
    </button>
  );
}
