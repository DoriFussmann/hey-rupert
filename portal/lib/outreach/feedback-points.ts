// The client's feedback on copy by source: several points per group, each about
// one email of the sequence or about the whole group. Pure module.
//
// The points travel as the group's one note (item_notes["source:competitor"]),
// one line per point, so Rupert's panel, the history and the redraft prompt
// read them without a new format.

export type FeedbackPoint = {
  id: string;
  /** Position of the email in the sequence, or "all" for the whole group. */
  about: number | "all";
  text: string;
};

export const ALL_EMAILS_LABEL = "Both emails";

const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, " ").trim();

/** "- First email: …" per point: the group's points first, then each email's in sequence order. */
export function feedbackPointsText(points: FeedbackPoint[], labels: readonly string[]) {
  const order = (point: FeedbackPoint) => (point.about === "all" ? -1 : point.about);
  return points
    .map((point, index) => ({ point, index, text: oneLine(point.text) }))
    .filter((entry) => entry.text)
    .sort((a, b) => order(a.point) - order(b.point) || a.index - b.index)
    .map(({ point, text }) => {
      const label = point.about === "all" ? ALL_EMAILS_LABEL : labels[point.about] ?? `Email ${point.about + 1}`;
      return `- ${label}: ${text}`;
    })
    .join("\n");
}

/** How many points there are to send. */
export function feedbackPointCount(points: FeedbackPoint[]) {
  return points.filter((point) => oneLine(point.text)).length;
}
