#!/usr/bin/env node
/**
 * Tell IndexNow (Bing, Yandex, Seznam, Naver…) which pages changed.
 *
 *   node site/scripts/indexnow.mjs --diff <baseSha> <headSha>   # pages changed between two commits
 *   node site/scripts/indexnow.mjs https://www.heyrupert.com/a/ …  # explicit URLs
 *   add --dry-run to print the list without submitting
 *
 * Run from the repo root. The key file lives at site/public/<KEY>.txt and is
 * served at https://www.heyrupert.com/<KEY>.txt; submission is refused until
 * that file is live, so it never runs ahead of a deploy.
 *
 * What counts as changed (--diff):
 *   - articles added, edited or deleted (site/src/content/articles/<slug>.md)
 *   - static pages (site/src/pages/**.astro, except dynamic [param] routes)
 *   - new redirect sources in site/vercel.json, so engines see the 301
 * Layout, component and config changes are not submitted.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const HOST = "www.heyrupert.com";
const ORIGIN = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const keyFile = readdirSync("site/public").find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("IndexNow key file not found in site/public");
const KEY = keyFile.slice(0, -4);
const KEY_LOCATION = `${ORIGIN}/${keyFile}`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rest = args.filter((a) => a !== "--dry-run");

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8" });
}

function redirectSources(sha) {
  try {
    const json = JSON.parse(git("show", `${sha}:site/vercel.json`));
    return new Set((json.redirects ?? []).map((r) => r.source));
  } catch {
    return new Set();
  }
}

function pagePath(file) {
  // site/src/pages/about/index.astro -> /about/ ; site/src/pages/index.astro -> /
  const rel = file.replace(/^site\/src\/pages\//, "").replace(/\.astro$/, "");
  if (rel.includes("[") || rel === "404") return null;
  const path = rel === "index" ? "" : rel.replace(/\/?index$/, "");
  return `/${path}${path ? "/" : ""}`;
}

function urlsFromDiff(base, head) {
  const urls = new Set();
  const lines = git("diff", "--name-status", "--no-renames", base, head, "--", "site/").trim().split("\n");
  for (const line of lines.filter(Boolean)) {
    const file = line.split("\t").pop();
    const article = file.match(/^site\/src\/content\/articles\/([^/]+)\.md$/);
    if (article) urls.add(`/articles/${article[1]}/`);
    else if (/^site\/src\/pages\/.+\.astro$/.test(file)) {
      const p = pagePath(file);
      if (p) urls.add(p);
    }
  }
  const before = redirectSources(base);
  for (const source of redirectSources(head)) {
    if (!before.has(source) && !source.includes(":") && !source.includes("*")) urls.add(source);
  }
  return [...urls].map((p) => new URL(p, ORIGIN).href);
}

let urls;
if (rest[0] === "--diff") {
  if (rest.length !== 3) throw new Error("usage: --diff <baseSha> <headSha>");
  urls = urlsFromDiff(rest[1], rest[2]);
} else {
  urls = rest.map((u) => new URL(u, ORIGIN).href);
}
urls = [...new Set(urls)].filter((u) => new URL(u).host === HOST).slice(0, 10000);

if (urls.length === 0) {
  console.log("IndexNow: no changed pages to submit.");
  process.exit(0);
}
console.log(`IndexNow: ${urls.length} URL(s)\n  ${urls.join("\n  ")}`);
if (dryRun) process.exit(0);

const keyCheck = await fetch(KEY_LOCATION, { cache: "no-store" });
const keyBody = keyCheck.ok ? (await keyCheck.text()).trim() : "";
if (keyBody !== KEY) {
  console.error(`IndexNow: key file not live at ${KEY_LOCATION} (status ${keyCheck.status}); not submitting.`);
  process.exit(1);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
