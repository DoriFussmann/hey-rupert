import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOK_CALL_URL, bookCallHref } from "./book-call.ts";

test("no client: the plain booking link", () => {
  assert.equal(bookCallHref(null), BOOK_CALL_URL);
});

test("fills name, email and company from the client", () => {
  const url = new URL(
    bookCallHref({ founder_name: " Dana Lee ", email: "dana@acme.com", founder_email: "other@acme.com", company_name: "Acme & Co" }),
  );
  assert.equal(url.origin + url.pathname, BOOK_CALL_URL);
  assert.equal(url.searchParams.get("name"), "Dana Lee");
  assert.equal(url.searchParams.get("email"), "dana@acme.com");
  assert.equal(url.searchParams.get("notes"), "Company: Acme & Co");
});

test("falls back to first name and founder email; skips empty fields", () => {
  const url = new URL(bookCallHref({ founder_name: "", first_name: "Dana", email: "", founder_email: "dana@acme.com", company_name: " " }));
  assert.equal(url.searchParams.get("name"), "Dana");
  assert.equal(url.searchParams.get("email"), "dana@acme.com");
  assert.equal(url.searchParams.has("notes"), false);
});
