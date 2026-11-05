"use client";

import { useLayoutEffect, useRef } from "react";
import { continueBullet, indentBullets, toggleBullets } from "@/lib/text-bullets";

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

/**
 * An email body: grows to fit, with bullet points. The Bullets button adds
 * "• " to the selected lines (or the cursor's line), and removes it when every
 * selected line has one. Indent / Outdent (or Tab / Shift+Tab on a bullet)
 * make a sub-bullet "  ◦ " and back. Enter on a bullet starts the next one;
 * Enter on an empty bullet ends the list.
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
  maxLength?: number;
  value: string;
  onChange: (value: string) => void;
  className: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useAutoHeight(value);

  function apply(edit: (text: string, start: number, end: number) => { text: string; start: number; end: number }) {
    const el = ref.current;
    if (!el) return;
    const next = edit(value, el.selectionStart, el.selectionEnd);
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    const lineStart = value.lastIndexOf("\n", Math.max(0, el.selectionStart - 1)) + 1;
    const onBullet = /^\s*[•◦\-*]\s/.test(value.slice(lineStart));
    if (event.key === "Tab" && onBullet) {
      event.preventDefault();
      apply((t, a, b) => indentBullets(t, a, b, event.shiftKey));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && el.selectionStart === el.selectionEnd) {
      const next = continueBullet(value, el.selectionStart);
      if (!next) return;
      event.preventDefault();
      onChange(next.text);
      requestAnimationFrame(() => el.setSelectionRange(next.cursor, next.cursor));
    }
  }

  const tool =
    "rounded-md border border-border bg-surface px-sm py-px text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

  return (
    <div className="mt-sm">
      <div className="mb-xs flex justify-end gap-xs">
        {/* onMouseDown keeps the selection in the textarea when a button is clicked. */}
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
      <textarea
        ref={ref}
        className={`${className} resize-none overflow-hidden`}
        rows={3}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
