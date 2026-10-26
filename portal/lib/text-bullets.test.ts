import assert from "node:assert/strict";
import { test } from "node:test";
import { toggleBullets } from "./text-bullets.ts";

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
