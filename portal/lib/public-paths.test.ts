import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isPublicPath } from "./public-paths.ts";

const crons = (JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []) as { path: string; schedule: string }[];

test("every scheduled job in vercel.json gets past the middleware", () => {
  assert.ok(crons.length > 0);
  for (const cron of crons) assert.ok(isPublicPath(cron.path), `${cron.path} would be redirected to /login and never run`);
});

test("every scheduled job has a route, and every route checks CRON_SECRET and logs its run", () => {
  for (const path of new Set(crons.map((c) => c.path))) {
    const file = `app${path}/route.ts`;
    assert.ok(existsSync(file), `${path} has no route`);
    const source = readFileSync(file, "utf8");
    assert.match(source, /CRON_SECRET/, `${path} does not check CRON_SECRET`);
    assert.match(source, /cronLogged\(/, `${path} does not log its run`);
  }
});

test("pages and admin stay private", () => {
  for (const path of ["/admin", "/admin/clients/1", "/portal", "/portal/setup/go-live", "/api/admin/x", "/api/cronx"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});
