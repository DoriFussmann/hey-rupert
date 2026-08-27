"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmStatementOfWork } from "@/app/portal/actions";
import { formatDate } from "@/lib/format";

export function AcknowledgeButton({
  acknowledgedAt,
}: {
  acknowledgedAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (acknowledgedAt) {
    return (
      <p className="text-body-sm text-muted">
        Confirmed on {formatDate(acknowledgedAt)}.
      </p>
    );
  }

  async function onClick() {
    setPending(true);
    setError(null);

    try {
      const result = await confirmStatementOfWork();
      if (!result?.ok) {
        setError(result?.error ?? "Unable to submit.");
        setPending(false);
        return;
      }

      router.push("/portal/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit.");
      setPending(false);
    }
  }

  return (
    <div>
      <p className="mb-sm text-body-sm text-body">
        Review of the Statement of Work is not a commitment.
      </p>
      <p className="mb-md text-body-sm text-body">
        Next Step: You will receive a Service Order to confirm.
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
      >
        {pending ? "Submitting…" : "I Confirm the Statement of Work"}
      </button>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
