import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// House rule: every heading and title is in Title Case ("Calls Booked", not
// "Calls booked"). This reads the pages and fails on any heading, table column
// header or section/page title written in sentence case.

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "th", "legend"]);
const TITLE_COMPONENTS = new Set(["PageHeader", "EmptyState", "ClientSection", "Disclosure", "Section"]);

/** The text in Title Case. `before`/`after`: other content sits before or after it in the same heading. */
function titleCase(text: string, before = false, after = false): string {
  const tokens = text.split(/(\s+)/);
  const count = tokens.filter((t) => t.trim()).length;
  let index = -1;
  let fresh = !before;
  return tokens
    .map((token) => {
      if (!token.trim()) return token;
      index += 1;
      const first = fresh;
      const last = index === count - 1 && !after;
      fresh = /[:!?—–·]$/.test(token) || /^(—|–|·|-|\/)$/.test(token);
      if (/^&[a-z]+;$/.test(token) || /@|^https?:|\.(com|vc|io|md|csv)\b/i.test(token)) return token;
      return token
        .split("-")
        .map((part, partIndex, parts) => {
          const [, lead, body] = part.match(/^([^A-Za-z0-9&]*)(.*)$/)!;
          if (!body || !/^[a-z]/.test(body)) return part;
          if (/[A-Z]/.test(body.replace(/&[a-z]+;/g, "").slice(1))) return part;
          const bare = body.replace(/&[a-z]+;.*$/, "").replace(/[^a-z]/g, "");
          const edge = (first && partIndex === 0) || (last && partIndex === parts.length - 1);
          if (!edge && SMALL.has(bare) && !lead.includes("(")) return part;
          return lead + body[0].toUpperCase() + body.slice(1);
        })
        .join("-");
    })
    .join("");
}

function files(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function sentenceCaseHeadings(root: string): string[] {
  const found: string[] = [];
  for (const file of ["app", "components"].flatMap((dir) => files(path.join(root, dir)))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node, text: string, fixed: string) => {
      if (text === fixed) return;
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.push(`${path.relative(root, file)}:${line}  "${text.trim().replace(/\s+/g, " ")}" → "${fixed.trim().replace(/\s+/g, " ")}"`);
    };
    const hasContent = (node: ts.Node) => (ts.isJsxText(node) ? node.text.trim().length > 0 : true);
    const visit = (node: ts.Node, inHeading: boolean) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText();
        const attributes = node.openingElement.attributes.getText();
        if (HEADING_TAGS.has(tag)) inHeading = true;
        // Text inside a nested <p>, <a>, <button> or a screen-reader note is not the heading itself.
        else if (/sr-only|text-body-sm/.test(attributes) || !["span", "strong", "em"].includes(tag)) inHeading = false;
      }
      if (ts.isJsxText(node) && inHeading && node.text.trim()) {
        const siblings = (node.parent as ts.JsxElement | ts.JsxFragment).children;
        const at = siblings.indexOf(node);
        const text = node.getFullText();
        report(node, text, titleCase(text, siblings.slice(0, at).some(hasContent), siblings.slice(at + 1).some(hasContent)));
      }
      if (ts.isJsxAttribute(node) && node.name.getText() === "title" && node.initializer && TITLE_COMPONENTS.has(node.parent.parent.tagName.getText())) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        // A title that ends with a full stop is a sentence (an empty-state message), not a title.
        if (value && ts.isStringLiteralLike(value) && !value.text.endsWith(".")) report(value, value.text, titleCase(value.text));
      }
      ts.forEachChild(node, (child) => visit(child, inHeading));
    };
    visit(source, false);
  }
  return found;
}

test("Title Case helper: small words stay lower, first and last words are capitalised", () => {
  assert.equal(titleCase("Calls booked"), "Calls Booked");
  assert.equal(titleCase("Emails sent per day"), "Emails Sent per Day");
  assert.equal(titleCase("NDA text — sent to client"), "NDA Text — Sent to Client");
  assert.equal(titleCase("What to do with", false, true), "What to Do with");
  assert.equal(titleCase("Login &amp; access"), "Login &amp; Access");
  assert.equal(titleCase("Look-alike"), "Look-Alike");
});

test("every heading, column header and page or section title is in Title Case", () => {
  const found = sentenceCaseHeadings(path.join(import.meta.dirname, ".."));
  assert.deepEqual(found, [], `Headings and titles are written in Title Case. Fix:\n${found.join("\n")}`);
});
