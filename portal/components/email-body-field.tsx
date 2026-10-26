"use client";

import { useLayoutEffect, useRef } from "react";
import { toggleBullets } from "@/lib/text-bullets";

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
 * An email body: grows to fit, with a Bullets button that adds "• " to the
 * selected lines (or the line the cursor is on), and removes it when every
 * selected line has one.
 */
export function EmailBodyField({
  value,
  onChange,
  className,
  label,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useAutoHeight(value);

  function bullets() {
    const el = ref.current;
    if (!el) return;
    const next = toggleBullets(value, el.selectionStart, el.selectionEnd);
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className="mt-sm">
      <div className="mb-xs flex justify-end">
        <button
          type="button"
          // Keeps the selection in the textarea when the button is clicked.
          onMouseDown={(event) => event.preventDefault()}
          onClick={bullets}
          disabled={disabled}
          className="rounded-md border border-border bg-surface px-sm py-px text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
          title="Select lines, then click to turn them into bullet points (click again to remove)"
        >
          • Bullets
        </button>
      </div>
      <textarea
        ref={ref}
        className={`${className} resize-none overflow-hidden`}
        rows={3}
        maxLength={10000}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
