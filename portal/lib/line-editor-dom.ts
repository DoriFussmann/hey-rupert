// The DOM side of the email body editor: one <div> per line of plain text,
// bullet lines styled with a hanging indent (wrapped text lines up after the
// bullet) and set in from the margin. The plain text stays the source of truth.

import { bulletOf } from "./text-bullets.ts";

/** How far a bullet sits in from the margin, per level. */
const INSET_EM = { 1: 1, 2: 2 } as const;

let canvas: HTMLCanvasElement | null = null;
function textWidth(text: string, font: string) {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function styleLine(div: HTMLElement, line: string, font: string, em: number) {
  const b = bulletOf(line);
  if (!b) {
    div.style.paddingLeft = "";
    div.style.textIndent = "";
    return;
  }
  // The prefix (with its leading spaces) is part of the text: indent it back by its own width.
  const w = textWidth(b.prefix.replace(/\t/g, "    "), font);
  const inset = INSET_EM[b.level] * em - (b.level === 2 ? textWidth(b.prefix.match(/^\s*/)![0], font) : 0);
  div.style.paddingLeft = `${Math.max(0, inset) + w}px`;
  div.style.textIndent = `${-w}px`;
}

function fontOf(root: HTMLElement) {
  const cs = getComputedStyle(root);
  return { font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, em: parseFloat(cs.fontSize) || 16 };
}

/** Re-applies the bullet styles to the line divs (after typing). */
export function restyle(root: HTMLElement) {
  const { font, em } = fontOf(root);
  for (const div of Array.from(root.children) as HTMLElement[]) styleLine(div, div.textContent ?? "", font, em);
}

/** Replaces the content with one div per line. */
export function render(root: HTMLElement, text: string) {
  const { font, em } = fontOf(root);
  const divs = text.split("\n").map((line) => {
    const div = document.createElement("div");
    if (line) div.textContent = line;
    else div.appendChild(document.createElement("br"));
    styleLine(div, line, font, em);
    return div;
  });
  root.replaceChildren(...divs);
}

/** Whether the content is still one div per line holding only text (else it needs a render). */
export function isClean(root: HTMLElement) {
  if (!root.children.length || root.childNodes.length !== root.children.length) return false;
  for (const div of Array.from(root.children)) {
    if (div.tagName !== "DIV") return false;
    for (const n of Array.from(div.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) continue;
      if (n.nodeName === "BR" && div.childNodes.length === 1) continue;
      return false;
    }
  }
  return true;
}

/** The plain text: one line per div (or whatever the browser left, read as text). */
export function readText(root: HTMLElement) {
  if (isClean(root)) return (Array.from(root.children) as HTMLElement[]).map((d) => d.textContent ?? "").join("\n");
  return root.innerText.replace(/\n$/, "");
}

/** Where a DOM point falls in the plain text. */
function offsetOf(root: HTMLElement, node: Node, offset: number) {
  // Count the text before the point, with a newline between line divs.
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  const frag = range.cloneContents();
  const holder = document.createElement("div");
  holder.appendChild(frag);
  const lines = Array.from(holder.childNodes);
  if (!lines.length) return 0;
  // Each line div in the fragment adds its text; all but the last add a newline.
  let total = 0;
  lines.forEach((n, i) => {
    total += (n.textContent ?? "").length;
    if (i < lines.length - 1 && n.nodeName === "DIV") total += 1;
  });
  // A point between two line divs (on the editor itself) starts the next line.
  if (node === root && offset > 0 && offset < root.childNodes.length) total += 1;
  return total;
}

export function readSelection(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return { start: offsetOf(root, r.startContainer, r.startOffset), end: offsetOf(root, r.endContainer, r.endOffset) };
}

function pointAt(root: HTMLElement, offset: number): [Node, number] {
  const divs = Array.from(root.children) as HTMLElement[];
  let left = offset;
  for (let i = 0; i < divs.length; i++) {
    const len = (divs[i].textContent ?? "").length;
    if (left <= len || i === divs.length - 1) {
      const t = divs[i].firstChild;
      if (t && t.nodeType === Node.TEXT_NODE) return [t, Math.min(left, len)];
      return [divs[i], 0];
    }
    left -= len + 1;
  }
  return [root, 0];
}

export function setSelection(root: HTMLElement, start: number, end = start) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const [sn, so] = pointAt(root, start);
  const [en, eo] = pointAt(root, end);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(range);
}
