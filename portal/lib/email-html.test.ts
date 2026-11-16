import assert from "node:assert/strict";
import { test } from "node:test";
import { plainEmailHtml } from "./email-html.ts";

const body = (html: string) => html.replace(/^.*?<body[^>]*>/, "").replace(/<\/body><\/html>$/, "").replace(/ style="[^"]*"/g, "");

test("paragraphs, line breaks and the portal link", () => {
  const html = plainEmailHtml("Hi Tata,\n\nThe list is ready.\nPlease review it.\n\nOpen your portal: https://www.heyrupert.com/portal/setup/investor-list\n\nDori\nHey Rupert");
  assert.equal(
    body(html),
    '<p>Hi Tata,</p><p>The list is ready.<br>Please review it.</p><p>Open your portal: <a href="https://www.heyrupert.com/portal/setup/investor-list">https://www.heyrupert.com/portal/setup/investor-list</a></p><p>Dori<br>Hey Rupert</p>',
  );
  assert.ok(html.startsWith("<!DOCTYPE html>"));
});

test("bullets become lists, nested by level", () => {
  const html = plainEmailHtml("What changed:\n• Competitor backers are off\n  ◦ 17 funds\n• Israeli VCs are off");
  assert.equal(body(html), "<p>What changed:</p><ul><li>Competitor backers are off<ul><li>17 funds</li></ul></li><li>Israeli VCs are off</li></ul>");
});

test("text is escaped; punctuation after a link stays outside it", () => {
  const html = plainEmailHtml('R&D <b>"up"</b>, see https://example.com/a?x=1&y=2. Or (https://example.com/b).');
  assert.equal(
    body(html),
    '<p>R&amp;D &lt;b&gt;&quot;up&quot;&lt;/b&gt;, see <a href="https://example.com/a?x=1&amp;y=2">https://example.com/a?x=1&amp;y=2</a>. Or (<a href="https://example.com/b">https://example.com/b</a>).</p>',
  );
});

test('a "[Label] → link" line on its own becomes a button', () => {
  const html = plainEmailHtml("Ready.\n\n[Review your investor matching] → https://www.heyrupert.com/portal\n\nDori");
  assert.equal(body(html), '<p>Ready.</p><p><a href="https://www.heyrupert.com/portal">Review your investor matching</a></p><p>Dori</p>');
});
