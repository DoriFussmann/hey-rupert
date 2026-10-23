import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { ClaudeContentBlock } from "@/lib/anthropic";
import { OFFICE_TEXT_EXTENSIONS, extractOfficeText } from "@/lib/office-text";
import {
  MATERIALS_BUCKET,
  fileExtension,
  formatBytes,
  type MaterialFile,
} from "@/lib/setup";

// Turns company materials into content Claude can read: PDFs and images as
// they are, Office files and text as plain text. Used by the intake (files
// shared in the chat), the materials analysis and the test pilot.

type ServiceClient = ReturnType<typeof createServiceClient>;

const PDF_IMAGE_BUDGET_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const PLAIN_TEXT = new Set(["txt", "md", "csv"]);
const ASK_FOR_PDF: Record<string, string> = {
  key: "Keynote can't be read. Ask the client for a PDF export.",
  ppt: "Old PowerPoint format can't be read. Ask the client for a PDF.",
  doc: "Old Word format can't be read. Ask the client for a PDF or .docx.",
  xls: "Old Excel format can't be read. Ask the client for .xlsx or CSV.",
};

export type PreparedFiles = {
  blocks: ClaudeContentBlock[];
  read: string[];
  skipped: string[];
};

export async function prepareFiles(
  supabase: ServiceClient,
  files: MaterialFile[],
): Promise<PreparedFiles> {
  const prepared: PreparedFiles = { blocks: [], read: [], skipped: [] };
  let binaryBytes = 0;

  for (const file of files) {
    const extension = fileExtension(file.name);
    if (ASK_FOR_PDF[extension]) {
      prepared.skipped.push(`${file.name}: ${ASK_FOR_PDF[extension]}`);
      continue;
    }
    const isPdf = extension === "pdf";
    const imageType = IMAGE_TYPES[extension];
    const isOffice = (OFFICE_TEXT_EXTENSIONS as readonly string[]).includes(extension);
    if (!isPdf && !imageType && !isOffice && !PLAIN_TEXT.has(extension)) {
      prepared.skipped.push(`${file.name}: this file type can't be read.`);
      continue;
    }
    if (imageType && file.size > IMAGE_MAX_BYTES) {
      prepared.skipped.push(
        `${file.name}: images over ${formatBytes(IMAGE_MAX_BYTES)} can't be read.`,
      );
      continue;
    }
    if ((isPdf || imageType) && binaryBytes + file.size > PDF_IMAGE_BUDGET_BYTES) {
      prepared.skipped.push(
        `${file.name}: skipped to stay within the ${formatBytes(PDF_IMAGE_BUDGET_BYTES)} the AI can read in one go.`,
      );
      continue;
    }

    const { data, error } = await supabase.storage.from(MATERIALS_BUCKET).download(file.path);
    if (error || !data) {
      prepared.skipped.push(`${file.name}: could not be downloaded (${error?.message ?? "unknown error"}).`);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    if (isPdf) {
      binaryBytes += buffer.length;
      prepared.blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
        title: file.name,
      });
      prepared.read.push(file.name);
    } else if (imageType) {
      binaryBytes += buffer.length;
      prepared.blocks.push({ type: "text", text: `Image file: ${file.name}` });
      prepared.blocks.push({
        type: "image",
        source: { type: "base64", media_type: imageType, data: buffer.toString("base64") },
      });
      prepared.read.push(file.name);
    } else {
      let content = "";
      try {
        content = isOffice
          ? extractOfficeText(buffer, extension)
          : buffer.toString("utf8").slice(0, 120_000);
      } catch (err) {
        prepared.skipped.push(
          `${file.name}: could not be read (${err instanceof Error ? err.message : "unknown error"}).`,
        );
        continue;
      }
      if (!content.trim()) {
        prepared.skipped.push(`${file.name}: no readable text.`);
        continue;
      }
      prepared.blocks.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: content },
        title: file.name,
      });
      prepared.read.push(isOffice ? `${file.name} (text only)` : file.name);
    }
  }
  return prepared;
}
