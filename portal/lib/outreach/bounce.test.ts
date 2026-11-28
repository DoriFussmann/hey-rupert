import assert from "node:assert/strict";
import { test } from "node:test";
import { bounceComment, domainOf, passedOnWebOnly, splitName, usableNewAddress } from "./bounce.ts";

test("passedOnWebOnly: a page showed the address and Hunter never ran", () => {
  assert.equal(passedOnWebOnly({ public: { result: "found", summary: "", evidence: [] } } as never), true);
  assert.equal(passedOnWebOnly({ public: { result: "found", summary: "", evidence: [] }, mailbox: { result: "valid", score: 90, summary: "", suggestedEmail: "" } } as never), false);
  assert.equal(passedOnWebOnly({ public: { result: "not_found", summary: "", evidence: [] } } as never), false);
  assert.equal(passedOnWebOnly(null), false);
});

test("splitName drops honorifics; domainOf", () => {
  assert.deepEqual(splitName("Mr. Ping Li", "Ping"), { first: "Ping", last: "Li" });
  assert.deepEqual(splitName("Dr Ana Maria Lopez"), { first: "Ana", last: "Lopez" });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
  assert.equal(domainOf("Ping@Accel.com"), "accel.com");
});

test("usableNewAddress: different and valid only", () => {
  assert.equal(usableNewAddress("ping@accel.com", "pli@accel.com", "valid"), true);
  assert.equal(usableNewAddress("ping@accel.com", "PING@accel.com", "valid"), false);
  assert.equal(usableNewAddress("ping@accel.com", "pli@accel.com", "accept_all"), false);
  assert.equal(usableNewAddress("ping@accel.com", null, null), false);
});

test("bounceComment", () => {
  assert.match(bounceComment({ email: "a@x.vc", at: "", action: "new_address", new_email: "b@x.vc", note: "" }), /New address found \(b@x\.vc\)/);
  assert.equal(bounceComment({ email: "a@x.vc", at: "", action: "removed", replaced_by: "Ben Fox", note: "" }), "Removed. Replaced by Ben Fox.");
  assert.equal(bounceComment({ email: "a@x.vc", at: "", action: "removed", note: "" }), "Removed. No other contact at this fund.");
  assert.equal(bounceComment(null), "");
});
