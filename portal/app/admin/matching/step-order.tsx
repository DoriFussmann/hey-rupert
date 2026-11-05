"use client";

import { createContext, useContext, useEffect } from "react";

/** Each step tells the page when it has loaded, so the steps appear in order (Step 1 first) rather than as each one's data arrives. */
export const StepReady = createContext<(ready: boolean) => void>(() => {});

export function useStepReady(ready: boolean) {
  const report = useContext(StepReady);
  useEffect(() => {
    report(ready);
  }, [report, ready]);
}
