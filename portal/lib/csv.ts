// CSV reading and writing. Pure module (no server code).

/** RFC 4180-style parser: quoted fields, escaped quotes, newlines in quotes. Detects ; and tab files. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = firstLine.match(/,/g)?.length ?? 0;
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > commas
      ? ";"
      : (firstLine.match(/\t/g)?.length ?? 0) > commas
        ? "\t"
        : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** One CSV cell, quoted when it needs to be. */
export function csvCell(value: string) {
  return /[",\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header text compared loosely: case, spaces, dashes and underscores ignored. */
export function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, "");
}
