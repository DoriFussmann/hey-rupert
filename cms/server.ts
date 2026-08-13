import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import matter from "gray-matter";
import multer from "multer";
import { SITE_NAME, SITE_URL } from "../site/src/config/site.ts";
import { generateLlmsTxt } from "./lib/generateLlmsTxt.ts";
import {
  existingArticleImageFiles,
  getArticle,
  getTeamMember,
  jsonSafe,
  listArticles,
  listKnownRoutes,
  listServices,
  listTeam,
} from "./lib/listContent.ts";
import { STAGING_DIR } from "./lib/paths.ts";
import { previewArticleJsonLd } from "./lib/previewJsonLd.ts";
import {
  collisionBlocksGenerate,
  validateArticleInput,
  type StagedFlags,
} from "./lib/validateFrontmatter.ts";
import {
  deleteArticle,
  setArticleDraft,
  writeArticle,
  type StagedImage,
} from "./lib/writeArticle.ts";
import { deleteTeamMember, writeTeamMember } from "./lib/writeTeamMember.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CMS_PORT) || 3001;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

type StagingRecord = StagedImage & { id: string };
const staging = new Map<string, StagingRecord>();

const upload = multer({
  dest: STAGING_DIR,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "markdown") {
      cb(null, true);
      return;
    }
    if (IMAGE_MIMES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      Object.assign(
        new Error(
          "Unsupported file type. Use .md for articles or jpeg/png/webp/gif/avif for images.",
        ),
        { status: 400 },
      ),
    );
  },
});

