// A plain-text client email as simple HTML: the same words, with paragraphs,
// bullet lists and clickable links. Tracked emails need an HTML part (opens
// are counted by an image, clicks by the links). Pure module.
import { bulletOf } from "./text-bullets.ts";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const P_STYLE = "margin:0 0 16px;font-size:16px;line-height:1.6;color:#2D2D2D";
const UL_STYLE = "margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:#2D2D2D";
const SUB_UL_STYLE = "margin:8px 0 0;padding-left:20px;list-style-type:circle";
const LINK_STYLE = "color:#5C7A5E";

/** Escapes a line and turns each web address in it into a link. Punctuation after an address stays outside it. */
function lineHtml(line: string) {
  const out: string[] = [];
  let last = 0;
  for (const match of Array.from(line.matchAll(/https?:\/\/[^\s<>"]+/g))) {
    const start = match.index ?? 0;
    const url = match[0].replace(/[.,;:!?)\]'"]+$/, "");
    out.push(escapeHtml(line.slice(last, start)));
    out.push(`<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${escapeHtml(url)}</a>`);
    last = start + url.length;
  }
  out.push(escapeHtml(line.slice(last)));
  return out.join("");
}

/** One block: its plain lines as a paragraph, its bullet lines ("• ", "  ◦ ", "- ") as a list, nested by level. */
function blockHtml(lines: string[]) {
  const out: string[] = [];
  let plain: string[] = [];
  let items: { html: string; subs: string[] }[] = [];
  const flushText = () => {
    if (plain.length) out.push(`<p style="${P_STYLE}">${plain.map(lineHtml).join("<br>")}</p>`);
    plain = [];
  };
  const flushList = () => {
    if (items.length) {
      const li = items
        .map((i) => `<li style="margin:0 0 8px">${i.html}${i.subs.length ? `<ul style="${SUB_UL_STYLE}">${i.subs.map((x) => `<li style="margin:0 0 4px">${x}</li>`).join("")}</ul>` : ""}</li>`)
        .join("");
      // A list right under a line of text sits close to it.
      if (out.length && out[out.length - 1].startsWith("<p")) out[out.length - 1] = out[out.length - 1].replace("margin:0 0 16px", "margin:0 0 8px");
      out.push(`<ul style="${UL_STYLE}">${li}</ul>`);
    }
    items = [];
  };
  for (const line of lines) {
    const b = bulletOf(line);
    if (!b) {
      flushList();
      plain.push(line);
      continue;
    }
    flushText();
    if (b.level === 2 && items.length) items[items.length - 1].subs.push(lineHtml(b.rest));
    else items.push({ html: lineHtml(b.rest), subs: [] });
  }
  flushText();
  flushList();
  return out.join("");
}

/** The email's text as an HTML document. A line "[Label] → https://…" on its own becomes a button. */
export function plainEmailHtml(text: string) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n");
      const cta = lines.length === 1 ? lines[0].match(/^\[(.+?)\]\s*→\s*(https?:\/\/\S+)\s*$/) : null;
      if (cta) {
        return `<p style="margin:24px 0"><a href="${escapeHtml(cta[2])}" style="display:inline-block;background:#5C7A5E;color:#ffffff;text-decoration:none;font-size:16px;line-height:1.4;padding:12px 20px;border-radius:6px">${escapeHtml(cta[1])}</a></p>`;
      }
      return blockHtml(lines);
    })
    .join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#FAF9F5;color:#2D2D2D;font-family:Inter,Helvetica,Arial,sans-serif">${html}</body></html>`;
}
