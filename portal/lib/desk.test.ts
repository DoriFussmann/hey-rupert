import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  arrangeItems,
  asAttachments,
  assetShelf,
  daysWaiting,
  deskRef,
  filterItems,
  isClientFilePath,
  isDeskUrl,
  nextAssetVersion,
  openingStatus,
  outsideDate,
  ownAttachments,
  publishTitle,
  replyEmailSubject,
  sourceLabel,
  statusAfterReply,
  stepResponseBody,
  titleFrom,
  type DeskItem,
} from "./desk.ts";

const CLIENT = "11111111-1111-4111-8111-111111111111";

test("what the client opens waits on us; our questions wait on them; records start closed", () => {
  for (const type of ["question", "feedback", "materials", "request"] as const) {
    assert.equal(openingStatus(type, "client"), "waiting_us");
  }
  assert.equal(openingStatus("question", "admin"), "waiting_client");
  assert.equal(openingStatus("update", "admin"), "closed");
  assert.equal(openingStatus("shared_asset", "admin"), "closed");
});

test("a client's reply always waits on us and reopens a closed item", () => {
  assert.deepEqual(statusAfterReply("waiting_client", "client"), { status: "waiting_us", event: null });
  assert.deepEqual(statusAfterReply("waiting_us", "client"), { status: "waiting_us", event: null });
  assert.deepEqual(statusAfterReply("closed", "client"), { status: "waiting_us", event: "reopened" });
});

test("our reply waits on the client, unless we close with it or the record is closed", () => {
  assert.deepEqual(statusAfterReply("waiting_us", "admin"), { status: "waiting_client", event: null });
  assert.deepEqual(statusAfterReply("waiting_us", "admin", { close: true }), { status: "closed", event: "closed" });
  assert.deepEqual(statusAfterReply("closed", "admin"), { status: "closed", event: null });
  assert.deepEqual(statusAfterReply("closed", "admin", { close: true }), { status: "closed", event: null });
});

test("the source says where an item came from, with the real date for outside messages", () => {
  const at = "2026-11-25T12:00:00.000Z";
  assert.equal(sourceLabel({ source: "email", step: "investor_list", occurredAt: at }), "Email, Nov 25");
  assert.equal(sourceLabel({ source: "step", step: "investor_list", occurredAt: at }), "Investor List review");
  assert.equal(sourceLabel({ source: "desk", step: "general", occurredAt: at }), "The Desk");
  assert.equal(sourceLabel({ source: "materials", step: "materials", occurredAt: at }), "Company materials");
});

test("a title comes from the first line and is cut at a word", () => {
  assert.equal(titleFrom("\n  Which figure should investors see?\nMore.", "Question"), "Which figure should investors see?");
  assert.equal(titleFrom("   ", "Question"), "Question");
  const long = titleFrom(`${"word ".repeat(40)}`, "Question", 40);
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 41);
  assert.ok(!long.includes("  "));
});

test("an outside message keeps its real date, never one in the future", () => {
  const now = new Date("2026-11-26T19:00:00.000Z");
  assert.deepEqual(outsideDate("2026-11-25", now), { ok: true, iso: "2026-11-25T12:00:00.000Z" });
  assert.equal(outsideDate("2026-12-25", now).ok, false);
  assert.equal(outsideDate("yesterday", now).ok, false);
  assert.equal(outsideDate("2026-13-45", now).ok, false);
});

test("links are https or the client's own portal; nothing else is kept", () => {
  assert.ok(isDeskUrl("https://docs.google.com/document/d/abc"));
  assert.ok(isDeskUrl("/portal/setup/investor-list"));
  assert.ok(isDeskUrl("/portal/what-rupert-knows?open=files"));
  assert.ok(!isDeskUrl("javascript:alert(1)"));
  assert.ok(!isDeskUrl("/admin/clients/x"));
  assert.ok(!isDeskUrl("/portal/../admin"));
  assert.ok(!isDeskUrl("//evil.example/portal"));
  assert.ok(!isDeskUrl("data:text/html,x"));
});

