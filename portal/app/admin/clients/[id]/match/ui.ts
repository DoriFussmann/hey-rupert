// Shared bits for the Match page components.

export type Notice = { kind: "ok" | "error"; text: string };

type ActionResult = { ok: true } | { ok: false; error: string };

/** Runs a server action with the shared busy state and error notice. */
export type RunAction = <T extends ActionResult>(
  label: string,
  action: () => Promise<T>,
  onDone: (result: Extract<T, { ok: true }>) => void,
) => Promise<void>;

export const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
export const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
export const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
export const inputClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
export const labelClass = "block text-label uppercase tracking-label text-muted";
export const cardClass = "rounded-card border border-border bg-surface";

export function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function n(value: number) {
  return value.toLocaleString("en-US");
}
