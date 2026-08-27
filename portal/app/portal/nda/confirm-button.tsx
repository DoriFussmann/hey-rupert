"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmNda } from "@/app/portal/actions";
import { formatDate } from "@/lib/format";

export function ConfirmNdaButton({
  signedAt,
}: {
  signedAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedAt) {
    return (
      <p className="text-body-sm text-muted">
        Confirmed on {formatDate(signedAt)}.
      </p>
    );
  }

  async function onClick() {
    setPending(true);
    setError(null);

    try {
      const result = await confirmNda();
      if (!result?.ok) {
        setError(result?.error ?? "Unable to confirm.");
        setPending(false);
        return;
      }

      router.push("/portal/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to confirm.");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Confirm NDA"}
      </button>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
