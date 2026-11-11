import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_REPLY,
  cleanReply,
  collectPoints,
  isUnsent,
  pointsFromResponse,
  replyEmail,
  splitNote,
  REPLY_MAX,
} from "./feedback-points.ts";

const response = {
  decision: "changes_requested" as const,
  note: "",
  version: 2,
  at: "2026-11-11T16:58:09.456Z",
  item_notes: {
    "source:market":
      '- Both emails: Why not remove the word "seed" ?\n- First email: I wouldn\'t offer to send the deck.\n- Follow-up: I wouldn\'t offer to send the deck.',
    "source:competitor":
      "- First email: - Will be linking the company website? - How much was the acquisition for?\n- Follow-up: - The 5 months is not impressive.",
  },
  item_labels: { "source:market": "Market Fit", "source:competitor": "Competitor Investors" },
};

test("a note of bullet lines is one point per line, with the email it is about", () => {
  assert.deepEqual(splitNote("- First email: Too long.\n- Follow-up: Fine."), [
    { label: "First email", text: "Too long." },
    { label: "Follow-up", text: "Fine." },
  ]);
});

test("a line that doesn't start a point continues the one above", () => {
  assert.deepEqual(splitNote("- Both emails: First line.\nSecond line."), [
    { label: "Both emails", text: "First line.\nSecond line." },
  ]);
});

test("a plain note is one point, and a colon inside it is not a label", () => {
  assert.deepEqual(splitNote("This is a good one: keep it.\nAnd this."), [
    { label: "", text: "This is a good one: keep it.\nAnd this." },
  ]);
  assert.deepEqual(splitNote("   "), []);
});

test("an answer becomes one point per line, labelled with its group", () => {
  const points = pointsFromResponse(response, "Nabil");
  assert.equal(points.length, 5);
  assert.equal(points[0].label, "Market Fit · Both emails");
  assert.equal(points[0].author, "Nabil");
  assert.equal(points[3].label, "Competitor Investors · First email");
  assert.equal(points[3].text, "- Will be linking the company website? - How much was the acquisition for?");
  assert.equal(new Set(points.map((point) => point.id)).size, 5);
});

test("a point keeps its id when more feedback is added after it", () => {
  const before = pointsFromResponse(response, "Nabil").map((point) => point.id);
  const more = {
    ...response,
    item_notes: { ...response.item_notes, "source:market": `${response.item_notes["source:market"]}\n- First email: One more.` },
  };
  const after = pointsFromResponse(more, "Nabil").map((point) => point.id);
  for (const id of before) assert.ok(after.includes(id));
  assert.equal(after.length, before.length + 1);
});

test("the same words on two emails of one group are two points", () => {
  const points = pointsFromResponse(response, "Nabil");
  assert.notEqual(points[1].id, points[2].id);
  const twice = pointsFromResponse({ ...response, item_notes: { a: "- Same.\n- Same." }, item_labels: { a: "A" } }, "N");
  assert.equal(new Set(twice.map((point) => point.id)).size, 2);
});

test("points are listed newest version first, viewers after the client", () => {
  const points = collectPoints({
    history: [
      { version: 1, published_at: "", response: { ...response, version: 1, note: "Old note", item_notes: {}, item_labels: {} } },
      { version: 2, published_at: "", response },
    ],
    response,
    comments: [
      { id: "x1", step: "email_copy", version: 2, viewerName: "Prathna Ramesh", body: "Lead with customers.", createdAt: "" },
    ],
    clientName: "Nabil",
  });
  assert.equal(points.length, 7);
  assert.equal(points[0].version, 2);
  assert.deepEqual(
    { id: points[5].id, source: points[5].source, author: points[5].author },
    { id: "v-x1", source: "viewer", author: "Prathna Ramesh" },
  );
  assert.equal(points[6].version, 1);
  assert.equal(points[6].label, "General");
});

test("a reply is unsent until it is sent as it stands", () => {
  assert.equal(isUnsent(EMPTY_REPLY), false);
  assert.equal(isUnsent({ ...EMPTY_REPLY, reply: "Done." }), true);
  assert.equal(isUnsent({ ...EMPTY_REPLY, status: "changed" }), true);
  const sent = { reply: "Done.", status: "changed" as const, publishedReply: "Done.", publishedStatus: "changed" as const, publishedAt: "2026-11-11" };
  assert.equal(isUnsent(sent), false);
  assert.equal(isUnsent({ ...sent, reply: "Done, in all three." }), true);
});

test("a reply over the limit is refused", () => {
  assert.equal(cleanReply("a".repeat(REPLY_MAX)).ok, true);
  assert.equal(cleanReply("a".repeat(REPLY_MAX + 1)).ok, false);
  assert.deepEqual(cleanReply("  ok \r\n"), { ok: true, reply: "ok" });
});

test("the email lists each reply with who said what", () => {
  const email = replyEmail({
    firstName: "Nabil",
    stepLabel: "Email Copy",
    version: 2,
    portalUrl: "https://example.com/portal/setup/email-copy",
    signature: "Dori\nHey Rupert",
    replies: [
      { author: "Nabil", source: "client", label: "Market Fit · Both emails", point: "Drop seed.", reply: "Now round.", status: "changed" },
      { author: "Prathna Ramesh", source: "viewer", label: "Comment", point: "Add links.", reply: "They hurt deliverability.", status: "not_changing" },
    ],
  });
  assert.equal(email.subject, "My replies to your feedback on the Email Copy");
  assert.match(email.body, /1\. Nabil, Market Fit · Both emails:\n"Drop seed\."\n\nMy reply: Changed\. Now round\./);
  assert.match(email.body, /2\. Prathna Ramesh \(viewer\), Comment:/);
  assert.match(email.body, /Not changing\. They hurt deliverability\./);
});
