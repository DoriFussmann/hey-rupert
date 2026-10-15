import "server-only";
import { inflateRawSync } from "zlib";

// Plain-text extraction from Office files (.docx, .pptx, .xlsx) so the
// materials agent can read them. These formats are zip archives of XML; this
// reads only the parts that hold text. Layout and images are not extracted.

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const OFFICE_TEXT_MAX_CHARS = 120_000;

/** Reads a zip's file entries by name (stored or deflated only). */
function readZip(buffer: Buffer, wanted: (name: string) => boolean) {
  const files = new Map<string, Buffer>();
  const minEnd = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let i = buffer.length - 22; i >= minEnd; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a valid Office file");

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("the file is damaged");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (!wanted(name)) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(name, data);
    } else if (method === 8) {
      files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    }
  }
  return files;
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

/** Text runs (`<w:t>`, `<a:t>`, `<t>`) of each paragraph, one per line. */
function paragraphs(xml: string, paragraphTag: string, textTag: string) {
  const textPattern = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>`, "g");
  return xml
    .split(`</${paragraphTag}>`)
    .map((chunk) =>
      Array.from(chunk.matchAll(textPattern), (match) => decodeXml(match[1])).join(""),
    )
    .map((line) => line.trim())
    .filter(Boolean);
}

function numbered(names: string[], pattern: RegExp) {
  return names
    .map((name) => ({ name, n: Number(name.match(pattern)?.[1] ?? 0) }))
    .filter((entry) => entry.n > 0)
    .sort((a, b) => a.n - b.n);
}

function docxText(buffer: Buffer) {
  const files = readZip(buffer, (name) => name === "word/document.xml");
  const xml = files.get("word/document.xml")?.toString("utf8") ?? "";
  return paragraphs(xml, "w:p", "w:t").join("\n");
}

function pptxText(buffer: Buffer) {
  const pattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  const files = readZip(buffer, (name) => pattern.test(name));
  return numbered(Array.from(files.keys()), pattern)
    .map(({ name, n }) => {
      const lines = paragraphs(files.get(name)!.toString("utf8"), "a:p", "a:t");
      return `Slide ${n}:\n${lines.join("\n") || "(no text)"}`;
    })
    .join("\n\n");
}

function xlsxText(buffer: Buffer) {
  const sheetPattern = /^xl\/worksheets\/sheet(\d+)\.xml$/;
  const files = readZip(
    buffer,
    (name) => name === "xl/sharedStrings.xml" || sheetPattern.test(name),
  );
  const shared = Array.from(
    (files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
    (match) =>
      Array.from(match[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g), (part) =>
        decodeXml(part[1]),
      ).join(""),
  );

  return numbered(Array.from(files.keys()), sheetPattern)
    .map(({ name, n }) => {
      const xml = files.get(name)!.toString("utf8");
      const rows = Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g), (row) =>
        Array.from(
          row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g),
          (cell) => {
            const attributes = cell[1];
            const inner = cell[2] ?? "";
            const value = inner.match(/<v>([^<]*)<\/v>/)?.[1];
            if (/t="s"/.test(attributes) && value != null) {
              return shared[Number(value)] ?? "";
            }
            const inline = inner.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/)?.[1];
            return decodeXml(inline ?? value ?? "");
          },
        )
          .join("\t")
          .trim(),
      ).filter(Boolean);
      return `Sheet ${n}:\n${rows.join("\n") || "(empty)"}`;
    })
    .join("\n\n");
}

export const OFFICE_TEXT_EXTENSIONS = ["docx", "pptx", "xlsx"] as const;

/** Extracted text, trimmed to a safe length. Throws on unreadable files. */
export function extractOfficeText(buffer: Buffer, extension: string) {
  const text =
    extension === "docx"
      ? docxText(buffer)
      : extension === "pptx"
        ? pptxText(buffer)
        : extension === "xlsx"
          ? xlsxText(buffer)
          : "";
  return text.length > OFFICE_TEXT_MAX_CHARS
    ? `${text.slice(0, OFFICE_TEXT_MAX_CHARS)}\n[…truncated]`
    : text;
}
