"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { continueBullet, indentBullets, toggleBullets } from "@/lib/text-bullets";
import { isClean, readSelection, readText, render, restyle, setSelection } from "@/lib/line-editor-dom";

/** Grows with its text: no scrollbar inside the box. */
function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return ref;
}

/** A plain textarea that fits its text. */
export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useAutoHeight(props.value);
  return <textarea {...props} ref={ref} rows={props.rows ?? 2} className={`${props.className ?? ""} resize-none overflow-hidden`} />;
}

type Edit = { text: string; start: number; end: number };

/**
 * An email body, as plain text with bullet points, shown the way it reads:
 * bullets are set in from the margin and wrapped lines line up after the
 * bullet. The Bullets button adds "• " to the selected lines (or the cursor's
 * line), and removes it when every selected line has one. Indent / Outdent (or
 * Tab / Shift+Tab on a bullet) make a sub-bullet "  ◦ " and back. Enter on a
 * bullet starts the next one; Enter on an empty bullet ends the list.
 */
export function EmailBodyField({
  value,
  onChange,
  className,
  label,
  placeholder,
  disabled,
  maxLength = 10000,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The text the editor shows; a new value from outside (Draft Email) re-renders it.
  const shown = useRef<string | null>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === shown.current) return;
    render(el, value);
    shown.current = value;
    if (pending.current) {
      setSelection(el, pending.current.start, pending.current.end);
      pending.current = null;
    }
  }, [value]);

  // Fonts can load after the first render: measure the bullets again then.
  useEffect(() => {
    const el = ref.current;
    if (!el || !document.fonts) return;
    void document.fonts.ready.then(() => ref.current && restyle(ref.current));
  }, []);

  function commit(next: Edit) {
    const el = ref.current;
    if (!el) return;
    const text = next.text.slice(0, maxLength);
    render(el, text);
    shown.current = text;
    el.focus();
    setSelection(el, Math.min(next.start, text.length), Math.min(next.end, text.length));
    onChange(text);
  }

  function apply(edit: (text: string, start: number, end: number) => Edit) {
    const el = ref.current;
    if (!el || disabled) return;
    const text = readText(el);
    const sel = readSelection(el) ?? { start: text.length, end: text.length };
    const next = edit(text, sel.start, sel.end);
    // A cursor (no selection) stays a cursor, moved by what the edit added or removed before it on its line.
    if (sel.start === sel.end && next.end - next.start !== 0 && next.start <= sel.start) {
      const at = Math.max(next.start, sel.start + next.text.length - text.length);
      return commit({ text: next.text, start: at, end: at });
    }
    commit(next);
  }

  function insert(piece: string) {
    apply((text, start, end) => {
      const at = start + piece.length;
      return { text: text.slice(0, start) + piece + text.slice(end), start: at, end: at };
    });
  }

  function onInput() {
    const el = ref.current;
    if (!el) return;
    const sel = readSelection(el);
    let text = readText(el);
    if (text.length > maxLength) text = shown.current ?? text.slice(0, maxLength);
    if (!isClean(el) || text !== readText(el)) {
      render(el, text);
      if (sel) setSelection(el, Math.min(sel.start, text.length), Math.min(sel.end, text.length));
    } else {
      restyle(el);
    }
    shown.current = text;
    onChange(text);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    if (event.key === "Tab") {
      const text = readText(el);
      const sel = readSelection(el);
      if (!sel) return;
      const lineStart = text.lastIndexOf("\n", Math.max(0, sel.start - 1)) + 1;
      if (!/^\s*[•◦\-*]\s/.test(text.slice(lineStart))) return;
      event.preventDefault();
      apply((t, a, b) => indentBullets(t, a, b, event.shiftKey));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const text = readText(el);
      const sel = readSelection(el);
      if (!sel) return;
      const next = !event.shiftKey && sel.start === sel.end ? continueBullet(text, sel.start) : null;
      if (next) commit({ text: next.text, start: next.cursor, end: next.cursor });
      else insert("\n");
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    insert(event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"));
  }

  const tool =
    "rounded-md border border-border bg-surface px-sm py-px text-body-sm normal-case tracking-normal text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

  return (
    <div className="mt-sm">
      <div className="mb-xs flex justify-end gap-xs">
        {/* onMouseDown keeps the selection in the editor when a button is clicked. */}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply(toggleBullets)}
          disabled={disabled}
          className={tool}
          title="Select lines, then click to turn them into bullet points (click again to remove)"
        >
          • Bullets
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply((t, a, b) => indentBullets(t, a, b, true))}
          disabled={disabled}
          className={tool}
          title="Outdent (Shift+Tab on a bullet)"
        >
          ← Outdent
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply((t, a, b) => indentBullets(t, a, b))}
          disabled={disabled}
          className={tool}
          title="Indent: a bullet becomes a sub-bullet (Tab on a bullet)"
        >
          Indent →
        </button>
      </div>
      <div className="relative">
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-disabled={disabled || undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          className={`${className} min-h-[4.5em] whitespace-pre-wrap break-words outline-none ${disabled ? "opacity-60" : ""}`}
          // Spaces are text here (a bullet's "• "), so they must not collapse.
          style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {!value && placeholder ? (
          <p className={`${className} pointer-events-none absolute inset-0 border-transparent bg-transparent text-muted`} aria-hidden>
            {placeholder}
          </p>
        ) : null}
      </div>
    </div>
  );
}
