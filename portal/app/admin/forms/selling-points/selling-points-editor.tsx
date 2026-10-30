"use client";

import { useState } from "react";
import { saveSellingPointsListAction } from "@/app/admin/brief-actions";
import { AutoTextarea } from "@/components/email-body-field";
import { SELLING_POINTS_MAX, type SellingPoint } from "@/lib/brief";

const input = "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

export function SellingPointsEditor({ initialPoints, defaultPoints }: { initialPoints: SellingPoint[]; defaultPoints: SellingPoint[] }) {
  const [points, setPoints] = useState<SellingPoint[]>(initialPoints);
  const [saved, setSaved] = useState(JSON.stringify(initialPoints));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = JSON.stringify(points) !== saved;

  function update(index: number, patch: Partial<SellingPoint>) {
    setPoints((current) => current.map((point, i) => (i === index ? { ...point, ...patch } : point)));
  }

  function move(index: number, by: number) {
    setPoints((current) => {
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
      const result = await saveSellingPointsListAction(points);
      if (!result.ok) setNotice({ kind: "error", text: result.error });
      else {
        setSaved(JSON.stringify(points));
        setNotice({ kind: "ok", text: "Saved. Rupert uses this list the next time you score." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-md">
      <ol className="grid gap-sm">
        {points.map((point, index) => (
          <li key={`${point.id}-${index}`} className="rounded-card border border-border bg-surface px-lg py-md">
            <div className="flex flex-wrap items-center gap-sm">
              <span className="w-6 text-body-sm text-muted">{index + 1}</span>
              <input className={`${input} max-w-md`} value={point.title} aria-label="Selling point" onChange={(event) => update(index, { title: event.target.value })} />
              <div className="ml-auto flex gap-xs">
                <button type="button" className={secondary} disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className={secondary} disabled={index === points.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                  ↓
                </button>
                <button type="button" className={secondary} disabled={points.length <= 3} onClick={() => setPoints((current) => current.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </div>
            </div>
            <AutoTextarea
              className={`${input} mt-sm`}
              value={point.guidance}
              placeholder="What this point means, so Rupert scores it well"
              aria-label={`Guidance for ${point.title}`}
              onChange={(event) => update(index, { guidance: event.target.value })}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-sm">
        <button type="button" className={primary} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save selling points"}
        </button>
        <button
          type="button"
          className={secondary}
          disabled={points.length >= SELLING_POINTS_MAX}
          onClick={() => setPoints((current) => [...current, { id: "", title: "New selling point", guidance: "" }])}
        >
          Add a point
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => {
            if (window.confirm("Put back the default ten? Your changes are replaced when you save.")) setPoints(defaultPoints);
          }}
        >
          Reset to default
        </button>
        {notice ? <span className={`text-body-sm ${notice.kind === "ok" ? "text-success" : "text-error"}`}>{notice.text}</span> : null}
      </div>
    </div>
  );
}