test("attachments are read defensively", () => {
  const list = asAttachments([
    { kind: "file", path: `${CLIENT}/desk/a/deck.pdf`, name: "deck.pdf", size: 10, type: "application/pdf" },
    { kind: "file", path: `${CLIENT}/desk/../other/deck.pdf`, name: "x" },
    { kind: "link", url: "javascript:alert(1)", label: "bad" },
    { kind: "link", url: "/portal/setup/investor-list", label: "Investor list", asset: { title: "Investor List", version: 2 } },
    "nonsense",
    { kind: "other" },
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, "file");
  assert.deepEqual(list[1], {
    kind: "link",
    url: "/portal/setup/investor-list",
    label: "Investor list",
    asset: { title: "Investor List", version: 2 },
  });
  assert.deepEqual(asAttachments(null), []);
});

test("a file must sit in the client's own folder", () => {
  assert.ok(isClientFilePath(CLIENT, `${CLIENT}/desk/x/file.pdf`));
  assert.ok(!isClientFilePath(CLIENT, `22222222-2222-4222-8222-222222222222/desk/x/file.pdf`));
  assert.ok(!isClientFilePath(CLIENT, `${CLIENT}/desk/../../x`));
  assert.ok(!isClientFilePath("", "/desk/x"));
  const other = ownAttachments(CLIENT, [{ kind: "file", path: "22222222-2222-4222-8222-222222222222/desk/f.pdf", name: "f.pdf" }]);
  assert.equal(other.ok, false);
  const own = ownAttachments(CLIENT, [{ kind: "file", path: `${CLIENT}/desk/f.pdf`, name: "f.pdf" }]);
  assert.equal(own.ok && own.attachments.length, 1);
});

test("the asset shelf shows the latest version of each asset, newest first", () => {
  const link = (title: string, version: number) => ({
    kind: "link" as const,
    url: "/portal/setup/investor-list",
    label: title,
    asset: { title, version },
  });
  const shelf = assetShelf([
    { itemId: "a", occurredAt: "2026-11-01T00:00:00Z", attachments: [link("Investor List", 1)] },
    { itemId: "b", occurredAt: "2026-11-10T00:00:00Z", attachments: [link("The 41 left out, with reasons", 1)] },
    { itemId: "c", occurredAt: "2026-11-20T00:00:00Z", attachments: [link("investor  list", 2)] },
    { itemId: "d", occurredAt: "2026-11-21T00:00:00Z", attachments: [{ kind: "link", url: "https://x.example", label: "not an asset" }] },
  ]);
  assert.deepEqual(
    shelf.map((asset) => [asset.title, asset.version, asset.itemId, asset.versions]),
    [
      ["investor  list", 2, "c", 2],
      ["The 41 left out, with reasons", 1, "b", 1],
    ],
  );
  assert.equal(nextAssetVersion(shelf, "Investor List"), 3);
  assert.equal(nextAssetVersion(shelf, "Competitive Landscape & Deals"), 1);
});

test("each side sees what waits on them first, oldest first; the rest newest first", () => {
  const item = (id: string, status: DeskItem["status"], lastMessageAt: string) => ({ id, status, lastMessageAt });
  const items = [
    item("closed-new", "closed", "2026-11-25T00:00:00Z"),
    item("us-new", "waiting_us", "2026-11-24T00:00:00Z"),
    item("client-old", "waiting_client", "2026-11-01T00:00:00Z"),
    item("us-old", "waiting_us", "2026-11-02T00:00:00Z"),
    item("client-new", "waiting_client", "2026-11-20T00:00:00Z"),
  ];
  const client = arrangeItems(items, "client");
  assert.deepEqual(client.waiting.map((i) => i.id), ["client-old", "client-new"]);
  assert.deepEqual(client.rest.map((i) => i.id), ["closed-new", "us-new", "us-old"]);
  const admin = arrangeItems(items, "admin");
  assert.deepEqual(admin.waiting.map((i) => i.id), ["us-old", "us-new"]);
  assert.deepEqual(admin.rest.map((i) => i.id), ["closed-new", "client-new", "client-old"]);
});

test("filters by step, type and status", () => {
  const items = [
    { step: "investor_list", type: "feedback", status: "waiting_us" },
    { step: "investor_list", type: "update", status: "closed" },
    { step: "general", type: "question", status: "waiting_client" },
  ] as const;
  assert.equal(filterItems([...items], {}).length, 3);
  assert.equal(filterItems([...items], { step: "investor_list" }).length, 2);
  assert.equal(filterItems([...items], { step: "investor_list", type: "update" }).length, 1);
  assert.equal(filterItems([...items], { status: "waiting_client", step: "" }).length, 1);
});

test("days waiting counts whole days", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  assert.equal(daysWaiting("2026-11-26T08:00:00Z", now), 0);
  assert.equal(daysWaiting("2026-11-23T11:00:00Z", now), 3);
  assert.equal(daysWaiting("not a date", now), 0);
});