function wrap(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function stageFromDisk(filePath: string, originalName: string): Promise<StagingRecord | null> {
  if (!(await pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return null;
  const id = crypto.randomUUID();
  const dest = path.join(STAGING_DIR, `${id}${path.extname(originalName)}`);
  await fs.mkdir(STAGING_DIR, { recursive: true });
  await fs.copyFile(filePath, dest);
  const record = { id, path: dest, originalName };
  staging.set(id, record);
  return record;
}

function requireStaged(id: unknown, label: string): StagingRecord {
  if (typeof id !== "string" || !id) {
    throw httpError(400, `${label} was not uploaded this session`);
  }
  const record = staging.get(id);
  if (!record) throw httpError(400, `${label} staging id is invalid or expired — drop the file again`);
  return record;
}

function stagedFlags(body: { imageId?: string; image2Id?: string; image3Id?: string }): StagedFlags {
  return {
    image: Boolean(body.imageId && staging.has(body.imageId)),
    image2: Boolean(body.image2Id && staging.has(body.image2Id)),
    image3: Boolean(body.image3Id && staging.has(body.image3Id)),
  };
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get(
  "/api/config",
  wrap(async (_req, res) => {
    res.json({ siteUrl: SITE_URL, siteName: SITE_NAME, maxImageBytes: MAX_FILE_BYTES });
  }),
);

app.get(
  "/api/routes",
  wrap(async (_req, res) => {
    res.json({ routes: await listKnownRoutes() });
  }),
);

app.get(
  "/articles",
  wrap(async (_req, res) => {
    const articles = await listArticles();
    res.json({
      articles: articles.map((article) => ({
        ...article.data,
        slug: article.slug,
        title: article.data.title ?? article.slug,
        draft: Boolean(article.data.draft),
        internalLinks: Array.isArray(article.data.internalLinks)
          ? article.data.internalLinks
          : [],
        externalLinks: Array.isArray(article.data.externalLinks)
          ? article.data.externalLinks
          : [],
        faqs: Array.isArray(article.data.faqs) ? article.data.faqs : [],
        updatedDate: article.data.updatedDate ?? article.data.date,
        body: article.body,
      })),
    });
  }),
);

app.get(
  "/api/articles/:slug",
  wrap(async (req, res) => {
    const article = await getArticle(req.params.slug);
    if (!article) throw httpError(404, `Article "${req.params.slug}" not found`);
    const files = existingArticleImageFiles(article.slug, article.data);
    const image = await stageFromDisk(
      files.image,
      path.basename(files.image),
    );
    const image2 = files.image2
      ? await stageFromDisk(files.image2, path.basename(files.image2))
      : null;
    const image3 = files.image3
      ? await stageFromDisk(files.image3, path.basename(files.image3))
      : null;
    res.json({
      data: article.data,
      body: article.body,
      slug: article.slug,
      staged: {
        image: image ? { id: image.id, originalName: image.originalName } : null,
        image2: image2 ? { id: image2.id, originalName: image2.originalName } : null,
        image3: image3 ? { id: image3.id, originalName: image3.originalName } : null,
      },
    });
  }),
);

app.get(
  "/api/team",
  wrap(async (_req, res) => {
    const team = await listTeam();
    res.json({
      team: team.map((member) => ({
        ...member.data,
        slug: member.slug,
      })),
    });
  }),
);

app.get(
  "/api/team/:slug",
  wrap(async (req, res) => {
    const member = await getTeamMember(req.params.slug);
    if (!member) throw httpError(404, `Team member "${req.params.slug}" not found`);
    res.json({ data: member.data, slug: member.slug });
  }),
);

app.get(
  "/api/services",
  wrap(async (_req, res) => {
    res.json({ services: await listServices() });
  }),
);

app.post(
  "/parse",
  upload.single("markdown"),
  wrap(async (req, res) => {
    if (!req.file) throw httpError(400, "Drop a .md file to parse");
    const raw = await fs.readFile(req.file.path, "utf8");
    await fs.unlink(req.file.path).catch(() => undefined);
    const parsed = matter(raw);
    res.json({
      data: jsonSafe(parsed.data),
      body: parsed.content.replace(/^\n/, ""),
    });
  }),
);

app.post(
  "/api/stage-image",
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw httpError(400, "Drop an image file (max 10MB)");
    const id = crypto.randomUUID();
    const dest = path.join(STAGING_DIR, `${id}${path.extname(req.file.originalname)}`);
    await fs.rename(req.file.path, dest);
    const record = { id, path: dest, originalName: req.file.originalname };
    staging.set(id, record);
    res.json({ id, originalName: record.originalName, size: req.file.size });
  }),
);

app.post(
  "/api/validate",
  wrap(async (req, res) => {
    const [team, routes, articles] = await Promise.all([
      listTeam(),
      listKnownRoutes(),
      listArticles(),
    ]);
    const result = validateArticleInput({
      data: req.body.data ?? {},
      body: req.body.body,
      staged: stagedFlags(req.body),
      knownAuthors: team.map((member) => member.slug),
      knownRoutes: routes,
      existingSlugs: articles.map((article) => article.slug),
      editingSlug: req.body.editingSlug,
    });
    const slug = String(req.body.data?.slug ?? "");
    const blocked = collisionBlocksGenerate(
      slug,
      articles.map((article) => article.slug),
      req.body.editingSlug,
      Boolean(req.body.overwrite),
    );
    res.json({
      ...result,
      collision: blocked,
      canGenerate: result.ok && !blocked,
    });
  }),
);

app.post(
  "/api/preview-jsonld",
  wrap(async (req, res) => {
    const authorSlug = String(req.body.author ?? "");
    const member = await getTeamMember(authorSlug);
    if (!member) throw httpError(400, "Select a valid author before previewing JSON-LD");
    const blocks = previewArticleJsonLd({
      title: String(req.body.title ?? ""),
      description: String(req.body.description ?? ""),
      slug: String(req.body.slug ?? ""),
      date: String(req.body.date ?? new Date().toISOString()),
      updatedDate: req.body.updatedDate ? String(req.body.updatedDate) : undefined,
      schemaType: req.body.schemaType ? String(req.body.schemaType) : undefined,
      locale: req.body.locale ? String(req.body.locale) : undefined,
      faqs: Array.isArray(req.body.faqs) ? req.body.faqs : [],
      author: {
        name: String(member.data.name ?? authorSlug),
        slug: member.slug,
        role: String(member.data.role ?? ""),
        bio: String(member.data.bio ?? ""),
        sameAs: Array.isArray(member.data.sameAs)
          ? (member.data.sameAs as string[])
          : [],
      },
    });
    res.json({ jsonLd: blocks });
  }),
);

type ArticleWriteBody = {
  data?: Record<string, unknown>;
  body?: unknown;
  imageId?: unknown;
  image2Id?: unknown;
  image3Id?: unknown;
  editingSlug?: string;
  overwrite?: boolean;
};

async function writeValidatedArticle(body: ArticleWriteBody) {
  const data = body.data ?? {};
  const [team, routes, articles] = await Promise.all([
    listTeam(),
    listKnownRoutes(),
    listArticles(),
  ]);
  const flags = stagedFlags({
    imageId: typeof body.imageId === "string" ? body.imageId : undefined,
    image2Id: typeof body.image2Id === "string" ? body.image2Id : undefined,
    image3Id: typeof body.image3Id === "string" ? body.image3Id : undefined,
  });
  const result = validateArticleInput({
    data,
    body: typeof body.body === "string" ? body.body : undefined,
    staged: flags,
    knownAuthors: team.map((member) => member.slug),
    knownRoutes: routes,
    existingSlugs: articles.map((article) => article.slug),
    editingSlug: body.editingSlug,
  });
  if (!result.ok) {
    throw httpError(
      400,
      `Cannot generate: ${[...result.missing, ...result.invalid].map((issue) => issue.message).join("; ")}`,
    );
  }
  if (
    collisionBlocksGenerate(
      String(data.slug ?? ""),
      articles.map((article) => article.slug),
      body.editingSlug,
      Boolean(body.overwrite),
    )
  ) {
    throw httpError(409, `Slug "${data.slug}" already exists. Overwrite or rename.`);
  }
  return writeArticle({
    data,
    body: String(body.body ?? ""),
    overwrite: Boolean(body.overwrite),
    originalSlug: body.editingSlug,
    staged: {
      image: requireStaged(body.imageId, "Hero image"),
      image2: body.image2Id ? requireStaged(body.image2Id, "Image 2") : undefined,
      image3: body.image3Id ? requireStaged(body.image3Id, "Image 3") : undefined,
    },
  });
}

app.post(
  "/api/articles",
  wrap(async (req, res) => {
    const written = await writeValidatedArticle(req.body);
    if (!req.body.skipLlmsTxt) {
      await generateLlmsTxt();
    }
    res.json({ ok: true, slug: written.slug });
  }),
);

app.post(
  "/api/llms-txt",
  wrap(async (_req, res) => {
    await generateLlmsTxt();
    res.json({ ok: true });
  }),
);

app.patch(
  "/api/articles/:slug/draft",
  wrap(async (req, res) => {
    const article = await getArticle(req.params.slug);
    if (!article) throw httpError(404, `Article "${req.params.slug}" not found`);
    const draft = Boolean(req.body.draft);
    await setArticleDraft(req.params.slug, draft);
    await generateLlmsTxt();
    res.json({ ok: true, slug: req.params.slug, draft });
  }),
);

app.delete(
  "/api/articles/:slug",
  wrap(async (req, res) => {
    const article = await getArticle(req.params.slug);
    if (!article) throw httpError(404, `Article "${req.params.slug}" not found`);
    await deleteArticle(req.params.slug);
    await generateLlmsTxt();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/team",
  upload.single("photo"),
  wrap(async (req, res) => {
    const sameAsRaw = String(req.body.sameAs ?? "").trim();
    const sameAs = sameAsRaw
      ? sameAsRaw.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean)
      : [];
    const written = await writeTeamMember({
      data: {
        name: String(req.body.name ?? ""),
        slug: String(req.body.slug ?? ""),
        role: String(req.body.role ?? ""),
        bio: String(req.body.bio ?? ""),
        credentials: req.body.credentials ? String(req.body.credentials) : undefined,
        sameAs,
      },
      photo: req.file
        ? { path: req.file.path, originalName: req.file.originalname }
        : undefined,
      originalSlug: req.body.originalSlug || undefined,
      keepExistingPhoto: req.body.keepExistingPhoto === "true",
    });
    res.json({ ok: true, slug: written.slug });
  }),
);

app.delete(
  "/api/team/:slug",
  wrap(async (req, res) => {
    const member = await getTeamMember(req.params.slug);
    if (!member) throw httpError(404, `Team member "${req.params.slug}" not found`);
    await deleteTeamMember(req.params.slug);
    res.json({ ok: true });
  }),
);

app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path === "/articles" || req.path === "/parse") {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
    return;
  }
  next();
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const error = err as { status?: number; statusCode?: number; code?: string; message?: string };
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      error: "File too large. Maximum size is 10MB per file.",
    });
    return;
  }
  const status = error.status || error.statusCode || 500;
  res.status(status).json({
    error: error.message || "Server error",
  });
});

await fs.mkdir(STAGING_DIR, { recursive: true });

app.listen(PORT, () => {
  console.log(`CMS running at http://localhost:${PORT}`);
});
