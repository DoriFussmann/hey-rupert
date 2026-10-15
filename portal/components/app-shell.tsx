"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/chevron";
import { SignOutButton } from "@/components/sign-out-button";

const STORAGE_KEY = "hey-rupert-nav-collapsed";

export function AppShell({
  brand,
  eyebrow,
  navigation,
  children,
}: {
  brand: string;
  eyebrow: string;
  navigation: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-container lg:flex">
      <aside
        className={`flex w-full flex-col border-b border-border bg-surface px-md py-lg lg:border-b-0 lg:border-r lg:px-md ${
          collapsed ? "lg:w-16" : "lg:w-60"
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show menu" : "Hide menu"}
          title={collapsed ? "Show menu" : "Hide menu"}
          className={`mb-md flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-secondary transition-colors duration-hover hover:border-primary hover:text-primary ${
            collapsed ? "self-center" : "self-end"
          }`}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-hover ${
              collapsed ? "-rotate-90" : "rotate-90"
            }`}
          />
        </button>
        {collapsed ? (
          <div className="px-sm lg:mt-auto">
            <SignOutButton />
          </div>
        ) : (
          <>
            <p className="px-sm text-label uppercase tracking-label text-muted">{eyebrow}</p>
            <p className="mt-xs px-sm font-light text-h4 tracking-headline text-heading">{brand}</p>
            <div className="mt-xl flex-1">{navigation}</div>
            <div className="mt-lg px-sm">
              <SignOutButton />
            </div>
          </>
        )}
      </aside>
      <main className="min-w-0 flex-1 px-md py-lg lg:px-xl lg:py-xl">
        <div className="mx-auto w-full max-w-container">{children}</div>
      </main>
    </div>
  );
}
