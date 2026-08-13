import fs from "node:fs/promises";
import { stringify } from "yaml";
import { articleMarkdownPath } from "./paths.ts";

export const WTS_START = "<!-- WHERE-THINGS-STAND:START -->";
export const WTS_END = "<!-- WHERE-THINGS-STAND:END -->";

export type LinkItem = { label: string; url: string };

function splitMarkdown(raw: string): { fm: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw Object.assign(new Error("Article is missing YAML frontmatter"), {
      status: 400,
    });
  }
  return { fm: match[1], body: match[2] };
}

function joinMarkdown(fm: string, body: string): string {
  const cleanedFm = fm.replace(/\s+$/, "");
  return `---\n${cleanedFm}\n---\n${body}`;
}

function setYamlScalar(fm: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  if (re.test(fm)) return fm.replace(re, `${key}: ${value}`);
  return `${fm.replace(/\s+$/, "")}\n${key}: ${value}`;
}

function setYamlBlock(fm: string, key: string, block: string): string {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  const rendered = block.replace(/\s+$/, "").split("\n");
  if (start === -1) {
    return `${fm.replace(/\s+$/, "")}\n${rendered.join("\n")}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z]/.test(lines[end])) {
    end += 1;
  }
  return [...lines.slice(0, start), ...rendered, ...lines.slice(end)].join("\n");
}

function renderLinkBlock(key: string, links: LinkItem[]): string {
  return stringify({ [key]: links }, { lineWidth: 0 }).trimEnd();
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function extractWhereThingsStand(body: string): string | null {
  const start = body.indexOf(WTS_START);
  const end = body.indexOf(WTS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start + WTS_START.length, end).trim();
}

export function replaceWhereThingsStand(body: string, paragraph: string): string {
  const start = body.indexOf(WTS_START);
  const end = body.indexOf(WTS_END);
  if (start === -1 || end === -1 || end < start) {
    throw Object.assign(
      new Error("WHERE-THINGS-STAND markers not found"),
      { status: 400 },
    );
  }
  const before = body.slice(0, start + WTS_START.length);
  const after = body.slice(end);
  return `${before}\n${paragraph.trim()}\n${after}`;
}

export function ensureSignpost(body: string, line: string): string {
  if (body.includes(line)) return body;
  return `${body.replace(/\s+$/, "")}\n\n${line}\n`;
}

export async function readArticleRaw(slug: string): Promise<string> {
  return fs.readFile(articleMarkdownPath(slug), "utf8");
}

export async function patchArticle(
  slug: string,
  mutate: (parts: { fm: string; body: string }) => { fm: string; body: string },
): Promise<void> {
  const filePath = articleMarkdownPath(slug);
  const raw = await fs.readFile(filePath, "utf8");
  const current = splitMarkdown(raw);
  const next = mutate(current);
  const written = joinMarkdown(next.fm, next.body);
  if (written !== raw) {
    await fs.writeFile(filePath, written, "utf8");
  }
}

export async function patchArticleLinks(
  slug: string,
  input: {
    internalLinks?: LinkItem[];
    externalLinks?: LinkItem[];
    updatedDate?: string;
    signposts?: string[];
    whereThingsStand?: string;
  },
): Promise<void> {
  await patchArticle(slug, ({ fm, body }) => {
    let nextFm = fm;
    let nextBody = body;
    if (input.updatedDate) {
      nextFm = setYamlScalar(nextFm, "updatedDate", input.updatedDate);
    }
    if (input.internalLinks) {
      nextFm = setYamlBlock(
        nextFm,
        "internalLinks",
        renderLinkBlock("internalLinks", input.internalLinks),
      );
    }
    if (input.externalLinks) {
      nextFm = setYamlBlock(
        nextFm,
        "externalLinks",
        renderLinkBlock("externalLinks", input.externalLinks),
      );
    }
    if (input.whereThingsStand != null) {
      nextBody = replaceWhereThingsStand(nextBody, input.whereThingsStand);
    }
    for (const line of input.signposts ?? []) {
      nextBody = ensureSignpost(nextBody, line);
    }
    return { fm: nextFm, body: nextBody };
  });
}
