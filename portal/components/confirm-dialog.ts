"use client";

// An in-page "Are you sure?" dialog, in place of window.confirm.
//
// window.confirm is a browser pop-up. Some browsers block it silently (an
// embedded browser pane, some in-app and mobile browsers), and then the click
// does nothing and nobody knows why. This draws the question inside the page
// instead, so it works everywhere. Same use as window.confirm, but awaited:
//
//   if (!(await askConfirm("Send this email?"))) return;
//
// Enter or the confirm button answers yes; Escape, Cancel or a click outside
// answers no. One dialog at a time: a second call waits for the first.

const CONFIRM_LABEL = /\b(delete|remove|discard|cancels)\b/i;

let queue: Promise<unknown> = Promise.resolve();

export function askConfirm(message: string, options: { confirmLabel?: string; cancelLabel?: string } = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  const run = () => show(message, options);
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function show(message: string, options: { confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const danger = CONFIRM_LABEL.test(message);

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 px-md";
    overlay.setAttribute("data-confirm-dialog", "");

    const box = document.createElement("div");
    box.className = "w-full max-w-md rounded-card border border-border bg-surface px-lg py-lg shadow-[0_12px_40px_rgba(0,0,0,0.18)]";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    const text = document.createElement("p");
    text.className = "whitespace-pre-line text-body text-heading";
    text.id = `confirm-${Math.random().toString(36).slice(2)}`;
    text.textContent = message;
    box.setAttribute("aria-labelledby", text.id);

    const row = document.createElement("div");
    row.className = "mt-lg flex justify-end gap-sm";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className =
      "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading";
    cancel.textContent = options.cancelLabel ?? "Cancel";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = danger
      ? "rounded-md bg-error px-md py-sm text-body-sm text-white transition-opacity duration-hover hover:opacity-90"
      : "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover";
    ok.textContent = options.confirmLabel ?? "Confirm";

    row.append(cancel, ok);
    box.append(text, row);
    overlay.append(box);

    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      previous?.focus?.();
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finish(document.activeElement !== cancel);
      } else if (event.key === "Tab") {
        // Keep focus on the two buttons.
        event.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    };

    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    ok.focus();
  });
}
