/** One fund's client marks. Kept here so the merge can be tested without the app. */
export type FundFlag = {
  excluded?: boolean;
  known?: boolean;
  note?: string;
};

/** Only the fields a single click or blur is changing. */
export type FlagPatch = {
  excluded?: boolean;
  known?: boolean;
  note?: string;
};

const NOTE_MAX = 4000;

/**
 * Merges one fund into the map. Other funds are left as they are.
 * A field omitted from the patch is left as it was, so a note save and an
 * exclude toggle do not wipe each other.
 */
export function applyFundFlag(
  flags: Record<string, FundFlag>,
  fundId: string,
  patch: FlagPatch,
): Record<string, FundFlag> {
  const next: FundFlag = { ...(flags[fundId] ?? {}) };
  if (patch.excluded === true) next.excluded = true;
  else if (patch.excluded === false) delete next.excluded;
  if (patch.known === true) next.known = true;
  else if (patch.known === false) delete next.known;
  if (patch.note !== undefined) {
    const note = patch.note.trim().slice(0, NOTE_MAX);
    if (note) next.note = note;
    else delete next.note;
  }
  const copy = { ...flags };
  if (next.excluded || next.known || next.note) copy[fundId] = next;
  else delete copy[fundId];
  return copy;
}

export type FlagSnapshot<T> = T & { flags: Record<string, FundFlag>; stamp: string };

/**
 * Read, merge this fund, write if the row is still the one we read.
 * A lost race retries against the row the other write just saved, at most three times.
 */
export async function commitFundFlag<T extends { flags: Record<string, FundFlag>; stamp: string }>(
  read: () => Promise<FlagSnapshot<T>>,
  write: (snapshot: FlagSnapshot<T>, flags: Record<string, FundFlag>) => Promise<boolean>,
  fundId: string,
  patch: FlagPatch,
): Promise<Record<string, FundFlag> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await read();
    const flags = applyFundFlag(snapshot.flags, fundId, patch);
    if (await write(snapshot, flags)) return flags;
  }
  return null;
}
