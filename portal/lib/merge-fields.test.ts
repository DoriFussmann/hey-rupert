import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldSpans, insertAt } from "./merge-fields.ts";

test("fieldSpans finds each field and marks the ones that aren't allowed", () => {
  const text = "Hi {{first_name}}, your fund backed {{ backed_company }} and {{nope}}.";
  const spans = fieldSpans(text, ["first_name", "backed_company"]);
  assert.deepEqual(
    spans.map((span) => [text.slice(span.start, span.end), span.field, span.known]),
    [
      ["{{first_name}}", "first_name", true],
      ["{{ backed_company }}", "backed_company", true],
      ["{{nope}}", "nope", false],
    ],
  );
  assert.deepEqual(fieldSpans("No fields here, {not this}.", ["first_name"]), []);
});

test("insertAt replaces the selection and puts the cursor after the piece", () => {
  assert.deepEqual(insertAt("Hi ,", 3, 3, "{{first_name}}"), { text: "Hi {{first_name}},", cursor: 17 });
  assert.deepEqual(insertAt("Hi NAME,", 3, 7, "{{first_name}}"), { text: "Hi {{first_name}},", cursor: 17 });
  assert.deepEqual(insertAt("Hi", 99, 99, "!"), { text: "Hi!", cursor: 3 });
});
