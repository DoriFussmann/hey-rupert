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

export type ClaudeMessage = {
  role: "user" | "assistant";
  /** Plain text, or content blocks (e.g. a PDF document with text). */
  content: string | ClaudeContentBlock[];
};

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
  timeoutMs = TIMEOUT_MS,
  fallbackFromText,
}: {
  system: string;
  messages: ClaudeMessage[];
  tool: ClaudeTool;
  maxTokens?: number;
  timeoutMs?: number;
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
      signal: AbortSignal.timeout(timeoutMs),
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

// ---------------------------------------------------------------------------
// Agent calls: rich content (PDFs, images, text documents) and Anthropic's
// server-side web fetch, with the answer delivered through one output tool.

/** A user content block, passed through to the Messages API as is. */
export type ClaudeContentBlock = Record<string, unknown>;

/** Reads only links that already appear in the conversation. */
export function webFetchTool(maxUses: number) {
  return { type: "web_fetch_20250910", name: "web_fetch", max_uses: maxUses };
}

type ApiBlock = {
  type?: string;
  name?: string;
  input?: unknown;
  text?: string;
};

type ApiResponse = { content?: ApiBlock[]; stop_reason?: string };

const AGENT_TIMEOUT_MS = 270_000;
// Long server-tool turns come back as "pause_turn"; each one is resumed.
const MAX_CONTINUATIONS = 4;

/**
 * Runs one agent task. Claude may use the server tools (e.g. web fetch) and
 * must finish by calling `tool`. When the account cannot use a server tool,
 * the call is retried once without server tools and `serverToolsSkipped` is
 * set, so the caller can say so.
 */
export async function callClaudeAgent<T>({
  system,
  content,
  tool,
  serverTools = [],
  maxTokens = 8000,
}: {
  system: string;
  content: ClaudeContentBlock[];
  tool: ClaudeTool;
  serverTools?: Record<string, unknown>[];
  maxTokens?: number;
}): Promise<
  | { ok: true; input: T; serverToolsSkipped: boolean }
  | { ok: false; reason: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured." };
  }

  const deadline = Date.now() + AGENT_TIMEOUT_MS;

  async function post(messages: unknown[], tools: Record<string, unknown>[]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false as const, status: 0, detail: "timed out" };
    }
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey!,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        tool_choice: { type: "auto" },
      }),
      signal: AbortSignal.timeout(remaining),
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        detail: (await response.text()).slice(0, 500),
      };
    }
    return { ok: true as const, data: (await response.json()) as ApiResponse };
  }

  async function run(withServerTools: boolean) {
    const tools = [...(withServerTools ? serverTools : []), tool];
    const messages: unknown[] = [{ role: "user", content }];
    let nudged = false;

    for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn += 1) {
      const result = await post(messages, tools);
      if (!result.ok) return result;

      const blocks = result.data.content ?? [];
      const call = blocks.find(
        (block) => block.type === "tool_use" && block.name === tool.name,
      );
      if (call && call.input && typeof call.input === "object") {
        return { ok: true as const, input: call.input as T };
      }

      const stop = result.data.stop_reason;
      if (stop === "max_tokens") {
        return {
          ok: false as const,
          status: 0,
          detail: "the answer was too long and got cut off",
        };
      }
      messages.push({ role: "assistant", content: blocks });
      if (stop === "pause_turn") continue;
      if (nudged) break;
      // Answered in plain text: ask once for the tool call.
      nudged = true;
      messages.push({
        role: "user",
        content: `Now deliver your result by calling the ${tool.name} tool.`,
      });
    }
    return {
      ok: false as const,
      status: 0,
      detail: "Claude did not return a structured result",
    };
  }

  try {
    let result = await run(serverTools.length > 0);
    let skipped = false;
    if (
      !result.ok &&
      serverTools.length > 0 &&
      result.status === 400 &&
      /web_fetch|server tool|tool type/i.test(result.detail)
    ) {
      skipped = true;
      result = await run(false);
    }
    if (!result.ok) {
      const reason = result.status
        ? `Claude API error (${result.status}): ${result.detail}`
        : `Claude request failed: ${result.detail}.`;
      console.error(reason);
      return { ok: false, reason };
    }
    return { ok: true, input: result.input, serverToolsSkipped: skipped };
  } catch (err) {
    const reason = `Claude request failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(reason);
    return { ok: false, reason };
  }
}
