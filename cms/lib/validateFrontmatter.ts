import { SITE_URL } from "../../site/src/config/site.ts";
import { articleSchema } from "./schema.ts";

export type FieldIssue = {
  field: string;
  message: string;
  kind: "missing" | "invalid" | "warning";
};

export type StagedFlags = {
  image: boolean;
  image2: boolean;
  image3: boolean;
};

export type ValidationInput = {
  data: Record<string, unknown>;
  body?: string;
  staged: StagedFlags;
  knownAuthors: string[];
  knownRoutes: string[];
  existingSlugs: string[];
  editingSlug?: string;
};

const PLACEHOLDER_RE = /replace|todo|placeholder/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["page"]);

function asString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function asLinkArray(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as { label?: unknown; url?: unknown };
    return { label: asString(row.label), url: asString(row.url) };
  });
}

function asFaqArray(value: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as { question?: unknown; answer?: unknown };
    return { question: asString(row.question), answer: asString(row.answer) };
  });
}

export function isPlaceholderPath(value: unknown): boolean {
  return PLACEHOLDER_RE.test(asString(value));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function siteHost(): string {
  return hostOf(SITE_URL) ?? "example.com";
}

function isSelfOrPlaceholderHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return host === siteHost() || host === "example.com";
}

function normalizeRoute(url: string): string {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const parsed = new URL(url);
      const pathname = parsed.pathname.endsWith("/")
        ? parsed.pathname
        : `${parsed.pathname}/`;
      return `${pathname}${parsed.hash}`;
    }
  } catch {
    return url;
  }
  if (url.startsWith("/")) {
    const hashIndex = url.indexOf("#");
    if (hashIndex !== -1) {
      const pathname = url.slice(0, hashIndex);
      const slashed = pathname.endsWith("/") ? pathname : `${pathname}/`;
      return `${slashed}${url.slice(hashIndex)}`;
    }
    return url.endsWith("/") ? url : `${url}/`;
  }
  return url;
}

function routeMatches(url: string, knownRoutes: string[]): boolean {
  const normalized = normalizeRoute(url);
  const known = knownRoutes.map(normalizeRoute);
  return known.includes(normalized);
}

function imageIssue(
  field: "image" | "image2" | "image3",
  altField: "imageAlt" | "image2Alt" | "image3Alt",
  required: boolean,
  data: Record<string, unknown>,
  staged: boolean,
): FieldIssue | null {
  const pathValue = asString(data[field]);
  const alt = asString(data[altField]);
  const label =
    field === "image" ? "Hero image" : field === "image2" ? "Image 2" : "Image 3";

  if (staged) {
    if (alt.length < 10) {
      return {
        field: altField,
        kind: "invalid",
        message: `${altField} must be at least 10 characters`,
      };
    }
    return null;
  }

  if (pathValue) {
    const placeholderNote = isPlaceholderPath(pathValue)
      ? " (placeholder path)"
      : "";
    return {
      field,
      kind: required ? "missing" : "invalid",
      message: `${label}: path present in file but no image uploaded this session — drop a real file${placeholderNote}`,
    };
  }

  if (required) {
    return {
      field,
      kind: "missing",
      message: `${label} is required — drop a real file (max 10MB)`,
    };
  }

  if (alt) {
    return {
      field,
      kind: "invalid",
      message: `${altField} is set but no ${label.toLowerCase()} was uploaded this session`,
    };
  }

  return null;
}

