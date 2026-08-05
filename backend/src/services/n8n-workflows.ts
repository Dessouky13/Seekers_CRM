// The n8n workflow templates the Outreach page offers for download.
//
// ── Why they are here and not in Frontend/public/ ────────────────────────
// They used to sit in `Frontend/public/n8n/`, which Vercel serves verbatim to
// the entire internet at a guessable URL. Alongside them was a SETUP.md that
// contained the real production `AUTOMATION_API_KEY` — fetchable by anyone,
// unauthenticated, and confirmed returning 200. The key was redacted, but the
// STRUCTURE that made it public is the actual defect: `public/` has no review
// gate, so the next person who pastes a working credential into an operational
// document publishes it the moment they push.
//
// So the operational documents left `public/` entirely. The setup guide is now
// `docs/n8n/SETUP.md` — in the repository, never served — and these workflow
// templates are served only to a signed-in user, by GET /outreach/n8n-workflows.
//
// ── Why they are imported rather than read from disk ─────────────────────
// `import` means tsup inlines the JSON into the bundle, so the running server
// has no filesystem dependency at all. A readFile() against a path relative to
// the source tree would depend on how the VPS lays the checkout out under
// /var/www/seekersai/backend, which is exactly the kind of thing that works in
// dev and 404s in production. Nothing else in this backend reads a repo file at
// runtime, and this is not the feature to start with.
import apifyGoogleMaps       from "../assets/n8n/seekers-apify-google-maps.json";
import apifyLinkedinEmployees from "../assets/n8n/seekers-apify-linkedin-employees.json";
import apollo                from "../assets/n8n/seekers-apollo-workflow.json";
import crmAutomation         from "../assets/n8n/seekers-crm-automation.json";
import firecrawlSearch       from "../assets/n8n/seekers-firecrawl-search.json";
import osmLeads              from "../assets/n8n/seekers-osm-leads.json";
import rb2b                  from "../assets/n8n/seekers-rb2b-workflow.json";
import snov                  from "../assets/n8n/seekers-snov-workflow.json";
import whatsappNotifications from "../assets/n8n/seekers-whatsapp-notifications.json";

/**
 * Keyed by the exact filename the UI asks for and the user downloads.
 *
 * A lookup in a fixed map, not a filename joined onto a directory — there is no
 * path to traverse, so `../../.env` is simply not a key and cannot be made into
 * one.
 */
export const N8N_WORKFLOWS: Readonly<Record<string, unknown>> = {
  "seekers-apify-google-maps.json":        apifyGoogleMaps,
  "seekers-apify-linkedin-employees.json": apifyLinkedinEmployees,
  "seekers-apollo-workflow.json":          apollo,
  "seekers-crm-automation.json":           crmAutomation,
  "seekers-firecrawl-search.json":         firecrawlSearch,
  "seekers-osm-leads.json":                osmLeads,
  "seekers-rb2b-workflow.json":            rb2b,
  "seekers-snov-workflow.json":            snov,
  "seekers-whatsapp-notifications.json":   whatsappNotifications,
};

export function n8nWorkflowNames(): string[] {
  return Object.keys(N8N_WORKFLOWS);
}
