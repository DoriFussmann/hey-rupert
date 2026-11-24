// US federal holidays (5 U.S.C. 6103), with the observed day for those on a
// fixed date: Saturday moves to the Friday before, Sunday to the Monday after.
// The Service Order (1.5) defines a Business Day as Monday to Friday,
// excluding these, and the campaign sends on Business Days only (4.2).

/** YYYY-MM-DD of the nth (1-based) weekday (0 Sunday … 6 Saturday) of a month; n = -1 is the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return iso(year, month, lastDay - ((last - weekday + 7) % 7));
}

function iso(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** A fixed-date holiday's observed day. */
function observed(year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 6) return iso(year, month, day - 1);
  if (weekday === 0) return iso(year, month, day + 1);
  return iso(year, month, day);
}

/** The observed federal holidays of a year, by date. */
export function federalHolidays(year: number): Map<string, string> {
  const days: [string, string][] = [
    [observed(year, 1, 1), "New Year's Day"],
    [nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day"],
    [nthWeekday(year, 2, 1, 3), "Washington's Birthday"],
    [nthWeekday(year, 5, 1, -1), "Memorial Day"],
    [observed(year, 6, 19), "Juneteenth"],
    [observed(year, 7, 4), "Independence Day"],
    [nthWeekday(year, 9, 1, 1), "Labor Day"],
    [nthWeekday(year, 10, 1, 2), "Columbus Day"],
    [observed(year, 11, 11), "Veterans Day"],
    [nthWeekday(year, 11, 4, 4), "Thanksgiving Day"],
    [observed(year, 12, 25), "Christmas Day"],
  ];
  // New Year's Day on a Saturday is observed on Dec 31 of the year before.
  const nextNewYear = observed(year + 1, 1, 1);
  if (nextNewYear.startsWith(`${year}-`)) days.push([nextNewYear, "New Year's Day"]);
  return new Map(days.filter(([date]) => date.startsWith(`${year}-`)));
}

/** The holiday's name when `day` (YYYY-MM-DD) is an observed US federal holiday, else null. */
export function federalHolidayOn(day: string): string | null {
  const year = Number(day.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return federalHolidays(year).get(day) ?? null;
}
