import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAUNCH_CONFIRMATION,
  cleanPostalAddress,
  fillLaunchConfirmation,
  planMonthsOf,
  postalAddressProblem,
  withPostalAddress,
} from "./launch-confirmation.ts";

const fields = {
  company: "Acme, Inc.",
  funds: 120,
  contacts: 230,
  inbox: "jane@acme.com",
  monthlyFee: "$1,000",
  planMonths: 2,
  earlierServiceOrder: null,
};

test("fills every field except the postal address", () => {
  const text = fillLaunchConfirmation(DEFAULT_LAUNCH_CONFIRMATION, fields);
  assert.match(text, /and Acme, Inc\. \("Client"\)/);
  assert.match(text, /\(120 funds, 230 contacts\)/);
  assert.match(text, /one inbox: jane@acme\.com\./);
  assert.match(text, /Monthly Campaign Fee is \$1,000 per Service Month/);
  assert.match(text, /230 contacts would take about 2 months/);
  assert.match(text, /\[CLIENT_POSTAL_ADDRESS\]/);
  assert.doesNotMatch(text.replace("[CLIENT_POSTAL_ADDRESS]", ""), /\[[A-Z_]+\]/);
});

test("leaves the earlier-Service-Order paragraph out for a client on the current version", () => {
  const text = fillLaunchConfirmation(DEFAULT_LAUNCH_CONFIRMATION, fields);
  assert.doesNotMatch(text, /Current terms/);
  assert.doesNotMatch(text, /Include only/);
  assert.match(text, /\*\*9\. Part of the Service Order\.\*\*/);
});

test("keeps it, filled in, for a client who signed an earlier version", () => {
  const text = fillLaunchConfirmation(DEFAULT_LAUNCH_CONFIRMATION, {
    ...fields,
    earlierServiceOrder: { currentVersion: 3, signedOn: "October 27, 2026" },
  });
  assert.match(text, /\*\*10\. Current terms\.\*\* Service Order version 3, available/);
  assert.match(text, /signed on October 27, 2026\./);
  assert.doesNotMatch(text, /Include only/);
});

test("escapes markdown in what the client typed", () => {
  const text = withPostalAddress("at [CLIENT_POSTAL_ADDRESS].", "12 *Main* St");
  assert.equal(text, "at 12 \\*Main\\* St.");
  assert.equal(withPostalAddress("at [CLIENT_POSTAL_ADDRESS].", " "), "at [your postal address].");
});

test("cleans and checks the postal address", () => {
  assert.equal(cleanPostalAddress("12 Main St\nSuite 4 \n Austin, TX 78701"), "12 Main St, Suite 4, Austin, TX 78701");
  assert.equal(postalAddressProblem("12 Main St, Austin, TX 78701"), null);
  assert.match(postalAddressProblem("") ?? "", /Enter your company/);
  assert.match(postalAddressProblem("Austin") ?? "", /full postal address/);
  assert.match(postalAddressProblem("x".repeat(150) + " 12345 " + "y".repeat(80)) ?? "", /under 200/);
});

test("turns plan weeks into whole months", () => {
  assert.equal(planMonthsOf(0), 1);
  assert.equal(planMonthsOf(4), 1);
  assert.equal(planMonthsOf(8), 2);
  assert.equal(planMonthsOf(10), 3);
});
