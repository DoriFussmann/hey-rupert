import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const articlesDir = path.join(root, "site/src/content/articles");
const assetsDir = path.join(root, "site/src/assets/articles");

const IMAGE_FIELDS = [
  { key: "image", destSuffix: "" },
  { key: "image2", destSuffix: "-2" },
  { key: "image3", destSuffix: "-3" },
];

const NESTED_IMAGE_RE =
  /^(image(?:2|3)?):\s+(\.\.\/\.\.\/assets\/articles\/([^/\s]+)\/([^/\s]+)\.(\w+))\s*$/;
const ARTICLE_URL_RE = /^\/articles\/([a-z0-9-]+)\/$/;
const YAML_SPECIAL = /[:#{}[\],&*!|>'"%@`]/;

const report = {
  articlesChanged: [],
  imagesMoved: [],
  unhandledLinks: [],
  skippedImages: [],
};

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) return null;
  return { fm: match[1], body: match[2] };
}

function splitLines(text, newline) {
  if (text === "") return [];
  const parts = text.split(newline);
  if (text.endsWith(newline) && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

function stripTrailingNewline(text, newline) {
  return text.endsWith(newline) ? text.slice(0, -newline.length) : text;
}

function needsYamlQuote(value) {
  if (value === "") return true;
  if (/^\s|\s$/.test(value)) return true;
  if (YAML_SPECIAL.test(value)) return true;
  if (/^[-?]/.test(value)) return true;
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  return false;
}

function parseYamlScalar(raw) {
  const trimmed = raw.trimEnd();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return {
      value: trimmed.slice(1, -1).replace(/\\"/g, '"'),
      quoted: true,
    };
  }
  return { value: trimmed, quoted: false };
}

function formatYamlScalar(value, originallyQuoted) {
  if (originallyQuoted || needsYamlQuote(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function findInternalLinksRange(fm, newline) {
  const lines = splitLines(fm, newline);
  const startLine = lines.findIndex((line) => line === "internalLinks:");
  if (startLine === -1) return null;

  let endLine = startLine + 1;
  while (endLine < lines.length && !/^[A-Za-z]/.test(lines[endLine])) {
    endLine += 1;
  }

  const offsetForLine = (index) => {
    let offset = 0;
    for (let i = 0; i < index; i += 1) {
      offset += lines[i].length + newline.length;
    }
    return offset;
  };

  const start = offsetForLine(startLine);
  const bodyStart = offsetForLine(startLine + 1);
  const end = Math.min(offsetForLine(endLine), fm.length);
  return {
    start,
    bodyStart,
    end,
    blockBody: fm.slice(bodyStart, end),
  };
}

function convertInternalLinks(fm, newline, articleId) {
  const range = findInternalLinksRange(fm, newline);
  if (!range) return { fm, changed: false };

  const lines = splitLines(stripTrailingNewline(range.blockBody, newline), newline).filter(
    (line) => line.length > 0,
  );
  if (lines.length === 0) return { fm, changed: false };

  const alreadyConverted = lines.some(
    (line) => /^\s+- slug:/.test(line) || /^\s+anchor:/.test(line),
  );
  if (alreadyConverted) {
    if (lines.some((line) => /^\s+- label:/.test(line) || /^\s+url:/.test(line))) {
      report.unhandledLinks.push({
        article: articleId,
        reason: "mixed label/url and slug/anchor in internalLinks",
      });
    }
    return { fm, changed: false };
  }

  const items = [];
  for (let i = 0; i < lines.length; i += 2) {
    const labelMatch = lines[i]?.match(/^  - label: (.*)$/);
    const urlMatch = lines[i + 1]?.match(/^    url: (.*)$/);
    if (!labelMatch || !urlMatch) {
      report.unhandledLinks.push({
        article: articleId,
        reason: "could not parse internalLinks item",
        line: lines[i],
      });
      return { fm, changed: false };
    }

    const label = parseYamlScalar(labelMatch[1]);
    const url = parseYamlScalar(urlMatch[1]).value;
    const slugMatch = url.match(ARTICLE_URL_RE);
    if (!slugMatch) {
      report.unhandledLinks.push({
        article: articleId,
        url,
        reason: "url does not match /articles/{slug}/",
      });
      return { fm, changed: false };
    }

    items.push({
      slug: slugMatch[1],
      anchor: label.value,
      quoted: label.quoted,
    });
  }

  const rebuilt = [
    "internalLinks:",
    ...items.flatMap((item) => [
      `  - slug: ${item.slug}`,
      `    anchor: ${formatYamlScalar(item.anchor, item.quoted)}`,
    ]),
    "",
  ].join(newline);

  return {
    fm: fm.slice(0, range.start) + rebuilt + fm.slice(range.end),
    changed: true,
  };
}

function rewriteImagePaths(fm, newline) {
  const lines = splitLines(fm, newline);
  let changed = false;
  const plannedMoves = [];

  const nextLines = lines.map((line) => {
    const match = line.match(NESTED_IMAGE_RE);
    if (!match) return line;
    const [, key, , nestedSlug, fileStem, ext] = match;
    const field = IMAGE_FIELDS.find((item) => item.key === key);
    if (!field) return line;
    const destName = `${nestedSlug}${field.destSuffix}.${ext}`;
    plannedMoves.push({
      nestedSlug,
      fromRel: `${nestedSlug}/${fileStem}.${ext}`,
      toRel: destName,
      from: path.join(assetsDir, nestedSlug, `${fileStem}.${ext}`),
      to: path.join(assetsDir, destName),
    });
    changed = true;
    return `${key}: ../../assets/articles/${destName}`;
  });

  return {
    fm: changed ? nextLines.join(newline) : fm,
    changed,
    plannedMoves,
  };
}

function moveImage(move) {
  if (!fs.existsSync(move.from)) {
    report.skippedImages.push({
      path: move.fromRel.replaceAll("\\", "/"),
      reason: "source file missing",
    });
    return;
  }
  if (fs.existsSync(move.to)) {
    report.skippedImages.push({
      path: move.toRel.replaceAll("\\", "/"),
      reason: "destination already exists",
    });
    return;
  }
  fs.renameSync(move.from, move.to);
  report.imagesMoved.push({
    from: `site/src/assets/articles/${move.fromRel.replaceAll("\\", "/")}`,
    to: `site/src/assets/articles/${move.toRel.replaceAll("\\", "/")}`,
  });
}

function removeEmptyDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  const leftover = fs.readdirSync(dir);
  if (leftover.length === 0) {
    fs.rmdirSync(dir);
    return;
  }
  for (const name of leftover) {
    report.skippedImages.push({
      path: `${path.basename(dir)}/${name}`.replaceAll("\\", "/"),
      reason: "leftover file in nested article directory (not deleted)",
    });
  }
}

function migrateArticle(filePath) {
  const articleId = path.basename(filePath, ".md");
  const raw = fs.readFileSync(filePath, "utf8");
  const newline = detectNewline(raw);
  const split = splitFrontmatter(raw);
  if (!split) {
    report.unhandledLinks.push({
      article: articleId,
      reason: "could not parse frontmatter",
    });
    return;
  }

  let fm = split.fm;
  let articleChanged = false;

  const imageResult = rewriteImagePaths(fm, newline);
  fm = imageResult.fm;
  if (imageResult.changed) articleChanged = true;

  const linkResult = convertInternalLinks(fm, newline, articleId);
  fm = linkResult.fm;
  if (linkResult.changed) articleChanged = true;

  if (articleChanged) {
    const trailing = fm.endsWith(newline) ? "" : newline;
    fs.writeFileSync(filePath, `---${newline}${fm}${trailing}---${split.body}`, "utf8");
    report.articlesChanged.push(articleId);
  }

  const dirsToClean = new Set();
  for (const move of imageResult.plannedMoves) {
    moveImage(move);
    dirsToClean.add(path.join(assetsDir, move.nestedSlug));
  }
  for (const dir of dirsToClean) {
    removeEmptyDir(dir);
  }
}

function main() {
  const files = fs
    .readdirSync(articlesDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(articlesDir, name))
    .sort();

  for (const file of files) {
    migrateArticle(file);
  }

  report.articlesChanged.sort();
  console.log(JSON.stringify(report, null, 2));
  console.log(
    "\nFOLLOW-UP: CMS (cms/lib/*) still expects internalLinks as { label, url }. Do not use the CMS to write articles until that is updated.",
  );
}

main();
