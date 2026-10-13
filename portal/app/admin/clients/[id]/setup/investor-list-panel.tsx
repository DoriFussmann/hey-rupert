"use client";

import { useMemo, useRef, useState } from "react";
import {
  FIT_TIERS,
  INVESTOR_CSV_TEMPLATE,
  asInvestorList,
  parseInvestorCsv,
  tierCounts,
  type InvestorListPayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";

const CSV_MAX_BYTES = 5 * 1024 * 1024;

export function InvestorListPanel({
  clientId,
  item,
  row,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => {
    const draft = asInvestorList(row?.draft);
    return draft.rows.length > 0 ? draft : asInvestorList(row?.published);
  }, [row]);

  const [list, setList] = useState<InvestorListPayload>(initial);
  const [savedKey, setSavedKey] = useState(JSON.stringify(initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const counts = tierCounts(list.rows);
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(INVESTOR_CSV_TEMPLATE)}`;

  async function loadFile(file: File) {
    setErrors([]);
    setWarnings([]);
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setErrors(["Upload a .csv file. In Excel or Google Sheets: File → Download → CSV."]);
      return;
    }
    if (file.size > CSV_MAX_BYTES) {
      setErrors(["That file is over 5 MB. Is it the right one?"]);
      return;
    }
    const parsed = parseInvestorCsv(await file.text());
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setWarnings(parsed.warnings);
    setList({ rows: parsed.rows, source_file: file.name });
  }

  return (
    <StepFrame
      item={item}
      intro="Upload the matched investors as a CSV with: Fund Name, Fund Point of Contact, General Details, Fit Level (Tier 1, 2 or 3), Why It Works, Comments. Check the preview, then push. The client can add a note on any fund, ask questions, or confirm."
    >
      <ClientAnswer row={row} />

      <div className="px-lg py-md">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload the investor CSV: drop it here or press Enter to browse"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void loadFile(file);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-lg py-lg text-center transition-colors duration-hover ${
            dragging ? "border-primary bg-primary-tint" : "border-border bg-background hover:border-primary/50"
          }`}
        >
          <p className="text-body-sm text-heading">
            {list.rows.length > 0
              ? `Replace the list: drop a new CSV or browse`
              : "Drop the investor CSV here, or browse"}
          </p>
          <p className="mt-xs text-body-sm text-muted">
            {list.source_file
              ? `Current: ${list.source_file} · ${list.rows.length} funds`
              : "No list uploaded yet"}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.tsv,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = "";
          }}
        />
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          <a href={templateHref} download="investor-list-template.csv" className={secondaryButton}>
            Download CSV template
          </a>
          {list.rows.length > 0 ? (
            <p className="text-body-sm text-muted">
              {counts.map(({ tier, count }) => `Tier ${tier}: ${count}`).join(" · ")}
            </p>
          ) : null}
        </div>

        {errors.length > 0 ? (
          <div role="alert" className="mt-md rounded-md border border-error/40 bg-background px-md py-sm">
            <p className="text-body-sm text-error">The CSV was not loaded:</p>
            <ul className="mt-xs list-disc pl-md text-body-sm text-error">
              {errors.slice(0, 12).map((error) => (
                <li key={error}>{error}</li>
              ))}
              {errors.length > 12 ? <li>…and {errors.length - 12} more.</li> : null}
            </ul>
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="mt-md list-disc pl-md text-body-sm text-warning">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {list.rows.length > 0 ? (
        <div className="max-h-[520px] overflow-auto border-t border-border">
          <table className="w-full min-w-[860px] text-left text-body-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Tier</th>
                <th className="px-md py-sm font-medium">Fund</th>
                <th className="px-md py-sm font-medium">Point of contact</th>
                <th className="px-md py-sm font-medium">Details</th>
                <th className="px-md py-sm font-medium">Why it works</th>
                <th className="px-md py-sm font-medium">Comments</th>
              </tr>
            </thead>
            <tbody>
              {FIT_TIERS.flatMap(({ tier }) =>
                list.rows
                  .filter((entry) => entry.tier === tier)
                  .map((entry) => (
                    <tr key={entry.id} className="border-b border-border align-top last:border-b-0">
                      <td className="px-lg py-sm text-primary">T{entry.tier}</td>
                      <td className="px-md py-sm text-heading">{entry.fund_name}</td>
                      <td className="px-md py-sm">{entry.contact}</td>
                      <td className="px-md py-sm text-muted">{entry.details}</td>
                      <td className="px-md py-sm">{entry.why}</td>
                      <td className="px-md py-sm text-muted">{entry.comments}</td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <EarlierRounds row={row} />
      <PublishBar
        clientId={clientId}
        step="investor_list"
        item={item}
        row={row}
        draft={list}
        dirty={JSON.stringify(list) !== savedKey}
        onSaved={() => setSavedKey(JSON.stringify(list))}
        pushLabel="Push list for confirmation"
        problem={list.rows.length === 0 ? "Upload the investor CSV before pushing." : null}
      />
    </StepFrame>
  );
}
