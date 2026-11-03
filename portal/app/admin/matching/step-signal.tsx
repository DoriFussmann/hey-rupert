"use client";

import { createContext, useContext } from "react";

/** Tells later steps that an earlier one was confirmed or reopened, so they load again. */
export const StepSignal = createContext<() => void>(() => {});

export function useStepSignal() {
  return useContext(StepSignal);
}
