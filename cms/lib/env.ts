import fs from "node:fs";
import path from "node:path";
import { CMS_ROOT } from "./paths.ts";

/** Load cms/.env into process.env without overwriting existing values. */
export function loadCmsEnv(): void {
  const envPath = path.join(CMS_ROOT, ".env");
  let raw = "";
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function pagespeedConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim());
}

export function searchConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_LOGIN?.trim() &&
      process.env.DATAFORSEO_PASSWORD?.trim(),
  );
}
