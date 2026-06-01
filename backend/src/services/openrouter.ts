// OpenRouter client — single fetch wrapper over the chat-completions endpoint.
// Default model is configurable via OPENROUTER_MODEL env var.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ORMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ORChatRequest {
  messages:      ORMessage[];
  model?:        string;
  temperature?:  number;
  max_tokens?:   number;
}

export interface ORChatResponse {
  output:    string;
  model:     string;
  tokensIn:  number;
  tokensOut: number;
  costUsd:   number;
}

function getKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.startsWith("sk-or-v1-replace")) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return key;
}

// Fallback chain: if the configured model isn't available (e.g. deprecated /
// removed by OpenRouter), try these in order before giving up. These are
// all cheap, fast, and broadly available models.
const FALLBACK_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "anthropic/claude-3.5-haiku",
  "openai/gpt-4o-mini",
];

async function callOR(model: string, req: ORChatRequest): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getKey()}`,
      "Content-Type":  "application/json",
      "HTTP-Referer":  process.env.OPENROUTER_SITE_URL ?? "https://agency.seekersai.org",
      "X-Title":       process.env.OPENROUTER_APP_NAME ?? "Seekers AI OS",
    },
    body: JSON.stringify({
      model,
      messages:    req.messages,
      temperature: req.temperature ?? 0.5,
      max_tokens:  req.max_tokens  ?? 1500,
    }),
  });
}

export async function orChat(req: ORChatRequest): Promise<ORChatResponse> {
  const primary = req.model ?? process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";

  // Build the chain — primary first, then fallbacks (deduped + skip the primary)
  const chain = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];

  let lastErrText = "";
  for (const model of chain) {
    const res = await callOR(model, req);
    if (res.ok) {
      const data: any = await res.json();
      const choice = data.choices?.[0]?.message?.content ?? "";
      const usage  = data.usage ?? {};
      return {
        output:    String(choice).trim(),
        model:     data.model ?? model,
        tokensIn:  Number(usage.prompt_tokens     ?? 0),
        tokensOut: Number(usage.completion_tokens ?? 0),
        costUsd:   Number(data.usage?.cost ?? data.total_cost ?? 0),
      };
    }
    lastErrText = await res.text().catch(() => "");
    // Only fall back on model-availability errors (404). Auth/rate-limit/etc
    // we should fail loudly, not silently switch models.
    if (res.status !== 404) {
      throw new Error(`OpenRouter ${res.status}: ${lastErrText.slice(0, 300)}`);
    }
    console.warn(`[openrouter] model ${model} unavailable (404), trying next…`);
  }
  throw new Error(`OpenRouter: all fallback models failed. Last: ${lastErrText.slice(0, 300)}`);
}
