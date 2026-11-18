// Dynamic fields in email text: {{first_name}}. Pure module.

export type FieldSpan = { start: number; end: number; field: string; known: boolean };

/** Where each {{field}} sits in a text, and whether it is one of the allowed fields. */
export function fieldSpans(text: string, allowed: readonly string[]): FieldSpan[] {
  return Array.from(text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    field: match[1],
    known: allowed.includes(match[1]),
  }));
}

/** A text with `piece` put in place of the selection; the cursor lands after it. */
export function insertAt(text: string, start: number, end: number, piece: string) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + piece + text.slice(to), cursor: from + piece.length };
}
