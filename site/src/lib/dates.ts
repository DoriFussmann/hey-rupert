export function isoDate(value: Date): string {
  return value.toISOString();
}

function calendarDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function displayDate(value: Date): string {
  const [year, month, day] = calendarDay(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** True when `updated` falls on a later UTC calendar day than `published`. */
export function isLaterCalendarDay(updated: Date, published: Date): boolean {
  return calendarDay(updated) > calendarDay(published);
}