test("the email subject says what was answered", () => {
  const base = { title: "Which figure?", openedBy: "client" as const };
  assert.equal(
    replyEmailSubject({ ...base, type: "question", step: "investor_list" }),
    "Rupert answered your question about the investor list",
  );
  assert.equal(replyEmailSubject({ ...base, type: "question", step: "general" }), "Rupert answered your question");
  assert.equal(
    replyEmailSubject({ ...base, type: "feedback", step: "framing" }),
    "Rupert replied to your feedback on the outreach narrative",
  );
  assert.equal(
    replyEmailSubject({ title: "Competitive Landscape & Deals", openedBy: "admin", type: "shared_asset", step: "general" }, { opening: true }),
    "Rupert shared “Competitive Landscape & Deals” with you",
  );
  assert.equal(
    replyEmailSubject({ title: "x", openedBy: "admin", type: "question", step: "email_copy" }, { opening: true }),
    "Rupert has a question for you about the email copy",
  );
});

test("a step response reads as the client wrote it", () => {
  assert.equal(
    stepResponseBody({
      decision: "changes_requested",
      version: 2,
      note: "Please drop the two crypto funds.",
      itemNotes: [{ label: "Acre Venture Partners", note: "We know them." }],
    }),
    "Asked for changes to version 2.\n\nPlease drop the two crypto funds.\n\nAcre Venture Partners: We know them.",
  );
  assert.equal(stepResponseBody({ decision: "confirmed", version: 1, note: "", itemNotes: [] }), "Confirmed version 1.");
});

test("publish titles and event keys are stable", () => {
  assert.equal(publishTitle("investor_list", 1), "Your investor list is ready");
  assert.equal(publishTitle("investor_list", 3), "Your investor list is updated");
  assert.equal(publishTitle("email_copy", 1), "Your outreach emails are ready");
  assert.equal(deskRef.published("framing", 2), "step:framing:v2");
  assert.equal(deskRef.response("framing", 2), "step:framing:v2:response");
  assert.notEqual(deskRef.question("abc"), deskRef.answer("abc"));
});

// The database is the second line of defence: hold the migration to what the brief asks.
test("the migration enforces the record in the database", () => {
  const sql = readFileSync(new URL("../supabase/desk.sql", import.meta.url), "utf8");
  for (const table of ["desk_items", "desk_messages", "desk_notes"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  // Clients read; nobody writes through the API.
  assert.match(sql, /create policy desk_items_read on public\.desk_items\s+for select/);
  assert.match(sql, /create policy desk_messages_read on public\.desk_messages\s+for select/);
  assert.doesNotMatch(sql, /create policy[^;]*for (insert|update|delete|all)/i);
  // Internal notes: no policy and no grant at all.
  assert.doesNotMatch(sql, /create policy[^;]*desk_notes/i);
  assert.doesNotMatch(sql, /grant[^;]*desk_notes/i);
  // Messages can't be edited or deleted, whatever the role.
  assert.match(sql, /before update or delete on public\.desk_messages/);
  assert.match(sql, /before truncate on public\.desk_messages/);
});
