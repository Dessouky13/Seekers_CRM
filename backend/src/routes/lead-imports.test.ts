// Integration test for the n8n handoff proxy, run against a real local HTTP
// server standing in for n8n.
//
// This is the only route-level test in the backend, and it exists because the
// thing being asserted is not a pure function — it is the SHAPE of an outbound
// request: which header the secret rides in, that it is not also in the body,
// that the multipart boundary survives, and that every failure mode returns a
// real error instead of a fake success. None of that can be proved by testing
// `import-forward.ts` alone.
//
// `../middleware/auth` is mocked because the real middleware queries `profiles`
// and would need a live database; nothing here exercises auth. The other route
// on this router (POST /validate) does query the DB and is not covered here —
// its decision logic is unit-tested in services/lead-import.test.ts instead.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";
import { Hono } from "hono";
import type { Context, Next } from "hono";

// db/client.ts throws at import time without this. Constructing a pg Pool does
// not connect, and no test here reaches a query.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:y@127.0.0.1:1/none";

vi.mock("../middleware/auth", () => {
  const stub = async (c: Context, next: Next) => {
    c.set("user", { id: "11111111-1111-1111-1111-111111111111", name: "Dessouky", role: "admin" });
    await next();
  };
  return { authMiddleware: stub, adminOnly: stub, isAdmin: () => true };
});

interface Captured { headers: IncomingMessage["headers"]; body: string }

