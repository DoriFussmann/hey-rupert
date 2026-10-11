import "server-only";

// Minimal Claude Messages API client (no SDK). Each call offers a single
// tool and asks Claude to reply through it, so the reply comes back as
// structured input we validate. Some models do not allow forcing a tool, so
// the choice is left to the model ("auto"); callers can supply a fallback
// that turns a plain-text reply into usable input.
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 50_000;

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ClaudeResult<T> =
  | { ok: true; input: T }
  | { ok: false; reason: string };

export function isClaudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callClaudeTool<T>({
  system,
  messages,
  tool,
  maxTokens = 1024,
  fallbackFromText,
}: {
  system: string;
  messages: ClaudeMessage[];
  tool: ClaudeTool;
  maxTokens?: number;
  /** Used when Claude answers in plain text instead of calling the tool. */
  fallbackFromText?: (text: string) => T | null;
}): Promise<ClaudeResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured." };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        tools: [tool],
        tool_choice: { type: "auto" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const reason = `Claude API error (${response.status}): ${detail}`;
      console.error(reason);
      return { ok: false, reason };
    }

    const data = (await response.json()) as {
      content?: {
        type?: string;
        name?: string;
        input?: unknown;
        text?: string;
      }[];
    };
    const block = data.content?.find(
      (item) => item.type === "tool_use" && item.name === tool.name,
    );
    if (block && block.input && typeof block.input === "object") {
      return { ok: true, input: block.input as T };
    }

    const text = (data.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n\n")
      .trim();
    const fallback = text && fallbackFromText ? fallbackFromText(text) : null;
    if (fallback) return { ok: true, input: fallback };

    return { ok: false, reason: "Claude returned no structured reply." };
  } catch (err) {
    const reason = `Claude request failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(reason);
    return { ok: false, reason };
  }
}
