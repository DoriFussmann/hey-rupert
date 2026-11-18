/**
 * Versions of the legal documents (Statement of Work, Service Order, NDA,
 * Launch Confirmation) and which clients are on each. Pure, so it can be
 * tested without Supabase.
 */

export const LEGAL_NOTE_MAX = 300;

export type LegalVersion = {
  version: number;
  content: string;
  note: string;
  created_at: string;
  created_by: string | null;
};

/** One document pushed to one client. */
export type LegalSend = {
  client_id: string;
  company_name: string;
  template_version: number | null;
  customized: boolean;
  sent_at: string;
  /** Signed (Service Order, NDA) or confirmed (Statement of Work). */
  completed_at: string | null;
  archived_at: string | null;
};

export type VersionClient = {
  client_id: string;
  company_name: string;
  customized: boolean;
  sent_at: string;
  completed_at: string | null;
  /** False when the client has since been sent a newer document. */
  current: boolean;
};

/** Which version a document being sent came from, and whether it was edited for the client. */
export function stampFor(
  content: string,
  template: { content: string | null; active_version: number | null } | null,
): { template_version: number | null; customized: boolean } {
  const version = template?.active_version ?? null;
  if (version == null) return { template_version: null, customized: false };
  return {
    template_version: version,
    customized: content.trim() !== String(template?.content ?? "").trim(),
  };
}

/**
 * The clients on each version: one row per client per version, taken from the
 * client's latest send of that version. Current clients first, then by name.
 * Sends with no recorded version are under null.
 */
export function clientsByVersion(sends: LegalSend[]): Map<number | null, VersionClient[]> {
  const latest = new Map<string, LegalSend>();
  for (const send of sends) {
    const key = `${send.template_version ?? "none"}:${send.client_id}`;
    const held = latest.get(key);
    if (!held || send.sent_at > held.sent_at) latest.set(key, send);
  }

  const byVersion = new Map<number | null, VersionClient[]>();
  for (const send of Array.from(latest.values())) {
    const list = byVersion.get(send.template_version) ?? [];
    list.push({
      client_id: send.client_id,
      company_name: send.company_name,
      customized: send.customized,
      sent_at: send.sent_at,
      completed_at: send.completed_at,
      current: send.archived_at == null,
    });
    byVersion.set(send.template_version, list);
  }
  for (const list of Array.from(byVersion.values())) {
    list.sort(
      (a, b) => Number(b.current) - Number(a.current) || a.company_name.localeCompare(b.company_name),
    );
  }
  return byVersion;
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

const paragraphs = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Line-by-line difference between two versions (blank lines ignored). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = paragraphs(before);
  const b = paragraphs(after);
  // Longest common subsequence, from the end so the walk below runs forward.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

/** Only the lines that changed, for the "what changed" view. */
export function changedLines(before: string, after: string): DiffLine[] {
  return diffLines(before, after).filter((line) => line.kind !== "same");
}
