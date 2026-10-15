// Types for the website checker (site-check.mjs, used as-is).
import type { SiteResult } from "../engine/index.mjs";

export function checkSite(
  firm: { id: string; web: string },
  options?: { timeoutMs?: number },
): Promise<SiteResult>;
