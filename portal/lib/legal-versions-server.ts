import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  FORM_TITLES,
  LAUNCH_CONFIRMATION_SLUG,
  NDA_SLUG,
  SERVICE_ORDER_SLUG,
  STATEMENT_OF_WORK_SLUG,
  type FormSlug,
} from "@/lib/form-fields";
import {
  LEGAL_NOTE_MAX,
  clientsByVersion,
  stampFor,
  type LegalSend,
  type LegalVersion,
  type VersionClient,
} from "@/lib/legal-versions";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const LEGAL_VERSIONS_MIGRATION_MISSING =
  "Document versions are not set up in the database yet. Run portal/supabase/legal_versions.sql in Supabase.";

function legalError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /legal_save_version|template_version|customized|form_template_versions/.test(message)
  ) {
    return LEGAL_VERSIONS_MIGRATION_MISSING;
  }
  return message;
}

/** Saves the text as the next version and makes it active. The same text again is not a new version. */
export async function saveLegalVersion(
  supabase: ServiceClient,
  slug: FormSlug,
  content: string,
  note: string,
  actor: string | null,
): Promise<Result<{ version: number; unchanged: boolean }>> {
  const { data, error } = await supabase.rpc("legal_save_version", {
    p_slug: slug,
    p_title: FORM_TITLES[slug],
    p_content: content,
    p_note: note.trim().slice(0, LEGAL_NOTE_MAX),
    p_actor: actor,
  });
  if (error) return { ok: false, error: legalError(error.message, error.code) };
  const row = (data ?? {}) as { version?: number; unchanged?: boolean };
  return { ok: true, value: { version: Number(row.version ?? 0), unchanged: row.unchanged === true } };
}

/**
 * The version a document being sent came from, to store on the send. Never
 * blocks a send: with no version history it records nothing.
 */
export async function legalStamp(supabase: ServiceClient, slug: FormSlug, content: string) {
  const { data, error } = await supabase
    .from("form_templates")
    .select("content, active_version")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return {};
  const stamp = stampFor(content, {
    content: data.content != null ? String(data.content) : null,
    active_version: data.active_version != null ? Number(data.active_version) : null,
  });
  return stamp.template_version == null ? {} : stamp;
}

export type LegalHistory = {
  activeVersion: number | null;
  versions: Array<LegalVersion & { clients: VersionClient[] }>;
  /** Clients whose document has no recorded version. */
  unversioned: VersionClient[];
};

type SendRow = {
  client_id: string;
  template_version: number | null;
  customized: boolean | null;
  sent_at: string;
  archived_at: string | null;
  signed_at?: string | null;
};

async function loadSends(supabase: ServiceClient, slug: FormSlug): Promise<Result<SendRow[]>> {
  const columns = "client_id, template_version, customized, sent_at, archived_at";
  const query =
    slug === STATEMENT_OF_WORK_SLUG
      ? supabase.from("statement_of_work_sends").select(columns)
      : slug === SERVICE_ORDER_SLUG
        ? supabase.from("service_order_sends").select(`${columns}, signed_at`)
        : supabase
            .from("signed_documents")
            .select(`${columns}, signed_at`)
            .eq("doc_type", slug === LAUNCH_CONFIRMATION_SLUG ? LAUNCH_CONFIRMATION_SLUG : NDA_SLUG);
  const { data, error } = await query;
  if (error) return { ok: false, error: legalError(error.message, error.code) };
  return { ok: true, value: (data ?? []) as unknown as SendRow[] };
}

/** Every version of a document, newest first, with the clients on each. */
export async function loadLegalHistory(supabase: ServiceClient, slug: FormSlug): Promise<Result<LegalHistory>> {
  const [template, versions, sends, clients] = await Promise.all([
    supabase.from("form_templates").select("active_version").eq("slug", slug).maybeSingle(),
    supabase
      .from("form_template_versions")
      .select("version, content, note, created_at, created_by")
      .eq("slug", slug)
      .order("version", { ascending: false }),
    loadSends(supabase, slug),
    supabase.from("clients").select("id, company_name, sow_confirmed_at, is_test_pilot"),
  ]);
  if (template.error) return { ok: false, error: legalError(template.error.message, template.error.code) };
  if (versions.error) return { ok: false, error: legalError(versions.error.message, versions.error.code) };
  if (!sends.ok) return sends;
  if (clients.error) return { ok: false, error: clients.error.message };

  const clientById = new Map((clients.data ?? []).map((row) => [String(row.id), row]));
  const legalSends: LegalSend[] = [];
  for (const row of sends.value) {
    const client = clientById.get(String(row.client_id));
    if (!client || client.is_test_pilot === true) continue;
    const active = row.archived_at == null;
    legalSends.push({
      client_id: String(row.client_id),
      company_name: String(client.company_name ?? ""),
      template_version: row.template_version != null ? Number(row.template_version) : null,
      customized: row.customized === true,
      sent_at: String(row.sent_at),
      // The Statement of Work is confirmed on the client, not on the send.
      completed_at:
        slug === STATEMENT_OF_WORK_SLUG
          ? active && client.sow_confirmed_at
            ? String(client.sow_confirmed_at)
            : null
          : row.signed_at
            ? String(row.signed_at)
            : null,
      archived_at: row.archived_at != null ? String(row.archived_at) : null,
    });
  }

  const grouped = clientsByVersion(legalSends);
  return {
    ok: true,
    value: {
      activeVersion: template.data?.active_version != null ? Number(template.data.active_version) : null,
      versions: (versions.data ?? []).map((row) => ({
        version: Number(row.version),
        content: String(row.content ?? ""),
        note: String(row.note ?? ""),
        created_at: String(row.created_at),
        created_by: row.created_by != null ? String(row.created_by) : null,
        clients: grouped.get(Number(row.version)) ?? [],
      })),
      unversioned: grouped.get(null) ?? [],
    },
  };
}
