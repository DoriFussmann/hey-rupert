import { test } from "node:test";
import assert from "node:assert/strict";
import { adminMessage, appPasswordFailure, checkAppPasswordForm, cleanAppPassword, clientIdFromAuthUrl } from "./inbox-connect.ts";

test("client ID: read from a Google sign-in address, never guessed", () => {
  assert.equal(
    clientIdFromAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=123-abc.apps.googleusercontent.com&scope=x"),
    "123-abc.apps.googleusercontent.com",
  );
  assert.equal(clientIdFromAuthUrl("https://app.instantly.ai/oauth/start?session=1"), null);
  assert.equal(clientIdFromAuthUrl("https://accounts.google.com/?client_id=evil"), null);
  assert.equal(clientIdFromAuthUrl("not a url"), null);
  assert.equal(clientIdFromAuthUrl(null), null);
});

test("the admin message names the app, the path and the Client ID when known", () => {
  const withId = adminMessage({ company: "Dex World", clientId: "123.apps.googleusercontent.com" });
  assert.match(withId, /At Dex World we use Hey Rupert/);
  assert.match(withId, /API controls/);
  assert.match(withId, /123\.apps\.googleusercontent\.com/);
  assert.match(withId, /Instantly oAuth Email v1/);
  assert.match(withId, /Trusted/);
  assert.match(adminMessage({ company: "", clientId: null }), /search for "Instantly"/);
});

test("app password: 16 letters, spaces and case forgiven; anything else refused", () => {
  assert.equal(cleanAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(cleanAppPassword(" ABCD-EFGH-IJKL-MNOP "), "abcdefghijklmnop");
  assert.equal(cleanAppPassword("MyRealPassword1!"), null);
  assert.equal(cleanAppPassword("abcd efgh ijkl"), null);
  assert.equal(cleanAppPassword(""), null);
});

test("the form: cleaned values, or what to fix", () => {
  const good = checkAppPasswordForm({ email: " Liron@WeAreDex.com ", name: "  Liron   Swissa ", password: "abcd efgh ijkl mnop" });
  assert.deepEqual(good, { ok: true, email: "liron@wearedex.com", firstName: "Liron", lastName: "Swissa", password: "abcdefghijklmnop" });
  const oneName = checkAppPasswordForm({ email: "a@b.co", name: "Liron", password: "abcdefghijklmnop" });
  assert.ok(oneName.ok && oneName.lastName === "Liron");
  assert.equal(checkAppPasswordForm({ email: "nope", name: "L S", password: "abcdefghijklmnop" }).ok, false);
  assert.equal(checkAppPasswordForm({ email: "a@b.co", name: " ", password: "abcdefghijklmnop" }).ok, false);
  const bad = checkAppPasswordForm({ email: "a@b.co", name: "L S", password: "hunter2" });
  assert.ok(!bad.ok && /16 letters/.test(bad.error));
});

test("failures are explained plainly, and never echo the password", () => {
  assert.match(appPasswordFailure(400, "Account already exists"), /already connected/);
  assert.match(appPasswordFailure(400, "IMAP authentication failed"), /didn't accept/);
  assert.match(appPasswordFailure(500, "boom"), /Try again/);
});
