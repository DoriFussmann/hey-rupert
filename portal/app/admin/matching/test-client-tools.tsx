"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { copyProfileToTestClient, createTestClient, resetTestClient } from "@/app/admin/sandbox-actions";
import { Select } from "@/components/select";
import { secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { matchPath } from "@/lib/match/shared";

/**
 * The test client: a pretend company that goes through the whole flow, to its
 * own test portal, with no real client and no email. Copy a real client's
 * profile into it, or start it clean.
 */
export function TestClientTools({ testClientId, clients }: { testClientId: string | null; clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [source, setSource] = useState("");

  if (!testClientId) {
    return (
      <div className="mt-sm text-body-sm text-muted">
        <button
          type="button"
          className={secondaryButton}
          disabled={pending}
          onClick={async () => {
            const done = await run(() => createTestClient());
            if (done) router.push(matchPath(done.clientId));
          }}
        >
          Create the test client
        </button>{" "}
        A pretend company for trying the whole flow. It never emails anyone.
        <ErrorLine error={error} />
      </div>
    );
  }

  return (
    <div className="mt-md rounded-card border border-primary/40 bg-primary-tint px-md py-sm text-body-sm text-heading">
      <p>
        <strong className="font-medium">Test client.</strong> Not a real client: no emails. Push to client publishes to its own test portal.{" "}
        <a
          href={`/admin/clients/${testClientId}/view?next=/portal/setup/investor-list`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary-hover"
        >
          See its portal ↗
        </a>
      </p>
      <div className="mt-sm flex flex-wrap items-end gap-sm">
        <label className="min-w-[14rem] text-label uppercase tracking-label text-muted">
          Copy a client&apos;s profile into it
          <Select value={source} onChange={(event) => setSource(event.target.value)} className="normal-case tracking-normal">
            <option value="">Choose a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          className={secondaryButton}
          disabled={pending || !source}
          onClick={() => {
            if (!window.confirm("Replace the test client's company profile with this client's? The real client is not changed.")) return;
            void run(() => copyProfileToTestClient(source));
          }}
        >
          Copy profile
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Start the test client clean? Its reviews, contact decisions, verification runs and pushed list are deleted. Saved runs stay as history.")) return;
            void run(() => resetTestClient());
          }}
        >
          Start it clean
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
