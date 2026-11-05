"use client";

import { createContext, useContext } from "react";
import { KIND_TEXT, type LandscapeKind } from "@/lib/match/landscape/kind";

/** Which layer the Step 2 screens are showing: the competitors (Step 2) or the companies like you (Step 3). */
export const LandscapeKindContext = createContext<LandscapeKind>("competitors");

export function useLandscapeKind() {
  const kind = useContext(LandscapeKindContext);
  return { kind, T: KIND_TEXT[kind] };
}
