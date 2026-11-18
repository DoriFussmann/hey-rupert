import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changedLines, clientsByVersion, diffLines, stampFor, type LegalSend } from "./legal-versions.ts";
import { DEFAULT_SERVICE_ORDER, monthlyFeeOf, setupFeeOf } from "./service-order.ts";
import { DEFAULT_STATEMENT_OF_WORK } from "./statement-of-work.ts";

const send = (over: Partial<LegalSend>): LegalSend => ({
  client_id: "c1",
  company_name: "Acme",
  template_version: 1,
  customized: false,
  sent_at: "2026-11-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
  ...over,
});

test("stamps a send with the active version", () => {
  assert.deepEqual(stampFor("Text\n", { content: "Text", active_version: 3 }), { template_version: 3, customized: false });
});

test("marks an edited text as customized", () => {
  assert.deepEqual(stampFor("Text, $600", { content: "Text, $1,000", active_version: 3 }), { template_version: 3, customized: true });
});

test("records no version when the template has none", () => {
  assert.deepEqual(stampFor("Text", { content: "Text", active_version: null }), { template_version: null, customized: false });
  assert.deepEqual(stampFor("Text", null), { template_version: null, customized: false });
});

test("lists each client once per version, from its latest send", () => {
  const grouped = clientsByVersion([
    send({ sent_at: "2026-11-01T00:00:00Z", archived_at: "2026-11-02T00:00:00Z" }),
    send({ sent_at: "2026-11-03T00:00:00Z", completed_at: "2026-11-04T00:00:00Z" }),
    send({ client_id: "c2", company_name: "Zed", template_version: 2, customized: true }),
  ]);
  assert.equal(grouped.get(1)?.length, 1);
  assert.equal(grouped.get(1)?.[0].current, true);
  assert.equal(grouped.get(1)?.[0].completed_at, "2026-11-04T00:00:00Z");
  assert.equal(grouped.get(2)?.[0].customized, true);
});

test("a client moved to a newer version stays listed on the old one as replaced", () => {
  const grouped = clientsByVersion([
    send({ archived_at: "2026-11-02T00:00:00Z" }),
    send({ template_version: 2, sent_at: "2026-11-03T00:00:00Z" }),
    send({ client_id: "c2", company_name: "Beta" }),
  ]);
  assert.deepEqual(grouped.get(1)?.map((row) => [row.company_name, row.current]), [["Beta", true], ["Acme", false]]);
  assert.equal(grouped.get(2)?.[0].current, true);
});

test("keeps sends with no recorded version apart", () => {
  const grouped = clientsByVersion([send({ template_version: null })]);
  assert.equal(grouped.get(null)?.length, 1);
});

test("diffs by line and ignores blank lines", () => {
  assert.deepEqual(diffLines("a\n\nb\nc", "a\nb2\n\nc\nd"), [
    { kind: "same", text: "a" },
    { kind: "removed", text: "b" },
    { kind: "added", text: "b2" },
    { kind: "same", text: "c" },
    { kind: "added", text: "d" },
  ]);
  assert.deepEqual(changedLines("a\nb", "a\nb"), []);
});

// The default documents must keep the lines the portal reads fees from, and
// must not use markdown the portal doesn't render.
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("the default Service Order and Statement of Work state both fees", () => {
  for (const text of [DEFAULT_SERVICE_ORDER, DEFAULT_STATEMENT_OF_WORK]) {
    assert.equal(setupFeeOf(text), "$250");
    assert.equal(monthlyFeeOf(text), "$1,000");
  }
});

test("the default documents have no markdown tables", () => {
  for (const file of ["./service-order.ts", "./statement-of-work.ts", "./nda.ts", "./launch-confirmation.ts"]) {
    assert.doesNotMatch(source(file), /^\|.*\|$/m, file);
  }
});

test("the documents agree on the sending plan", () => {
  const so = DEFAULT_SERVICE_ORDER;
  const sow = DEFAULT_STATEMENT_OF_WORK;
  const lc = source("./launch-confirmation.ts");
  assert.match(so, /up to 15 emails per Business Day/);
  assert.match(so, /up to 30 emails per Business Day/);
  assert.match(so, /5 Business Days after the first email/);
  assert.match(sow, /up to 15 emails a day/);
  assert.match(sow, /up to 30 emails a day/);
  assert.match(sow, /5 business days later/);
  assert.match(lc, /up to 15 emails per Business Day/);
  assert.match(lc, /up to 30 emails per Business Day/);
  assert.match(lc, /5 Business Days later/);
});

test("the migration keeps versions unchangeable and saves through one function", () => {
  const sql = source("../supabase/legal_versions.sql");
  assert.match(sql, /legal_save_version/);
  assert.match(sql, /template_version integer/);
});
