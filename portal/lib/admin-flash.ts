"use client";

import { useEffect, useSyncExternalStore } from "react";

export type AdminFlash = {
  kind: "ok" | "error";
  text: string;
  at: number;
} | null;

type FlashStore = {
  flashes: Map<string, AdminFlash>;
  listeners: Set<() => void>;
};

function getStore(): FlashStore {
  const globalRef = globalThis as typeof globalThis & {
    __rupertAdminFlash?: FlashStore;
  };

  if (!globalRef.__rupertAdminFlash) {
    globalRef.__rupertAdminFlash = {
      flashes: new Map(),
      listeners: new Set(),
    };
  }

  return globalRef.__rupertAdminFlash;
}

function emit() {
  getStore().listeners.forEach((listener) => listener());
}

export function setAdminFlash(
  key: string,
  flash: { kind: "ok" | "error"; text: string } | null,
) {
  getStore().flashes.set(key, flash ? { ...flash, at: Date.now() } : null);
  emit();
}

function subscribe(listener: () => void) {
  const { listeners } = getStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAdminFlash(key: string) {
  const flash = useSyncExternalStore(
    subscribe,
    () => getStore().flashes.get(key) ?? null,
    () => null,
  );

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setAdminFlash(key, null), 4000);
    return () => window.clearTimeout(timer);
  }, [key, flash]);

  return flash;
}
