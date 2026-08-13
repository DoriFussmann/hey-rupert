import { SITE_URL } from "../config/site";

const FILE_LIKE = /\.[a-zA-Z0-9]+$/;

function origin(): string {
  return SITE_URL.replace(/\/+$/, "");
}

function splitHashQuery(path: string): { pathname: string; suffix: string } {
  const index = path.search(/[?#]/);
  if (index === -1) return { pathname: path, suffix: "" };
  return { pathname: path.slice(0, index), suffix: path.slice(index) };
}

function isFilePath(pathname: string): boolean {
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  return FILE_LIKE.test(last);
}

/** In-site path with a trailing slash (file endpoints are left unchanged). */
export function sitePath(path: string): string {
  const raw = path.startsWith("/") ? path : `/${path}`;
  const { pathname, suffix } = splitHashQuery(raw);
  if (isFilePath(pathname)) return `${pathname}${suffix}`;
  const slashed = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${slashed}${suffix}`;
}

/** Absolute page URL. Joins SITE_URL + path and enforces trailingSlash: 'always'. */
export function absoluteUrl(path: string): string {
  return `${origin()}${sitePath(path)}`;
}

/** Absolute URL for a file or built asset — no trailing slash added. */
export function absoluteFileUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin()}${normalized}`;
}

/**
 * If `canonical` is already an absolute URL (starts with `http`), use it as-is;
 * otherwise treat it as a path and resolve it through this helper.
 */
export function canonicalFrom(
  canonical: string | undefined,
  fallbackPath: string,
): string {
  if (canonical && canonical.trim()) {
    return canonical.startsWith("http")
      ? canonical
      : absoluteUrl(canonical);
  }
  return absoluteUrl(fallbackPath);
}
