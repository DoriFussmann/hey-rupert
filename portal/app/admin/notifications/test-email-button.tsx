"use client";

import { useState } from "react";
import { sendTestEmail } from "@/app/admin/actions";

export function TestEmailButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  async function onClick() {
    setPending(true);
    setResult(null);

    try {
      const outcome = await sendTestEmail();
      setResult(
        outcome.ok
          ? { kind: "ok", text: "Test email sent. Check your inbox." }
          : { kind: "error", text: outcome.reason },
      );
    } catch (err) {
      setResult({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to send.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col items-end gap-sm">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
      >
        {pending ? "Sending…" : "Send test email"}
      </button>
      {result ? (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={`text-right text-body-sm ${
            result.kind === "ok" ? "text-success" : "text-error"
          }`}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
