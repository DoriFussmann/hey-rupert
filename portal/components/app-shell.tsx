"use client";

import { useEffect, useState, type ReactNode } from "react";
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
          className="mb-md self-start rounded-md px-sm py-xs text-body-sm text-secondary hover:bg-background hover:text-heading"
        >
          {collapsed ? "Show menu" : "Hide menu"}
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