export function validateArticleInput(input: ValidationInput): {
  missing: FieldIssue[];
  invalid: FieldIssue[];
  warnings: FieldIssue[];
  ok: boolean;
} {
  const { data, staged, knownAuthors, knownRoutes, existingSlugs, editingSlug } =
    input;
  const missing: FieldIssue[] = [];
  const invalid: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];
  const push = (issue: FieldIssue | null) => {
    if (!issue) return;
    if (issue.kind === "missing") missing.push(issue);
    else if (issue.kind === "warning") warnings.push(issue);
    else invalid.push(issue);
  };

  const title = asString(data.title);
  if (!title) {
    push({ field: "title", kind: "missing", message: "title is required" });
  } else if (title.length < 55 || title.length > 60) {
    push({
      field: "title",
      kind: "invalid",
      message: `title (${title.length} chars, needs 55–60)`,
    });
  }

  const description = asString(data.description);
  if (!description) {
    push({ field: "description", kind: "missing", message: "description is required" });
  } else if (description.length < 140 || description.length > 160) {
    push({
      field: "description",
      kind: "invalid",
      message: `description (${description.length} chars, needs 140–160)`,
    });
  }

  const slug = asString(data.slug);
  if (!slug) {
    push({ field: "slug", kind: "missing", message: "slug is required" });
  } else if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    push({
      field: "slug",
      kind: "invalid",
      message: "slug must be lowercase kebab-case and not a reserved route",
    });
  }

  if (!asString(data.date)) {
    push({ field: "date", kind: "missing", message: "date is required" });
  } else if (Number.isNaN(Date.parse(asString(data.date)))) {
    push({ field: "date", kind: "invalid", message: "date is not a valid date" });
  }

  const author = asString(data.author);
  if (!author) {
    push({ field: "author", kind: "missing", message: "author is required" });
  } else if (!knownAuthors.includes(author)) {
    push({
      field: "author",
      kind: "invalid",
      message: `author "${author}" does not match an existing team member`,
    });
  }

  if (!asString(data.category)) {
    push({ field: "category", kind: "missing", message: "category is required" });
  }

  const tags = asStringArray(data.tags);
  if (tags.length === 0) {
    push({ field: "tags", kind: "missing", message: "tags are required (4–6)" });
  } else if (tags.length < 4 || tags.length > 6) {
    push({
      field: "tags",
      kind: "invalid",
      message: `tags (${tags.length} items, needs 4–6)`,
    });
  }

  push(imageIssue("image", "imageAlt", true, data, staged.image));
  push(imageIssue("image2", "image2Alt", false, data, staged.image2));
  push(imageIssue("image3", "image3Alt", false, data, staged.image3));

  const h1 = asString(data.h1);
  if (h1 && h1.length < 20) {
    push({
      field: "h1",
      kind: "invalid",
      message: `h1 (${h1.length} chars, needs at least 20 when set)`,
    });
  }

  const articleType = asString(data.articleType);
  if (
    articleType &&
    !["comprehensive", "howto", "comparison", "faq", "flex"].includes(articleType)
  ) {
    push({
      field: "articleType",
      kind: "invalid",
      message: 'articleType must be comprehensive, howto, comparison, faq, or flex',
    });
  }

  const internalLinks = asLinkArray(data.internalLinks);
  internalLinks.forEach((link, index) => {
    if (!link.label) {
      push({
        field: "internalLinks",
        kind: "invalid",
        message: `internalLinks[${index}].label is required`,
      });
    }
    if (!link.url) {
      push({
        field: "internalLinks",
        kind: "invalid",
        message: `internalLinks[${index}].url is required`,
      });
    } else if (
      !link.url.startsWith("/") &&
      !/^https?:\/\//i.test(link.url)
    ) {
      push({
        field: "internalLinks",
        kind: "invalid",
        message: `internalLinks[${index}].url is not well-formed`,
      });
    } else if (!routeMatches(link.url, knownRoutes)) {
      push({
        field: "internalLinks",
        kind: "warning",
        message: `internalLinks[${index}].url does not match a known internal page`,
      });
    }
  });

  const externalLinks = asLinkArray(data.externalLinks);
  externalLinks.forEach((link, index) => {
    if (!link.label) {
      push({
        field: "externalLinks",
        kind: "invalid",
        message: `externalLinks[${index}].label is required`,
      });
    }
    let parsed: URL | null = null;
    try {
      parsed = new URL(link.url);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      push({
        field: "externalLinks",
        kind: "invalid",
        message: `externalLinks[${index}].url must be a valid http(s) URL`,
      });
    } else if (isSelfOrPlaceholderHost(link.url)) {
      push({
        field: "externalLinks",
        kind: "invalid",
        message: `externalLinks[${index}].url points at this site or the template placeholder domain`,
      });
    }
  });

  const faqs = asFaqArray(data.faqs);
  faqs.forEach((faq, index) => {
    if (!faq.question || !faq.answer) {
      push({
        field: "faqs",
        kind: "invalid",
        message: `faqs[${index}] needs both question and answer`,
      });
    }
  });

  if (slug && existingSlugs.includes(slug) && slug !== editingSlug) {
    push({
      field: "slug",
      kind: "warning",
      message: `slug "${slug}" already exists — overwrite or rename before generating`,
    });
  }

  try {
    const candidate = {
      ...data,
      title: title || "x".repeat(55),
      description: description || "x".repeat(140),
      slug: slug || "tmp",
      date: asString(data.date) || "2026-01-01",
      author: author || knownAuthors[0] || "tmp",
      category: asString(data.category) || "tmp",
      tags: tags.length ? tags : ["a", "b", "c", "d"],
      image: staged.image ? "staged" : asString(data.image) || "staged",
      imageAlt: asString(data.imageAlt) || "x".repeat(10),
    };
    articleSchema.partial().parse(candidate);
  } catch {
    // Field-level checks above are the user-facing source of truth.
  }

  return {
    missing,
    invalid,
    warnings,
    ok: missing.length === 0 && invalid.length === 0,
  };
}

export function collisionBlocksGenerate(
  slug: string,
  existingSlugs: string[],
  editingSlug: string | undefined,
  overwrite: boolean,
): boolean {
  if (!slug) return false;
  if (slug === editingSlug) return false;
  if (!existingSlugs.includes(slug)) return false;
  return !overwrite;
}
