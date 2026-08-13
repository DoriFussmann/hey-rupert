import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import {
  TEAM_DIR,
  teamAssetDir,
  teamMarkdownPath,
  teamPhotoFrontmatterPath,
} from "./paths.ts";
import { teamSchema } from "./schema.ts";

export type WriteTeamInput = {
  data: {
    name: string;
    slug: string;
    role: string;
    bio: string;
    credentials?: string;
    sameAs?: string[];
  };
  photo?: { path: string; originalName: string };
  originalSlug?: string;
  keepExistingPhoto?: boolean;
};

function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase() || ".png";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeTeamMember(input: WriteTeamInput): Promise<{ slug: string }> {
  const parsed = teamSchema.parse({
    ...input.data,
    photo: input.photo?.originalName || "existing",
    sameAs: input.data.sameAs ?? [],
  });
  const slug = parsed.slug;

  await fs.mkdir(TEAM_DIR, { recursive: true });

  if (input.originalSlug && input.originalSlug !== slug) {
    const oldMd = teamMarkdownPath(input.originalSlug);
    if (await fileExists(oldMd)) await fs.unlink(oldMd);
    await fs.rm(teamAssetDir(input.originalSlug), { recursive: true, force: true });
  }

  const assetDir = teamAssetDir(slug);
  await fs.mkdir(assetDir, { recursive: true });

  let photoFilename: string | undefined;
  if (input.photo) {
    photoFilename = `photo${extensionOf(input.photo.originalName)}`;
    await fs.copyFile(input.photo.path, path.join(assetDir, photoFilename));
  } else if (input.keepExistingPhoto) {
    const existing = await fs.readdir(assetDir).catch(() => []);
    photoFilename = existing.find((name) => name.startsWith("photo")) ?? "photo.png";
  } else {
    throw Object.assign(new Error("Team member photo is required"), { status: 400 });
  }

  const frontmatter = {
    name: parsed.name,
    slug: parsed.slug,
    role: parsed.role,
    bio: parsed.bio,
    credentials: parsed.credentials || undefined,
    photo: teamPhotoFrontmatterPath(slug, photoFilename),
    sameAs: parsed.sameAs ?? [],
  };

  const yaml = stringify(frontmatter, { lineWidth: 0 });
  await fs.writeFile(teamMarkdownPath(slug), `---\n${yaml}---\n`, "utf8");
  return { slug };
}

export async function deleteTeamMember(slug: string): Promise<void> {
  const md = teamMarkdownPath(slug);
  if (await fileExists(md)) await fs.unlink(md);
  await fs.rm(teamAssetDir(slug), { recursive: true, force: true });
}
