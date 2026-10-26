"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { asOutreachStyles, asStylePreset, PRESET_ID_PATTERN, type OutreachStyles } from "@/lib/outreach/copy";
import {
  OUTREACH_SETTINGS_TABLE_MISSING,
  OUTREACH_STYLES_KEY,
  outreachTableError,
} from "@/lib/outreach/settings-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const STYLES_PATH = "/admin/forms/outreach-styles";

/** Problems that stop the styles from being saved. */
function stylesProblems(raw: unknown): string[] {
  const problems: string[] = [];
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const presets = Array.isArray(value.presets) ? value.presets : [];
  if (presets.length === 0) problems.push("Keep at least one style.");
  if (presets.length > 20) problems.push("Keep it to 20 styles.");
  const ids = new Set<string>();
  presets.forEach((item, index) => {
    const preset = asStylePreset(item);
    const id = String((item as Record<string, unknown> | null)?.id ?? "");
    if (!preset) {
      problems.push(
        PRESET_ID_PATTERN.test(id)
          ? `Style ${index + 1} needs a name.`
          : `Style ${index + 1} needs an id of lowercase letters, numbers, - or _.`,
      );
      return;
    }
    if (ids.has(preset.id)) problems.push(`Two styles share the id "${preset.id}".`);
    ids.add(preset.id);
    if (!preset.rules) problems.push(`"${preset.label}" needs rules.`);
  });
  return problems;
}

export async function saveOutreachStyles(raw: unknown): Promise<Result<{ styles: OutreachStyles }>> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };

  const problems = stylesProblems(raw);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  const styles = asOutreachStyles(raw);

  const { error } = await createServiceClient()
    .from("outreach_settings")
    .upsert(
      { key: OUTREACH_STYLES_KEY, value: styles, updated_by: user.email ?? null, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    return { ok: false, error: outreachTableError(error.message, error.code) ? OUTREACH_SETTINGS_TABLE_MISSING : error.message };
  }
  revalidatePath(STYLES_PATH);
  return { ok: true, styles };
}
