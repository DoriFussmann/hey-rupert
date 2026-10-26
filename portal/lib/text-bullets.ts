// Bullet points in plain-text emails: each selected line gets "• " in front,
// or loses it when every selected line already has one. Pure module.

export const BULLET = "• ";

export function toggleBullets(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const stop = text.indexOf("\n", Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), from));
  const to = stop === -1 ? text.length : stop;
  const lines = text.slice(from, to).split("\n");
  const filled = lines.filter((line) => line.trim());
  const remove = filled.length > 0 && filled.every((line) => line.startsWith(BULLET));
  const changed = lines.map((line) => {
    if (remove) return line.startsWith(BULLET) ? line.slice(BULLET.length) : line;
    if (!line.trim() && lines.length > 1) return line;
    return line.startsWith(BULLET) ? line : BULLET + line;
  });
  const block = changed.join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}
