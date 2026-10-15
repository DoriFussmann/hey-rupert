"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  completeClientStep,
  createTestDeckUpload,
  deleteTestClient,
  registerTestDeck,
  runFullTest,
  saveTestWebsite,
  type TestRunResult,
} from "@/app/admin/test-pilot-actions";
import { createClient } from "@/lib/supabase/client";
import { MATERIALS_BUCKET } from "@/lib/setup";

const primaryButton =
  "inline-flex min-h-[40px] items-center justify-center rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[40px] items-center justify-center rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const inputClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";

export type NextActionTurn =
  | { owner: "admin"; action: string; detail?: string }
  | { owner: "client"; step: string }
  | { owner: "none" };

/** Scrolls to a section and opens it when it is collapsed. */
function goTo(targetId: string) {
  const element = document.getElementById(targetId);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

type TestPilot = {
  website: string;
  deckNames: string[];
  /** Files can no longer be attached once the materials are submitted. */
  materialsSubmitted: boolean;
};

function TestPilotControls({
  clientId,
  clientTurn,
  testPilot,
}: {
  clientId: string;
  clientTurn: boolean;
  testPilot: TestPilot;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [website, setWebsite] = useState(testPilot.website);
  const [pending, setPending] = useState<null | "one" | "all" | "website" | "deck" | "delete">(null);
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(mode: "one" | "all") {
    setPending(mode);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const outcome = await (mode === "one" ? completeClientStep(clientId) : runFullTest(clientId));
      setResult(outcome);
      if (outcome.done.length > 0) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test step failed.");
    } finally {
      setPending(null);
    }
  }

  async function onSaveWebsite() {
    setPending("website");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveTestWebsite(clientId, website);
      if (saved.ok) setNotice("Website saved.");
      else setError(saved.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the website.");
    } finally {
      setPending(null);
    }
  }

  async function onDeck(file: File | undefined) {
    if (!file) return;
    setPending("deck");
    setError(null);
    setNotice(null);
    try {
      const ticket = await createTestDeckUpload(clientId, { name: file.name, size: file.size });
      if (!ticket.ok) {
        setError(ticket.error);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "application/pdf" });
      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        return;
      }
      const saved = await registerTestDeck(clientId, {
        path: ticket.path,
        name: file.name,
        size: file.size,
        type: file.type,
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setNotice(`${saved.file.name} attached to the materials.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this test client, its login, data and files? This cannot be undone.")) {
      return;
    }
    setPending("delete");
    setError(null);
    try {
      const deleted = await deleteTestClient(clientId);
      if (deleted.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      setError(deleted.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the test client.");
    }
    setPending(null);
  }

  const busy = pending !== null;

  return (
    <div className="border-t border-warning/30 bg-background px-lg py-md">
      <div className="flex flex-wrap items-center gap-sm">
        <span className="inline-flex rounded-full border border-warning/40 px-sm py-px text-label uppercase tracking-label text-warning">
          Test pilot
        </span>
        <p className="text-body-sm text-muted">
          Complete the client&apos;s steps from here. Intake and materials are written by AI from the
          website and deck. No emails, no reminders, no invoice.
        </p>
      </div>

      <div className="mt-md flex flex-wrap gap-sm">
        <button
          type="button"
          className={secondaryButton}
          disabled={busy || !clientTurn}
          title={clientTurn ? undefined : "Available when it is the client's turn."}
          onClick={() => void run("one")}
        >
          {pending === "one" ? "Working…" : "Complete as client"}
        </button>
        <button type="button" className={primaryButton} disabled={busy} onClick={() => void run("all")}>
          {pending === "all" ? "Running… (AI steps take 1–2 minutes)" : "Run full test"}
        </button>
        <button
          type="button"
          className="ml-auto inline-flex min-h-[40px] items-center rounded-md px-sm text-body-sm text-error transition-colors duration-hover hover:bg-error/10 disabled:opacity-40"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          {pending === "delete" ? "Deleting…" : "Delete test client"}
        </button>
      </div>

      <div className="mt-md grid gap-md md:grid-cols-2">
        <div>
          <label htmlFor="test-website" className="text-label uppercase tracking-label text-muted">
            Company website
          </label>
          <div className="mt-xs flex gap-sm">
            <input
              id="test-website"
              className={inputClass}
              value={website}
              placeholder="acme.com"
              inputMode="url"
              onChange={(event) => setWebsite(event.target.value)}
            />
            <button
              type="button"
              className={secondaryButton}
              disabled={busy || website.trim() === testPilot.website}
              onClick={() => void onSaveWebsite()}
            >
              Save
            </button>
          </div>
        </div>
        <div>
          <p className="text-label uppercase tracking-label text-muted">Deck (PDF, optional)</p>
          <div className="mt-xs flex flex-wrap items-center gap-sm">
            <span className="min-w-0 flex-1 truncate text-body-sm text-body">
              {testPilot.deckNames.length > 0 ? testPilot.deckNames.join(", ") : "None attached"}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              id="test-deck"
              disabled={busy || testPilot.materialsSubmitted}
              onChange={(event) => void onDeck(event.target.files?.[0])}
            />
            <label
              htmlFor="test-deck"
              className={`${secondaryButton} cursor-pointer ${
                busy || testPilot.materialsSubmitted ? "pointer-events-none opacity-40" : ""
              }`}
            >
              {pending === "deck" ? "Uploading…" : "Upload PDF"}
            </label>
          </div>
        </div>
      </div>

      {result ? (
        <div role="status" className="mt-md rounded-md border border-border bg-surface px-md py-sm text-body-sm">
          {result.done.length > 0 ? (
            <ul className="space-y-xs text-success">
              {result.done.map((item) => (
                <li key={item}>✓ {item}</li>
              ))}
            </ul>
          ) : null}
          <p className={`${result.done.length > 0 ? "mt-sm" : ""} ${result.ok ? "text-heading" : "text-error"}`}>
            {result.ok ? result.stop : result.error}
          </p>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="mt-sm text-body-sm text-success">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Whose turn it is, pinned at the top of the client page. */
export function NextAction({
  clientId,
  turn,
  targetId,
  testPilot,
}: {
  clientId: string;
  turn: NextActionTurn;
  /** The section the "Go to" button opens. */
  targetId: string | null;
  testPilot: TestPilot | null;
}) {
  const label =
    turn.owner === "admin" ? "Your turn" : turn.owner === "client" ? "Waiting on client" : "All complete";
  const tone =
    turn.owner === "admin"
      ? "border-primary/30 bg-primary-tint"
      : "border-border bg-surface";

  return (
    <section
      aria-label="Next action"
      className={`mb-lg overflow-hidden rounded-card border ${tone}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-md px-lg py-md">
        <div className="min-w-0">
          <p
            className={`text-label uppercase tracking-label ${
              turn.owner === "admin" ? "text-primary" : "text-muted"
            }`}
          >
            Next action · {label}
          </p>
          <p className="mt-xs text-h4 text-heading">
            {turn.owner === "admin" ? turn.action : turn.owner === "client" ? turn.step : "Nothing left to do."}
          </p>
          {turn.owner === "admin" && turn.detail ? (
            <p className="mt-xs text-body-sm text-secondary">{turn.detail}</p>
          ) : null}
        </div>
        {targetId ? (
          <button type="button" className={primaryButton} onClick={() => goTo(targetId)}>
            Go to step
          </button>
        ) : null}
      </div>
      {testPilot ? (
        <TestPilotControls clientId={clientId} clientTurn={turn.owner === "client"} testPilot={testPilot} />
      ) : null}
    </section>
  );
}
