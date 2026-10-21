"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText } from "@/app/admin/clients/[id]/match/ui";

type ActionResult = { ok: true } | { ok: false; error: string };

/** Runs a server action with a busy flag and an error message, then refreshes the page. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T extends ActionResult>(action: () => Promise<T>): Promise<Extract<T, { ok: true }> | null> {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      router.refresh();
      return result as Extract<T, { ok: true }>;
    } catch (err) {
      setError(errorText(err, "Something went wrong."));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-xs text-body-sm text-error">
      {error}
    </p>
  ) : null;
}
