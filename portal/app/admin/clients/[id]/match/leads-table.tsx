"use client";

import { useMemo, useState } from "react";
import { inputClass, n, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { SITE_LABEL, isSectorFocusLine, type FirmRow, type SiteState } from "@/lib/match/shared";
import { VERIFY_LABEL, VERIFY_TONE, type VerifyState } from "@/lib/match/verify";

export type SplitFilter = { kind: "type" | "loc"; value: string } | null;

type ReviewFilter = "open" | "unreviewed" | "approved" | "rejected" | "all";
type Sort = "fit" | "confidence" | "newest" | "name";

const PAGE = 50;

const REVIEW_FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: "open", label: "Not rejected" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "fit", label: "Best fit" },
  { value: "confidence", label: "Most reliable data" },
  { value: "newest", label: "Newest funds" },
  { value: "name", label: "A–Z" },
];

/** A match saved before Email Verification has no state: it reads as not verified. */
function VerifyTag({ state }: { state: VerifyState | undefined }) {
  const value = state ?? "unverified";
  return <p className={`text-label ${VERIFY_TONE[value]}`}>{VERIFY_LABEL[value]}</p>;
}

const BAD_SITES = new Set<SiteState>(["broken", "parked", "inactive", "offtopic"]);

function Pill({ label, value }: { label: string; value: number }) {
  const tone = value >= 1 ? "bg-primary-tint text-primary" : value > 0 ? "bg-background text-warning" : "bg-background text-muted";
  return <span className={`rounded px-xs text-label ${tone}`}>{label}</span>;
}

