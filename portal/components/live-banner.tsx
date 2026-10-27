"use client";

import { useEffect, useState } from "react";

// The green "Live" card the client sees once their campaign is live.
// Colors are fixed on purpose (Dori picked them): pale green card, mint
// border, deep green "Live", blue eyebrow.

function startedText(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  return `Started ${day} at ${time}`;
}

export function LiveBanner({ since, label = "Your investor campaign", children }: { since: string | null; label?: string; children?: React.ReactNode }) {
  // Formatted in the browser, so the time is in the client's own timezone.
  const [started, setStarted] = useState("");
  useEffect(() => {
    setStarted(since ? startedText(since) : "");
  }, [since]);

  return (
    <section className="rounded-[20px] border px-lg py-xl sm:px-xl" style={{ backgroundColor: "#eaf4ee", borderColor: "#a8d2c6" }}>
      <p className="flex items-center gap-sm text-label uppercase tracking-[0.2em]" style={{ color: "#155eef" }}>
        <span aria-hidden="true" className="inline-block h-px w-8" style={{ backgroundColor: "#155eef" }} />
        {label}
      </p>
      <p className="mt-sm text-[64px] font-light leading-none tracking-[-0.03em] sm:text-[88px]" style={{ color: "#0e816c" }}>
        Live
      </p>
      {started ? <p className="mt-md text-body text-heading">{started}</p> : null}
      {children ? <div className="mt-md">{children}</div> : null}
    </section>
  );
}
