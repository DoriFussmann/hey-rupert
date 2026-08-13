import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  ARTICLES_DIR,
  SERVICES_DIR,
  TEAM_DIR,
  articleAssetDir,
  teamAssetDir,
} from "./paths.ts";

export type ArticleRecord = {
  slug: string;
  data: Record<string, unknown>;
  body: string;
  filename: string;
};

export type TeamRecord = {
  slug: string;
  data: Record<string, unknown>;
  filename: string;
};

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function listArticles(): Promise<ArticleRecord[]> {
  const files = await listMarkdown(ARTICLES_DIR);
  const articles: ArticleRecord[] = [];
  for (const filename of files) {
    const raw = await fs.readFile(path.join(ARTICLES_DIR, filename), "utf8");
    const parsed = matter(raw);
    const slug =
      typeof parsed.data.slug === "string"
        ? parsed.data.slug
        : filename.replace(/\.md$/, "");
    articles.push({
      slug,
      data: jsonSafe(parsed.data) as Record<string, unknown>,
      body: parsed.content.replace(/^\n/, ""),
      filename,
    });
  }
  return articles.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listTeam(): Promise<TeamRecord[]> {
  const files = await listMarkdown(TEAM_DIR);
  const members: TeamRecord[] = [];
  for (const filename of files) {
    const raw = await fs.readFile(path.join(TEAM_DIR, filename), "utf8");
    const parsed = matter(raw);
    const slug =
      typeof parsed.data.slug === "string"
        ? parsed.data.slug
        : filename.replace(/\.md$/, "");
    members.push({
      slug,
      data: jsonSafe(parsed.data) as Record<string, unknown>,
      filename,
    });
  }
  return members.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listServices(): Promise<{ slug: string; data: Record<string, unknown> }[]> {
  const files = await listMarkdown(SERVICES_DIR);
  const services = [];
  for (const filename of files) {
    const raw = await fs.readFile(path.join(SERVICES_DIR, filename), "utf8");
    const parsed = matter(raw);
    const slug =
      typeof parsed.data.slug === "string"
        ? parsed.data.slug
        : filename.replace(/\.md$/, "");
    services.push({ slug, data: jsonSafe(parsed.data) as Record<string, unknown> });
  }
  return services.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function getArticle(slug: string): Promise<ArticleRecord | null> {
  const articles = await listArticles();
  return articles.find((article) => article.slug === slug) ?? null;
}

export async function getTeamMember(slug: string): Promise<TeamRecord | null> {
  const members = await listTeam();
  return members.find((member) => member.slug === slug) ?? null;
}

export function existingArticleImageFiles(slug: string, data: Record<string, unknown>) {
  return {
    image: resolveExistingAsset(slug, data.image, "hero"),
    image2: resolveExistingAsset(slug, data.image2, "image2"),
    image3: resolveExistingAsset(slug, data.image3, "image3"),
  };
}

function resolveExistingAsset(
  slug: string,
  value: unknown,
  fallbackStem: string,
): string | null {
  const dir = articleAssetDir(slug);
  if (typeof value === "string" && value.trim()) {
    const filename = path.posix.basename(value.replaceAll("\\", "/"));
    return path.join(dir, filename);
  }
  return path.join(dir, fallbackStem);
}

export function existingTeamPhotoPath(slug: string, data: Record<string, unknown>): string {
  const dir = teamAssetDir(slug);
  if (typeof data.photo === "string" && data.photo.trim()) {
    return path.join(dir, path.posix.basename(data.photo.replaceAll("\\", "/")));
  }
  return path.join(dir, "photo.png");
}

const PAGE_ROUTES = ["/", "/articles/", "/team/"];

export async function listKnownRoutes(): Promise<string[]> {
  const [articles, team, services] = await Promise.all([
    listArticles(),
    listTeam(),
    listServices(),
  ]);
  const routes = [...PAGE_ROUTES];
  for (const article of articles) {
    routes.push(`/articles/${article.slug}/`);
  }
  for (const member of team) {
    routes.push(`/team/#${member.slug}`);
  }
  for (const service of services) {
    routes.push(`/#${service.slug}`);
  }
  return routes;
}
