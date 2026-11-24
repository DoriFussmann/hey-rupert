import { test } from "node:test";
import assert from "node:assert/strict";
import { federalHolidayOn, federalHolidays } from "./holidays.ts";

test("2026: the eleven observed federal holidays", () => {
  assert.deepEqual(Array.from(federalHolidays(2026).keys()).sort(), [
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  ]);
});

test("Thanksgiving this week, and the Friday after is a Business Day", () => {
  assert.equal(federalHolidayOn("2026-11-26"), "Thanksgiving Day");
  assert.equal(federalHolidayOn("2026-11-27"), null);
  assert.equal(federalHolidayOn("2026-11-24"), null);
});

test("observed days: Saturday to Friday, Sunday to Monday, New Year across years", () => {
  assert.equal(federalHolidayOn("2026-07-03"), "Independence Day", "July 4, 2026 is a Saturday");
  assert.equal(federalHolidayOn("2027-07-05"), "Independence Day", "July 4, 2027 is a Sunday");
  assert.equal(federalHolidayOn("2027-12-24"), "Christmas Day", "Dec 25, 2027 is a Saturday");
  assert.equal(federalHolidayOn("2027-12-31"), "New Year's Day", "Jan 1, 2028 is a Saturday");
  assert.equal(federalHolidays(2028).has("2028-01-01"), false);
  assert.equal(federalHolidayOn("2028-11-23"), "Thanksgiving Day");
});
