"use client";

import { useState } from "react";
import { testClaudeConnection } from "@/app/admin/actions";

export function TestClaudeButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  async function onClick() {
    setPending(true);
    setResult(null);
    try {
      const outcome = await testClaudeConnection();
      setResult(
        outcome.ok
          ? { kind: "ok", text: `Connected (${outcome.model}): "${outcome.reply}"` }
          : { kind: "error", text: outcome.reason },
      );
    } catch (err) {
      setResult({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to test.",
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
        {pending ? "Testing…" : "Test Rupert connection"}
      </button>
      {result ? (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={`break-words text-right text-body-sm ${
            result.kind === "ok" ? "text-success" : "text-error"
          }`}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
