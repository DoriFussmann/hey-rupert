import assert from "node:assert/strict";
import { test } from "node:test";
import { bulletOf, continueBullet, indentBullets, toggleBullets } from "./text-bullets.ts";

test("bullets the selected lines, skipping blank ones", () => {
  const text = "Hi Ana,\n\nOne\nTwo\n\nThree\nDana";
  const start = text.indexOf("One");
  const end = text.indexOf("Three") + 5;
  const out = toggleBullets(text, start, end);
  assert.equal(out.text, "Hi Ana,\n\n• One\n• Two\n\n• Three\nDana");
});

test("a cursor with no selection bullets its own line; toggling again removes them", () => {
  const text = "Line A\nLine B";
  const once = toggleBullets(text, 9, 9);
  assert.equal(once.text, "Line A\n• Line B");
  const twice = toggleBullets(once.text, once.start, once.end);
  assert.equal(twice.text, text);
});

test("an empty line with the cursor on it starts a bullet", () => {
  assert.equal(toggleBullets("A\n\nB", 2, 2).text, "A\n• \nB");
});

test("a selection ending just after a newline doesn't take the next line", () => {
  const text = "One\nTwo\nThree";
  assert.equal(toggleBullets(text, 0, 8).text, "• One\n• Two\nThree");
});

test("indent: a bullet becomes a sub-bullet, a plain line a bullet; outdent goes back", () => {
  const text = "Funds:\n• Acme\n• Bolt";
  const once = indentBullets(text, text.indexOf("Bolt"), text.indexOf("Bolt"));
  assert.equal(once.text, "Funds:\n• Acme\n  ◦ Bolt");
  assert.equal(indentBullets(once.text, once.start, once.end, true).text, text);
  assert.equal(indentBullets("Plain", 0, 0).text, "• Plain");
});

test("Enter continues a bullet at its level, and ends the list on an empty bullet", () => {
  const text = "  ◦ Bolt";
  const next = continueBullet(text, text.length)!;
  assert.equal(next.text, "  ◦ Bolt\n  ◦ ");
  const done = continueBullet(next.text, next.text.length)!;
  assert.equal(done.text, "  ◦ Bolt\n");
  assert.equal(continueBullet("Not a bullet", 3), null);
});

test("hand-written dashes count as bullets", () => {
  assert.deepEqual(bulletOf("- Acme"), { prefix: "- ", level: 1, rest: "Acme" });
  assert.equal(bulletOf("  - Acme")?.level, 2);
});
