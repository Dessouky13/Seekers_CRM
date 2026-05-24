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

export async function orChat(req: ORChatRequest): Promise<ORChatResponse> {
  const model = req.model ?? process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";

  const res = await fetch(OPENROUTER_URL, {
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

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const choice    = data.choices?.[0]?.message?.content ?? "";
  const usage     = data.usage ?? {};

  // OpenRouter returns total_cost in some plans; otherwise compute null
  const costUsd = Number(data.usage?.cost ?? data.total_cost ?? 0);

  return {
    output:    String(choice).trim(),
    model:     data.model ?? model,
    tokensIn:  Number(usage.prompt_tokens     ?? 0),
    tokensOut: Number(usage.completion_tokens ?? 0),
    costUsd,
  };
}
