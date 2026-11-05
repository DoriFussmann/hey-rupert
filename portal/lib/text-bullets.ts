// Bullet points in plain-text emails. Pure module.
// A bullet is "• " at the start of a line; an indented (second-level) bullet is "  ◦ ".
// The email's HTML turns them into lists (see investorListEmailHtml).

export const BULLET = "• ";
export const SUB_BULLET = "  ◦ ";

/** The bullet a line starts with ("• ", "  ◦ ", or "- " written by hand), if any. */
export function bulletOf(line: string): { prefix: string; level: 1 | 2; rest: string } | null {
  const m = line.match(/^(\s*)([•◦\-*])\s+/);
  if (!m) return null;
  const level = m[1].length > 0 || m[2] === "◦" ? 2 : 1;
  return { prefix: m[0], level, rest: line.slice(m[0].length) };
}

/** The selected lines (or the cursor's line): where they start and end. */
function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const stop = text.indexOf("\n", Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), from));
  return { from, to: stop === -1 ? text.length : stop };
}

function replaceLines(text: string, start: number, end: number, map: (lines: string[]) => string[]) {
  const { from, to } = lineRange(text, start, end);
  const block = map(text.slice(from, to).split("\n")).join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

/** Each selected line gets "• ", or loses its bullet when every selected line already has one. */
export function toggleBullets(text: string, start: number, end: number) {
  return replaceLines(text, start, end, (lines) => {
    const filled = lines.filter((line) => line.trim());
    const remove = filled.length > 0 && filled.every((line) => bulletOf(line));
    return lines.map((line) => {
      const b = bulletOf(line);
      if (remove) return b ? b.rest : line;
      if (!line.trim() && lines.length > 1) return line;
      return b ? line : BULLET + line;
    });
  });
}

/** Indents the selected lines one level ("• " → "  ◦ "; a plain line becomes "• "), or outdents them ("  ◦ " → "• " → plain). */
export function indentBullets(text: string, start: number, end: number, outdent = false) {
  return replaceLines(text, start, end, (lines) =>
    lines.map((line) => {
      if (!line.trim() && lines.length > 1) return line;
      const b = bulletOf(line);
      if (outdent) {
        if (!b) return line;
        return b.level === 2 ? BULLET + b.rest : b.rest;
      }
      if (!b) return BULLET + line;
      return SUB_BULLET + b.rest;
    }),
  );
}

/**
 * Enter on a bullet line: the next line starts with the same bullet. Enter on
 * an empty bullet ends the list (the bullet goes). Null: not on a bullet line.
 */
export function continueBullet(text: string, cursor: number): { text: string; cursor: number } | null {
  const from = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const stop = text.indexOf("\n", cursor);
  const line = text.slice(from, stop === -1 ? text.length : stop);
  const b = bulletOf(line);
  if (!b || cursor < from + b.prefix.length) return null;
  if (!b.rest.trim()) return { text: text.slice(0, from) + text.slice(from + b.prefix.length), cursor: from };
  const prefix = b.level === 2 ? SUB_BULLET : BULLET;
  return { text: text.slice(0, cursor) + "\n" + prefix + text.slice(cursor), cursor: cursor + 1 + prefix.length };
}