let server: Server;
/** Every request the stand-in n8n received, newest last. */
let captured: Captured[] = [];
/** What the stand-in n8n replies with next. */
let nextStatus = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      // latin1, not utf8: the body is multipart with arbitrary binary parts, and
      // decoding as utf8 would mangle the bytes being asserted on.
      captured.push({ headers: req.headers, body: Buffer.concat(chunks).toString("latin1") });
      res.writeHead(nextStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: nextStatus < 300 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  process.env.N8N_LEADS_IMPORT_URL    = `http://127.0.0.1:${port}/webhook/leads-import`;
  process.env.N8N_LEADS_IMPORT_SECRET = "test-secret-abc123";
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Re-imported per test so an env change (e.g. the secret) is picked up. */
async function buildApp() {
  const mod = await import("./lead-imports");
  const app = new Hono();
  app.route("/lead-imports", mod.default);
  return app;
}

function fileForm(content: string, name = "leads.csv", extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/csv" }), name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

describe("POST /lead-imports/n8n", () => {
  it("sends the secret as a header and never inside the body", async () => {
    captured = []; nextStatus = 200;
    const app = await buildApp();
    const res = await app.request("/lead-imports/n8n", {
      method: "POST",
      body: fileForm("name,company\nJane,Acme\n", "leads.csv", { row_count: "1", mode: "update" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ forwarded: true, upstream_status: 200 });

    const hit = captured[0];
    expect(hit.headers["x-seekers-import-secret"]).toBe("test-secret-abc123");
    // n8n stores webhook bodies in its execution history; the secret must not
    // be written into one.
    expect(hit.body).not.toContain("test-secret-abc123");
  });

  it("keeps the multipart boundary, so n8n can actually parse the upload", async () => {
    captured = []; nextStatus = 200;
    const app = await buildApp();
    // Distinct content per test on purpose: the duplicate guard is process-wide
    // module state, so reusing another test's bytes would 409 instead of sending.
    await app.request("/lead-imports/n8n", { method: "POST", body: fileForm("name,company\nBoundary,Acme\n") });

    // Setting Content-Type by hand is the classic way to break this: the value
    // then has no boundary and every part is unreachable.
    expect(captured[0].headers["content-type"]).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(captured[0].body).toContain("Boundary,Acme");
    expect(captured[0].body).toContain('filename="leads.csv"');
  });

  it("attaches the import metadata n8n needs, with a Cairo calendar date", async () => {
    captured = []; nextStatus = 200;
    const app = await buildApp();
    await app.request("/lead-imports/n8n", {
      method: "POST", body: fileForm("name,company\nMetadata,Acme\n", "leads.csv", { row_count: "42", mode: "skip" }),
    });

    const parts = [...captured[0].body.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    expect(parts).toEqual(expect.arrayContaining([
      "file", "file_name", "fingerprint", "imported_on", "imported_by", "imported_by_id", "row_count", "mode",
    ]));
    // `imported_on` is a Cairo calendar day (see utils/dates.ts) — never a UTC
    // toISOString slice, which would file a 00:30 Cairo import under yesterday.
    expect(captured[0].body).toMatch(/name="imported_on"\r?\n\r?\n\d{4}-\d{2}-\d{2}/);
  });

  it("blocks a byte-identical resend with 409, and force sends it anyway", async () => {
    captured = []; nextStatus = 200;
    const app = await buildApp();
    const bytes = "name,company\nBob,Widgets\n";

    expect((await app.request("/lead-imports/n8n", { method: "POST", body: fileForm(bytes, "a.csv") })).status).toBe(200);

    // Renamed but byte-identical: the guard is content-addressed, so the new
    // filename must not get it through.
    const resend = await app.request("/lead-imports/n8n", { method: "POST", body: fileForm(bytes, "renamed.csv") });
    expect(resend.status).toBe(409);
    expect(await resend.json()).toMatchObject({ duplicate: true, window_minutes: 30 });

    const forced = await app.request("/lead-imports/n8n", {
      method: "POST", body: fileForm(bytes, "a.csv", { force: "true" }),
    });
    expect(forced.status).toBe(200);
    // Two upstream calls, not three: the blocked one never left the building.
    expect(captured).toHaveLength(2);
  });

  it("returns 502 and the upstream status when n8n rejects the file", async () => {
    captured = []; nextStatus = 500;
    const app = await buildApp();
    const res = await app.request("/lead-imports/n8n", {
      method: "POST", body: fileForm("name,company\nZed,Zeta\n", "err.csv"),
    });

    expect(res.status).toBe(502);
    const json = await res.json() as { error: string; upstream_status: number };
    expect(json.upstream_status).toBe(500);
    expect(json.error).toContain("500");
  });

  it("does not remember a FAILED forward, so it stays retryable", async () => {
    captured = []; nextStatus = 500;
    const app = await buildApp();
    const bytes = "name,company\nRetry,Me\n";
    expect((await app.request("/lead-imports/n8n", { method: "POST", body: fileForm(bytes, "r.csv") })).status).toBe(502);

    // The duplicate guard exists to stop the workflow running twice — not to
    // stop a file that never arrived from being sent at all.
    nextStatus = 200;
    expect((await app.request("/lead-imports/n8n", { method: "POST", body: fileForm(bytes, "r.csv") })).status).toBe(200);
  });

  it("returns 502 when n8n is unreachable, never a fake success", async () => {
    captured = []; nextStatus = 200;
    const saved = process.env.N8N_LEADS_IMPORT_URL;
    // Port 1 refuses immediately; a real 20s timeout would stall the suite.
    process.env.N8N_LEADS_IMPORT_URL = "http://127.0.0.1:1/webhook/leads-import";
    const app = await buildApp();

    const res = await app.request("/lead-imports/n8n", {
      method: "POST", body: fileForm("name,company\nUnreach,Able\n", "u.csv"),
    });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain("Could not reach");

    process.env.N8N_LEADS_IMPORT_URL = saved;
  });

  it("accepts .xlsx as well as .csv", async () => {
    captured = []; nextStatus = 200;
    const app = await buildApp();
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("PKfake-xlsx")], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "leads.xlsx");

    expect((await app.request("/lead-imports/n8n", { method: "POST", body: form })).status).toBe(200);
    expect(captured[0].body).toContain('filename="leads.xlsx"');
  });

  it("rejects a file type that is not a spreadsheet", async () => {
    const app = await buildApp();
    const res = await app.request("/lead-imports/n8n", { method: "POST", body: fileForm("x", "leads.pdf") });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain(".pdf");
  });

  it("rejects a request with no file", async () => {
    const app = await buildApp();
    const res = await app.request("/lead-imports/n8n", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  it("returns 503 while the secret is still the .env.example placeholder", async () => {
    const saved = process.env.N8N_LEADS_IMPORT_SECRET;
    process.env.N8N_LEADS_IMPORT_SECRET = "replace-with-the-n8n-header-auth-secret";
    const app = await buildApp();

    const res = await app.request("/lead-imports/n8n", { method: "POST", body: fileForm("a,b\n1,2\n", "z.csv") });
    expect(res.status).toBe(503);
    // The message has to say the file was NOT sent — a silent skip here is the
    // failure this endpoint is most likely to be blamed for.
    expect((await res.json() as { error: string }).error).toContain("not sent to n8n");

    process.env.N8N_LEADS_IMPORT_SECRET = saved;
  });
});
