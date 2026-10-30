"use client";

import { useRef, useState } from "react";
import { createLibraryUploadAction, saveDeckTopicsAction } from "@/app/admin/brief-actions";
import { AutoTextarea } from "@/components/email-body-field";
import { DropSummary } from "@/components/drop-summary";
import { DECK_TOPICS_MAX, type DeckFile, type DeckLink, type DeckTopic } from "@/lib/brief";
import { MATERIALS_BUCKET } from "@/lib/setup";
import { createClient } from "@/lib/supabase/client";

const input = "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const small =
  "rounded-md border border-border bg-surface px-sm py-px text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

/** One topic's preset links and documents. */
function Resources({
  links,
  files,
  fileLinks,
  onLinks,
  onFiles,
}: {
  links: DeckLink[];
  files: DeckFile[];
  fileLinks: Record<string, string>;
  onLinks: (links: DeckLink[]) => void;
  onFiles: (files: DeckFile[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (ref.current) ref.current.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const ticket = await createLibraryUploadAction({ name: file.name, size: file.size });
      if (!ticket.ok) throw new Error(ticket.error);
      const { error: uploadError } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      onFiles([...files, { path: ticket.path, name: file.name.slice(0, 255), size: file.size, type: file.type.slice(0, 120), uploaded_at: new Date().toISOString() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Links start with http:// or https://");
      return;
    }
    onLinks([...links, { id: `l${Date.now().toString(36)}`, label: label.trim(), url: url.trim() }]);
    setLabel("");
    setUrl("");
    setError(null);
  }

  return (
    <div className="mt-sm grid gap-xs text-body-sm">
      <p className="text-label uppercase tracking-label text-muted">Preset Links and Documents (optional)</p>
      {links.map((link) => (
        <div key={link.id} className="flex items-center gap-sm">
          <span className="text-muted">Link</span>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary">
            {link.label || link.url}
          </a>
          <button type="button" className="text-muted hover:text-error" onClick={() => onLinks(links.filter((item) => item.id !== link.id))} aria-label="Remove link">
            ×
          </button>
        </div>
      ))}
      {files.map((file) => (
        <div key={file.path} className="flex items-center gap-sm">
          <span className="text-muted">Document</span>
          {fileLinks[file.path] ? (
            <a href={fileLinks[file.path]} className="min-w-0 truncate text-primary">
              {file.name}
            </a>
          ) : (
            <span className="min-w-0 truncate text-heading">{file.name}</span>
          )}
          <button type="button" className="text-muted hover:text-error" onClick={() => onFiles(files.filter((item) => item.path !== file.path))} aria-label="Remove document">
            ×
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-xs">
        <input className={`${input} w-40`} placeholder="Link label" value={label} onChange={(event) => setLabel(event.target.value)} />
        <input className={`${input} min-w-0 flex-1`} placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
        <button type="button" className={small} disabled={!url.trim() || links.length >= 5} onClick={addLink}>
          + Add Link
        </button>
        <button type="button" className={small} disabled={uploading || files.length >= 5} onClick={() => ref.current?.click()}>
          {uploading ? "Uploading…" : "+ Add Document"}
        </button>
        <input ref={ref} type="file" className="hidden" onChange={(event) => void upload(event.target.files)} />
      </div>
      {error ? <p className="text-error">{error}</p> : null}
    </div>
  );
}

export function FeedbackTopicsEditor({
  initialTopics,
  defaultTopics,
  fileLinks,
}: {
  initialTopics: DeckTopic[];
  defaultTopics: DeckTopic[];
  fileLinks: Record<string, string>;
}) {
  const [topics, setTopics] = useState<DeckTopic[]>(initialTopics);
  const [saved, setSaved] = useState(JSON.stringify(initialTopics));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = JSON.stringify(topics) !== saved;

  function update(index: number, patch: Partial<DeckTopic>) {
    setTopics((current) => current.map((topic, i) => (i === index ? { ...topic, ...patch } : topic)));
  }

  function move(index: number, by: number) {
    setTopics((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveDeckTopicsAction(topics);
      if (!result.ok) setNotice({ kind: "error", text: result.error });
      else {
        setSaved(JSON.stringify(topics));
        setNotice({ kind: "ok", text: "Saved. Rupert uses this list the next time you score feedback." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-md">
      <ol className="grid gap-sm">
        {topics.map((topic, index) => (
          <li key={`${topic.id}-${index}`} className="rounded-card border border-border bg-surface px-lg py-md">
            <div className="flex flex-wrap items-center gap-sm">
              <span className="w-6 text-body-sm text-muted">{index + 1}</span>
              <input className={`${input} max-w-md`} value={topic.title} aria-label="Feedback topic" onChange={(event) => update(index, { title: event.target.value })} />
              <div className="ml-auto flex gap-xs">
                <button type="button" className={secondary} disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className={secondary} disabled={index === topics.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                  ↓
                </button>
                <button type="button" className={secondary} disabled={topics.length <= 3} onClick={() => setTopics((current) => current.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </div>
            </div>
            <details className="group/drop mt-sm">
              <DropSummary>Playbook: what good looks like, references, mistakes, checklist</DropSummary>
              <AutoTextarea
                className={`${input} mt-sm`}
                value={topic.playbook}
                placeholder="What good looks like for this topic, so Rupert scores and writes it well"
                aria-label={`Playbook for ${topic.title}`}
                onChange={(event) => update(index, { playbook: event.target.value })}
              />
            </details>
            <Resources
              links={topic.links ?? []}
              files={topic.files ?? []}
              fileLinks={fileLinks}
              onLinks={(links) => update(index, { links })}
              onFiles={(files) => update(index, { files })}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-sm">
        <button type="button" className={primary} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save Feedback Topics"}
        </button>
        <button
          type="button"
          className={secondary}
          disabled={topics.length >= DECK_TOPICS_MAX}
          onClick={() => setTopics((current) => [...current, { id: "", title: "New topic", playbook: "" }])}
        >
          Add a Topic
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => {
            if (window.confirm("Put back the default list? Your changes, links and documents are replaced when you save.")) setTopics(defaultTopics);
          }}
        >
          Reset to Default
        </button>
        {notice ? <span className={`text-body-sm ${notice.kind === "ok" ? "text-success" : "text-error"}`}>{notice.text}</span> : null}
      </div>
    </div>
  );
}