export function LeadsTable({
  rows,
  split,
  onClearSplit,
  onOpen,
}: {
  rows: FirmRow[];
  split: SplitFilter;
  onClearSplit: () => void;
  onOpen: (firmId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [review, setReview] = useState<ReviewFilter>("open");
  const [sort, setSort] = useState<Sort>("fit");
  const [flagsOnly, setFlagsOnly] = useState(false);
  const [nearOnly, setNearOnly] = useState(false);
  const [site, setSite] = useState<SiteState | "">("");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (split?.kind === "type" && row.type !== split.value) return false;
      if (split?.kind === "loc" && row.loc !== split.value) return false;
      if (review === "open" && row.rejected) return false;
      if (review === "unreviewed" && row.review) return false;
      if (review === "approved" && row.review?.status !== "ok") return false;
      if (review === "rejected" && !row.rejected) return false;
      if (flagsOnly && row.highFlags.length === 0) return false;
      if (nearOnly && row.near === 0) return false;
      if (site && row.site !== site) return false;
      if (q && !`${row.name} ${row.hq} ${row.primary?.name ?? ""} ${row.backup?.name ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    if (sort === "fit") return list;
    const sorted = [...list];
    if (sort === "confidence") sorted.sort((a, b) => b.confValue - a.confValue || b.score - a.score);
    if (sort === "newest") sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.score - a.score);
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [rows, split, review, flagsOnly, nearOnly, site, query, sort]);

  const people = filtered.reduce((sum, row) => sum + row.people, 0);
  const siteOptions = Array.from(new Set(rows.map((row) => row.site).filter(Boolean))) as SiteState[];

  return (
    <div>
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-sm px-lg py-md text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-h4 text-heading">
          Leads · {n(filtered.length)} funds · {n(people)} investing contacts
        </span>
        <span className="text-body-sm text-primary">{open ? "Hide" : "Show"}</span>
      </button>
      {split ? (
        <p className="px-lg pb-sm text-body-sm">
          <span className="rounded-full bg-primary-tint px-sm py-px text-primary">
            {split.kind === "type" ? "Type" : "HQ"}: {split.value}
            <button type="button" className="ml-xs" aria-label="Clear filter" onClick={onClearSplit}>
              ×
            </button>
          </span>
        </p>
      ) : null}

      {open ? (
        <>
          <div className="grid gap-sm border-t border-border px-lg py-md sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="search"
              aria-label="Search funds, cities or people"
              placeholder="Search fund, city or person"
              className={inputClass}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShown(PAGE);
              }}
            />
            <select aria-label="Review status" className={inputClass} value={review} onChange={(event) => setReview(event.target.value as ReviewFilter)}>
              {REVIEW_FILTERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select aria-label="Sort" className={inputClass} value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {SORTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select aria-label="Website status" className={inputClass} value={site} onChange={(event) => setSite(event.target.value as SiteState | "")}>
              <option value="">Any website status</option>
              {siteOptions.map((value) => (
                <option key={value} value={value}>
                  {SITE_LABEL[value]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-xs text-body-sm">
              <input type="checkbox" checked={nearOnly} onChange={(event) => setNearOnly(event.target.checked)} />
              Team near client
            </label>
            <label className="flex items-center gap-xs text-body-sm">
              <input type="checkbox" checked={flagsOnly} onChange={(event) => setFlagsOnly(event.target.checked)} />
              Red flags only
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="border-t border-border px-lg py-md text-body-sm text-muted">No funds match these filters.</p>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[900px] text-left text-body-sm">
                <thead className="bg-background">
                  <tr className="text-label uppercase tracking-label text-muted">
                    <th className="px-lg py-sm font-medium">Fund</th>
                    <th className="px-md py-sm font-medium">Fit</th>
                    <th className="px-md py-sm font-medium">Why</th>
                    <th className="px-md py-sm font-medium">Approach first</th>
                    <th className="px-md py-sm font-medium">Then</th>
                    <th className="px-md py-sm font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-t border-border align-top hover:bg-background ${row.rejected ? "opacity-50" : ""}`}
                      onClick={() => onOpen(row.id)}
                    >
                      <td className="px-lg py-sm">
                        <button
                          type="button"
                          className="text-left text-heading hover:text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(row.id);
                          }}
                        >
                          {row.name}
                        </button>
                        {row.web ? (
                          <a
                            href={row.web}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-sm text-body-sm text-primary hover:text-primary-hover"
                            aria-label={`Open ${row.name} website in a new tab`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Website ↗
                          </a>
                        ) : null}
                        <p className="text-muted">
                          {row.type} · {row.hq || row.loc}
                          {row.year ? ` · est. ${row.year}` : ""} · {n(row.people)} contact{row.people === 1 ? "" : "s"}
                        </p>
                        {row.overflow ? <p className="text-primary">Wave 2</p> : null}
                        {row.site ? (
                          <p className={BAD_SITES.has(row.site) ? "text-error" : "text-muted"}>{SITE_LABEL[row.site]}</p>
                        ) : null}
                        {row.highFlags.slice(0, 2).map((flag) => (
                          <p key={flag} className="text-error">
                            ⚑ {flag}
                          </p>
                        ))}
                      </td>
                      <td className="px-md py-sm">
                        <p className="font-mono text-heading">{row.score}</p>
                        <p className="mt-px flex gap-xs">
                          <Pill label="Stage" value={row.stage} />
                          <Pill label="Sector" value={row.sector} />
                          <Pill label="Geo" value={row.geo} />
                        </p>
                        <p className="mt-px text-label uppercase tracking-label text-muted">{row.conf} data</p>
                      </td>
                      <td className="min-w-[14rem] px-md py-sm text-secondary">
                        {row.pros.filter((pro) => !isSectorFocusLine(pro)).map((pro) => (
                          <p key={pro}>+ {pro}</p>
                        ))}
                        {row.con ? <p className="text-warning">− {row.con}</p> : null}
                      </td>
                      <td className="px-md py-sm">
                        {row.primary ? (
                          <>
                            <p className="text-heading">{row.primary.name}</p>
                            <p className="text-muted">{row.primary.title}</p>
                            <VerifyTag state={row.primary.verify} />
                          </>
                        ) : (
                          <p className="text-muted">No reachable contact</p>
                        )}
                      </td>
                      <td className="px-md py-sm">
                        {row.backup ? (
                          <>
                            <p className="text-heading">{row.backup.name}</p>
                            <p className="text-muted">{row.backup.title}</p>
                            <VerifyTag state={row.backup.verify} />
                          </>
                        ) : (
                          <p className="text-muted">—</p>
                        )}
                      </td>
                      <td className="px-md py-sm">
                        {row.review?.status === "ok" ? (
                          <span className="text-success">✓ Approved</span>
                        ) : row.review?.status === "no" ? (
                          <span className="text-error">✕ {row.review.reason}</span>
                        ) : (
                          <span className="text-muted">Open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > shown ? (
            <div className="border-t border-border px-lg py-md">
              <button type="button" className={smallButton} onClick={() => setShown((value) => value + PAGE)}>
                Show more ({n(filtered.length - shown)} left)
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
