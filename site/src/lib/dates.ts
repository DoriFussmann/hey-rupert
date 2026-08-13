export function isoDate(value: Date): string {
  return value.toISOString();
}

export function displayDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** True when `updated` falls on a later UTC calendar day than `published`. */
export function isLaterCalendarDay(updated: Date, published: Date): boolean {
  return displayDate(updated) > displayDate(published);
}
