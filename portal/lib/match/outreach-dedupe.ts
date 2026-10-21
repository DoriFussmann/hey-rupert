/** Collapse duplicate firms and emails when an outreach sheet is built. */

export type OutreachFirm = { id: string; web: string; contacts: number };

/** Website host, without protocol, www, or a path. Blank when the firm has no website. */
export function outreachDomain(web: string) {
  return web
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function emailKey(email: string) {
  return email.trim().toLowerCase();
}

/** Investing contacts used for the duplicate rule. Older rows stored the count only in the contact sentence. */
export function listedContacts(contactCount: number | undefined, contact: string | undefined) {
  if (typeof contactCount === "number" && Number.isFinite(contactCount) && contactCount >= 0) {
    return contactCount;
  }
  const match = /^(\d+) investing contact/.exec(contact ?? "");
  return match ? Number(match[1]) : 0;
}

export type DuplicateFlag = {
  excluded?: boolean;
  known?: boolean;
  note?: string;
};

/** Firm ids left off the client list: same website domain, fewer investing contacts, then a higher FirmID. */
export function hiddenDuplicateIds(firms: OutreachFirm[]) {
  const keep = firmsToKeep(firms);
  const hidden = new Set<string>();
  for (const firm of firms) {
    if (!keep.has(firm.id)) hidden.add(firm.id);
  }
  return hidden;
}

function mergeFlags(kept: DuplicateFlag | undefined, dropped: DuplicateFlag): DuplicateFlag {
  const left = kept?.note?.trim() ?? "";
  const right = dropped.note?.trim() ?? "";
  const note = left && right && left !== right ? `${left}\n\n${right}` : left || right;
  const next: DuplicateFlag = {};
  if (kept?.excluded || dropped.excluded) next.excluded = true;
  if (kept?.known || dropped.known) next.known = true;
  if (note) next.note = note.slice(0, 4000);
  return next;
}

/**
 * Copies flags from a hidden duplicate onto the fund the client still sees.
 * The dropped fund keeps its own flag. Excluded or known on either side stays
 * set. Two different notes are both kept.
 */
export function carryDuplicateFlags(
  firms: OutreachFirm[],
  flags: Record<string, DuplicateFlag> | undefined,
): Record<string, DuplicateFlag> | undefined {
  if (!flags || Object.keys(flags).length === 0) return flags;
  const keep = firmsToKeep(firms);
  const keeperByDomain = new Map<string, string>();
  for (const firm of firms) {
    if (!keep.has(firm.id)) continue;
    const domain = outreachDomain(firm.web);
    if (domain) keeperByDomain.set(domain, firm.id);
  }
  const next: Record<string, DuplicateFlag> = { ...flags };
  for (const firm of firms) {
    if (keep.has(firm.id)) continue;
    const domain = outreachDomain(firm.web);
    const keeperId = domain ? keeperByDomain.get(domain) : undefined;
    const dropped = keeperId ? next[firm.id] : undefined;
    if (!keeperId || !dropped) continue;
    next[keeperId] = mergeFlags(next[keeperId], dropped);
  }
  return next;
}

/**
 * Firms to keep. Same website domain: keep the one with more contacts, then the
 * lower FirmID. A firm with no website is kept on its own.
 */
export function firmsToKeep(firms: OutreachFirm[]) {
  const groups = new Map<string, OutreachFirm[]>();
  const keep = new Set<string>();
  for (const firm of firms) {
    const domain = outreachDomain(firm.web);
    if (!domain) {
      keep.add(firm.id);
      continue;
    }
    const list = groups.get(domain) ?? [];
    list.push(firm);
    groups.set(domain, list);
  }
  for (const list of Array.from(groups.values())) {
    const [chosen] = [...list].sort((a, b) => b.contacts - a.contacts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (chosen) keep.add(chosen.id);
  }
  return keep;
}
