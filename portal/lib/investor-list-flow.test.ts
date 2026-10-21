import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFundFlag } from "./investor-flags.ts";
import { withClientNote } from "./investor-list-note.ts";
import {
  carryDuplicateFlags,
  hiddenDuplicateIds,
  listedContacts,
  type OutreachFirm,
} from "./match/outreach-dedupe.ts";

/** Vault Extracts twins, using the contact counts on the current match. */
const vaultTwins: OutreachFirm[] = [
  { id: "F07515", web: "http://www.willowgrowth.com/", contacts: 0 },
  { id: "F07516", web: "http://willowgrowth.com/", contacts: 8 },
  { id: "F02149", web: "http://denverventures.co/", contacts: 0 },
  { id: "F02150", web: "http://www.denverventures.co/", contacts: 10 },
  { id: "F10001", web: "https://solo.example/", contacts: 2 },
  { id: "F10002", web: "", contacts: 1 },
];

const letter = [
  "Hi Ada,",
  "",
  "Your matched investor list for Vault Extracts is ready. I ran what you shared about Vault Extracts against our database of 10,000+ funds and narrowed it to 4 funds, sorted by fit:",
  "",
  "• Bullseye: 1 funds. Your stage, sector and geography line up. These get the most personal outreach.",
  "• Match: 2 funds. Strong fit on most of your criteria.",
  "• Expansion: 1 funds. A broader fit that widens the funnel.",
  "",
  "What I need from you (about 10 minutes): start with Bullseye.",
].join("\n");

test("Vault Extracts hides Willow Growth Partners F07515 and Denver Ventures F02149", () => {
  const hidden = hiddenDuplicateIds(vaultTwins);
  assert.deepEqual([...hidden].sort(), ["F02149", "F07515"]);
  assert.equal(hidden.has("F07516"), false);
  assert.equal(hidden.has("F02150"), false);
  assert.equal(hidden.has("F10001"), false);
  assert.equal(hidden.has("F10002"), false);
});

test("Vault rows that only stored the contact sentence still hide F07515 and F02149", () => {
  const hidden = hiddenDuplicateIds([
    {
      id: "F07515",
      web: "http://www.willowgrowth.com/",
      contacts: listedContacts(undefined, "Contacts being confirmed"),
    },
    {
      id: "F07516",
      web: "http://willowgrowth.com/",
      contacts: listedContacts(undefined, "8 investing contacts identified"),
    },
    {
      id: "F02149",
      web: "http://denverventures.co/",
      contacts: listedContacts(undefined, "Contacts being confirmed"),
    },
    {
      id: "F02150",
      web: "http://www.denverventures.co/",
      contacts: listedContacts(undefined, "10 investing contacts identified"),
    },
  ]);
  assert.deepEqual([...hidden].sort(), ["F02149", "F07515"]);
});

test("the same contact count keeps the lower FirmID", () => {
  const hidden = hiddenDuplicateIds([
    { id: "F00020", web: "https://same.example/about", contacts: 4 },
    { id: "F00002", web: "http://www.same.example/", contacts: 4 },
  ]);
  assert.deepEqual([...hidden], ["F00020"]);
});

test("flags on a hidden duplicate are copied onto the fund the client sees", () => {
  const flags = carryDuplicateFlags(vaultTwins, {
    F07515: { excluded: true, note: "Skip the empty one" },
    F07516: { known: true, note: "Already talking" },
    F02149: { note: "Denver note" },
  });
  assert.equal(flags?.F07516.excluded, true);
  assert.equal(flags?.F07516.known, true);
  assert.equal(flags?.F07516.note, "Already talking\n\nSkip the empty one");
  assert.equal(flags?.F07515.excluded, true);
  assert.equal(flags?.F02150.note, "Denver note");
  assert.equal(flags?.F02149.note, "Denver note");
});

test("an empty note adds no paragraph and no blank line", () => {
  assert.equal(withClientNote(letter, ""), letter);
  assert.equal(withClientNote(letter, " \n\t"), letter);
});

test("a note is its own paragraph after the opening and before the tier bullets", () => {
  const note = "Please start with the two you already know.";
  const text = withClientNote(letter, note);
  const blocks = text.split(/\n{2,}/);
  assert.equal(blocks[0], "Hi Ada,");
  assert.match(blocks[1], /^Your matched investor list for Vault Extracts/);
  assert.equal(blocks[2], note);
  assert.match(blocks[3], /^• Bullseye/);
  assert.equal(text.includes("\n\n\n"), false);
  assert.equal(withClientNote(text, note), text);
});

test("a seeded list keeps exclude, known, and note across reload, re-push, and confirm", () => {
  const firms: OutreachFirm[] = [
    ...vaultTwins,
    { id: "F20001", web: "https://alpha.example/", contacts: 5 },
    { id: "F20002", web: "https://beta.example/", contacts: 4 },
    { id: "F20003", web: "https://gamma.example/", contacts: 3 },
  ];
  const hidden = hiddenDuplicateIds(firms);
  const visible = firms.filter((firm) => !hidden.has(firm.id));
  assert.equal(visible.some((firm) => firm.id === "F07515"), false);
  assert.equal(visible.some((firm) => firm.id === "F02149"), false);

  let flags: Record<string, { excluded?: boolean; known?: boolean; note?: string }> = {};
  flags = applyFundFlag(flags, "F20001", { excluded: true });
  flags = applyFundFlag(flags, "F20002", { excluded: true });
  flags = applyFundFlag(flags, "F20003", { known: true });
  flags = applyFundFlag(flags, "F20003", { note: "Met the partner in June." });
  flags = applyFundFlag(flags, "F07515", { excluded: true, note: "Hide this twin too." });

  const reloaded = JSON.parse(JSON.stringify({ firms, flags })) as {
    firms: OutreachFirm[];
    flags: typeof flags;
  };
  assert.equal(reloaded.flags.F20001.excluded, true);
  assert.equal(reloaded.flags.F20002.excluded, true);
  assert.equal(reloaded.flags.F20003.known, true);
  assert.equal(reloaded.flags.F20003.note, "Met the partner in June.");

  const repushed = carryDuplicateFlags(reloaded.firms, reloaded.flags);
  assert.equal(repushed?.F20001.excluded, true);
  assert.equal(repushed?.F20002.excluded, true);
  assert.equal(repushed?.F20003.known, true);
  assert.equal(repushed?.F20003.note, "Met the partner in June.");
  assert.equal(repushed?.F07516.excluded, true);
  assert.equal(repushed?.F07516.note, "Hide this twin too.");

  const confirmed = { status: "confirmed" as const, flags: repushed };
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.flags?.F20001.excluded, true);
  assert.equal(confirmed.flags?.F20003.known, true);
  assert.equal(confirmed.flags?.F07516.excluded, true);
});
