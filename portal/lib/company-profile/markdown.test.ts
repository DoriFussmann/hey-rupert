import assert from "node:assert/strict";
import { test } from "node:test";
import { companyProfileMarkdown, profileFileName } from "./markdown.ts";

test("the markdown has the overview first, then every profile section", () => {
  const markdown = companyProfileMarkdown({
    company: "Acme Robotics",
    exportedAt: "2026-10-23T12:00:00Z",
    brief: {
      summary: "Acme builds warehouse robots.",
      industry: "Robotics",
      geography: "California",
      stage: "Seed",
      raise_amount: "$3M",
      generated_at: "",
      based_on: "",
      edited_at: null,
    },
    answers: { company_name: "Acme Robotics", stage: "Seed", raise_amount: "$3M" },
    classification: null,
  });
  assert.ok(markdown.startsWith("# Acme Robotics: Company Profile"));
  assert.ok(markdown.indexOf("## Overview") < markdown.indexOf("## Company"));
  assert.ok(markdown.includes("Acme builds warehouse robots."));
  assert.ok(markdown.includes("- **Raising:** $3M"));
  assert.ok(markdown.includes("## Round"));
  assert.ok(markdown.includes("- **Instrument:** Equity (default)"));
});

test("the file name is a safe slug", () => {
  assert.equal(profileFileName("Acme Robotics, Inc."), "acme-robotics-inc-company-profile.md");
  assert.equal(profileFileName("   "), "company-company-profile.md");
});
