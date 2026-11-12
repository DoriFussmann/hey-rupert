"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DealsDeck, DeckCell, DeckPill, DeckSlide } from "@/lib/match/deals/core";
import s from "./deals-deck.module.css";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

// Save to PDF is the browser's print: while the deck is open, printing the
// page prints the slides, one per 16:9 page, and nothing else.
const PRINT_CSS = `@page { size: ${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; min-height: 0 !important; background: #f3f1eb !important; }
  body > *:not([data-deals-print]) { display: none !important; }
}`;

const pillClass: Record<DeckPill, string> = { mint: s.mint, grey: s.grey, orange: s.orange };

function CellView({ cell, first, strong }: { cell: DeckCell | undefined; first: boolean; strong: boolean }) {
  if (cell === undefined || cell === "") return null;
  const c = typeof cell === "string" ? { text: cell } : cell;
  if ("pill" in c && c.pill) return <span className={`${s.pill} ${pillClass[c.pill]}`}>{c.text}</span>;
  return (
    <span className={first ? s.company : "muted" in c && c.muted ? s.muted : strong ? s.strong : undefined}>
      {c.text}
      {"tag" in c && c.tag ? <span className={s.tag}>{c.tag}</span> : null}
      {"sub" in c && c.sub ? <span className={s.sub}>{c.sub}</span> : null}
    </span>
  );
}

function SlideBody({ slide }: { slide: DeckSlide }) {
  if (slide.kind === "table") {
    return (
      <div className={`${s.card} ${s.tableCard}`}>
        <table className={s.table}>
          <thead>
            <tr>
              {slide.columns.map((c) => (
                <th key={c.key} className={c.align === "right" ? s.right : undefined} style={c.width ? { width: `${c.width}%` } : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slide.rows.map((row, i) => (
              <tr key={i}>
                {slide.columns.map((c, j) => (
                  <td key={c.key} className={c.align === "right" ? s.right : undefined}>
                    <CellView cell={row[c.key]} first={j === 0} strong={Boolean(c.strong)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // The wider group gets the wider column.
  const weights = slide.groups.map((g) => Math.max(1, Math.max(...g.rows.map((r) => r.investors.length))));
  const columns = weights.map((w) => `${Math.min(1.5, Math.max(1, w / Math.min(...weights)))}fr`).join(" ");
  return (
    <>
      {slide.stats.length ? (
        <div className={s.stats}>
          {slide.stats.map((stat, i) => (
            <div key={i} className={`${s.card} ${s.stat} ${stat.highlight ? s.statHighlight : ""}`}>
              <div className={s.statValue}>{stat.value}</div>
              <div className={s.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className={s.groups} style={{ gridTemplateColumns: columns }}>
        {slide.groups.map((group, gi) => (
          <div key={gi} className={`${s.card} ${s.group}`}>
            <div className={s.groupTitle}>{group.title}</div>
            {group.rows.map((row, ri) => (
              <div key={ri} className={s.groupRow}>
                <div className={s.groupCompany}>{row.company}</div>
                <div className={s.groupInvestors}>
                  {row.investors.map((inv, ii) => (
                    <span key={ii} className={`${s.pill} ${pillClass[inv.tone ?? group.tone]}`}>
                      {inv.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {slide.legend && gi === slide.groups.length - 1 ? (
              <div className={s.legend}>
                {slide.legend.map((l, li) => (
                  <span key={li}>
                    <span className={`${s.pill} ${pillClass[l.tone]}`}>Investor</span>
                    {l.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Slide({ slide, page, deck, company, scale }: { slide: DeckSlide; page: number; deck: DealsDeck; company: string; scale?: number }) {
  return (
    <section className={s.slide} style={scale === undefined ? undefined : { transform: `scale(${scale})` }} aria-label={slide.title}>
      {slide.eyebrow ? <div className={s.eyebrow}>{slide.eyebrow}</div> : null}
      <h3 className={s.title}>{slide.title}</h3>
      {slide.subtitle ? <p className={s.subtitle}>{slide.subtitle}</p> : null}
      <SlideBody slide={slide} />
      {slide.note ? (
        <div className={`${s.note} ${slide.note.tone === "mint" ? s.noteMint : s.noteNavy}`}>
          <div className={s.noteLabel}>{slide.note.label}</div>
          <div>{slide.note.text}</div>
        </div>
      ) : null}
      <div className={s.footer}>
        <span>{["Rupert", `${deck.title} for ${company}`, slide.footer].filter(Boolean).join(" · ")}</span>
        <span>{page}</span>
      </div>
    </section>
  );
}

const barButton =
  "inline-flex min-h-[36px] items-center justify-center rounded-md border border-border bg-surface px-sm py-[3px] text-body-sm text-secondary transition-colors duration-hover hover:text-heading";

function DeckModal({ deck, company, onClose }: { deck: DealsDeck; company: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const count = deck.slides.length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(count - 1, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, count]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / SLIDE_WIDTH);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const savePdf = useCallback(() => {
    // The browser names the PDF after the page title.
    const title = document.title;
    document.title = `${company} - ${deck.title}`;
    const restore = () => {
      document.title = title;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }, [company, deck.title]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/60 p-sm sm:p-md" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={deck.title}
        className="w-full rounded-card border border-border bg-surface p-sm shadow-lg"
        // As wide as fits with the whole 16:9 slide (and the bar above it) on screen.
        style={{ maxWidth: `min(${SLIDE_WIDTH}px, calc((100vh - 120px) * 16 / 9))` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-sm flex flex-wrap items-center justify-between gap-sm">
          <div className="flex flex-wrap items-center gap-xs" role="tablist" aria-label="Slides">
            {deck.slides.map((slide, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={`inline-flex min-h-[36px] items-center rounded-md px-sm py-[3px] text-body-sm transition-colors duration-hover ${
                  i === index ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
                }`}
                onClick={() => setIndex(i)}
              >
                {slide.tab}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-xs">
            <button type="button" className={barButton} onClick={savePdf}>
              Save to PDF
            </button>
            <button type="button" className={barButton} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div ref={stage} className={s.stage} role="tabpanel">
          {scale > 0 ? <Slide slide={deck.slides[index]} page={index + 1} deck={deck} company={company} scale={scale} /> : null}
        </div>
      </div>
      {createPortal(
        <div data-deals-print className={s.print} aria-hidden="true">
          <style>{PRINT_CSS}</style>
          {deck.slides.map((slide, i) => (
            <Slide key={i} slide={slide} page={i + 1} deck={deck} company={company} />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * The button at the bottom of the client's Investor Matching page, and the
 * 16:9 viewer it opens: one slide at a time, with Save to PDF.
 */
export function DealsDeckButton({ deck, company }: { deck: DealsDeck; company: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <section className="flex flex-wrap items-center justify-between gap-md rounded-card border border-border bg-surface px-md py-md">
      <p className="max-w-prose text-body-sm text-secondary">
        Who raised what in your market, and which of their investors are on your list. {deck.slides.length === 1 ? "One slide" : `${deck.slides.length} slides`} you can save as a PDF.
      </p>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {deck.title}
      </button>
      {open ? <DeckModal deck={deck} company={company} onClose={close} /> : null}
    </section>
  );
}
