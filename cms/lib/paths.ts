import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CMS_ROOT = path.resolve(LIB_DIR, "..");
export const REPO_ROOT = path.resolve(CMS_ROOT, "..");
export const SITE_ROOT = path.join(REPO_ROOT, "site");

export const ARTICLES_DIR = path.join(SITE_ROOT, "src/content/articles");
export const TEAM_DIR = path.join(SITE_ROOT, "src/content/team");
export const SERVICES_DIR = path.join(SITE_ROOT, "src/content/services");
export const ARTICLE_ASSETS_DIR = path.join(SITE_ROOT, "src/assets/articles");
export const TEAM_ASSETS_DIR = path.join(SITE_ROOT, "src/assets/team");
export const PUBLIC_DIR = path.join(SITE_ROOT, "public");
export const STAGING_DIR = path.join(CMS_ROOT, "staging");

export function articleMarkdownPath(slug: string): string {
  return path.join(ARTICLES_DIR, `${slug}.md`);
}

export function teamMarkdownPath(slug: string): string {
  return path.join(TEAM_DIR, `${slug}.md`);
}

export function articleAssetDir(slug: string): string {
  return path.join(ARTICLE_ASSETS_DIR, slug);
}

export function teamAssetDir(slug: string): string {
  return path.join(TEAM_ASSETS_DIR, slug);
}

export function toPosix(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

export function articleImageFrontmatterPath(slug: string, filename: string): string {
  return toPosix(`../../assets/articles/${slug}/${filename}`);
}

export function teamPhotoFrontmatterPath(slug: string, filename: string): string {
  return toPosix(`../../assets/team/${slug}/${filename}`);
}
