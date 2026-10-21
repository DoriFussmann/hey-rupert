/** Inserts Rupert's optional note after the opening paragraph and before the tier bullets. */
export function withClientNote(text: string, note: string | undefined) {
  const trimmed = (note ?? "").replace(/\r\n/g, "\n").trim();
  const body = text.replace(/\r\n/g, "\n");
  if (!trimmed) return body;
  if (!body.trim()) return trimmed;

  const blocks = body.split(/\n{2,}/);
  const bulletAt = blocks.findIndex((block) =>
    block.split("\n").some((line) => line.startsWith("• ")),
  );
  const insertAt = bulletAt >= 0 ? bulletAt : Math.min(blocks.length, 2);
  if (blocks[insertAt - 1]?.trim() === trimmed) return blocks.join("\n\n");
  const next = blocks.slice();
  next.splice(insertAt, 0, trimmed);
  return next.join("\n\n");
}
