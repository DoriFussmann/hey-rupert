import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import {
  articleAssetDir,
  articleImageFrontmatterPath,
  articleMarkdownPath,
  ARTICLES_DIR,
} from "./paths.ts";

export type StagedImage = {
  path: string;
  originalName: string;
};

export type WriteArticleInput = {
  data: Record<string, unknown>;
  body: string;
  staged: {
    image: StagedImage;
    image2?: StagedImage;
    image3?: StagedImage;
  };
  overwrite?: boolean;
  originalSlug?: string;
};

function asString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => asString(item)).filter(Boolean);
  return items.length ? items : undefined;
}

function formatDate(value: unknown): string {
  const raw = asString(value);
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return raw;
  return date.toISOString().slice(0, 10);
}

function extensionOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext || ".png";
}

function omitEmpty<T extends Record<string, unknown>>(data: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyStaged(
  staged: StagedImage,
  destDir: string,
  stem: string,
): Promise<string> {
  const filename = `${stem}${extensionOf(staged.originalName)}`;
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(staged.path, path.join(destDir, filename));
  return filename;
}

export async function writeArticle(input: WriteArticleInput): Promise<{ slug: string; path: string }> {
  const slug = asString(input.data.slug);
  if (!slug) throw Object.assign(new Error("slug is required"), { status: 400 });

  const destMd = articleMarkdownPath(slug);
  const exists = await fileExists(destMd);
  const sameFile = input.originalSlug === slug;
  if (exists && !input.overwrite && !sameFile) {
    throw Object.assign(
      new Error(`Article "${slug}" already exists. Overwrite or rename.`),
      { status: 409 },
    );
  }

  await fs.mkdir(ARTICLES_DIR, { recursive: true });

  if (input.originalSlug && input.originalSlug !== slug) {
    const oldMd = articleMarkdownPath(input.originalSlug);
    if (await fileExists(oldMd)) await fs.unlink(oldMd);
    const oldAssets = articleAssetDir(input.originalSlug);
    await fs.rm(oldAssets, { recursive: true, force: true });
  }

  const assetDir = articleAssetDir(slug);
  await fs.rm(assetDir, { recursive: true, force: true });
  await fs.mkdir(assetDir, { recursive: true });

  const heroFile = await copyStaged(input.staged.image, assetDir, "hero");
  const image2File = input.staged.image2
    ? await copyStaged(input.staged.image2, assetDir, "image2")
    : undefined;
  const image3File = input.staged.image3
    ? await copyStaged(input.staged.image3, assetDir, "image3")
    : undefined;

  const title = asString(input.data.title);
  const description = asString(input.data.description);
  const date = formatDate(input.data.date);
  const updatedDate = formatDate(input.data.updatedDate || input.data.date);
  const h1 = asString(input.data.h1);
  const ogTitle = asString(input.data.ogTitle);
  const ogDescription = asString(input.data.ogDescription);
  const ogImage = asString(input.data.ogImage);

  const frontmatter = omitEmpty({
    title,
    description,
    slug,
    date,
    author: asString(input.data.author),
    category: asString(input.data.category),
    tags: asStringArray(input.data.tags) ?? [],
    image: articleImageFrontmatterPath(slug, heroFile),
    imageAlt: asString(input.data.imageAlt),
    robots: asString(input.data.robots) || "index, follow",
    schemaType: asString(input.data.schemaType) || "BlogPosting",
    locale: asString(input.data.locale) || "en-US",
    twitterCard: asString(input.data.twitterCard) || "summary_large_image",
    draft: Boolean(input.data.draft),
    h1: h1 && h1 !== title ? h1 : undefined,
    pillarKeyword: asString(input.data.pillarKeyword) || undefined,
    supportingKeyword: asString(input.data.supportingKeyword) || undefined,
    articleType: asString(input.data.articleType) || undefined,
    targetKeyword: asString(input.data.targetKeyword) || undefined,
    updatedDate,
    keywords: asStringArray(input.data.keywords),
    canonical: asString(input.data.canonical) || undefined,
    image2: image2File
      ? articleImageFrontmatterPath(slug, image2File)
      : undefined,
    image2Alt: image2File ? asString(input.data.image2Alt) : undefined,
    image3: image3File
      ? articleImageFrontmatterPath(slug, image3File)
      : undefined,
    image3Alt: image3File ? asString(input.data.image3Alt) : undefined,
    ogTitle: ogTitle && ogTitle !== title ? ogTitle : undefined,
    ogDescription:
      ogDescription && ogDescription !== description ? ogDescription : undefined,
    ogImage:
      ogImage && ogImage !== asString(input.data.image) ? ogImage : undefined,
    internalLinks: Array.isArray(input.data.internalLinks)
      ? input.data.internalLinks
      : undefined,
    externalLinks: Array.isArray(input.data.externalLinks)
      ? input.data.externalLinks
      : undefined,
    faqs: Array.isArray(input.data.faqs) ? input.data.faqs : undefined,
  });

  const yaml = stringify(frontmatter, { lineWidth: 0 });
  const body = input.body.replace(/^\uFEFF/, "").replace(/^\n+/, "");
  const markdown = `---\n${yaml}---\n${body ? `${body}\n` : ""}`;
  await fs.writeFile(destMd, markdown, "utf8");

  return { slug, path: destMd };
}

export async function deleteArticle(slug: string): Promise<void> {
  const md = articleMarkdownPath(slug);
  if (await fileExists(md)) await fs.unlink(md);
  await fs.rm(articleAssetDir(slug), { recursive: true, force: true });
}

export async function setArticleDraft(slug: string, draft: boolean): Promise<void> {
  const md = articleMarkdownPath(slug);
  const raw = await fs.readFile(md, "utf8");
  let next: string;
  if (/^draft:\s*(true|false)\s*$/m.test(raw)) {
    next = raw.replace(/^draft:\s*(true|false)\s*$/m, `draft: ${draft}`);
  } else {
    next = raw.replace(/^---\s*\n/, `---\ndraft: ${draft}\n`);
  }
  await fs.writeFile(md, next, "utf8");
}
