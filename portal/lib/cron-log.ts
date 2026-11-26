import "server-only";
import { createServiceClient } from "@/lib/supabase/admin";

// Every scheduled job records that it ran: a row when it starts, completed
// when it ends. Without it, a job that never fires looks the same as one
// with nothing to do. Read by the admin and by the nightly summary.

type ServiceClient = ReturnType<typeof createServiceClient>;

const clip = (value: unknown) => {
  try {
    const text = JSON.stringify(value);
    return text.length > 4000 ? { clipped: text.slice(0, 4000) } : (value ?? null);
  } catch {
    return null;
  }
};

/** Runs a scheduled job with a service client and logs it in cron_runs. Logging never stops the job. */
export async function cronLogged<T>(job: string, run: (supabase: ServiceClient) => Promise<T>): Promise<T> {
  const supabase = createServiceClient();
  let id: string | null = null;
  try {
    const { data } = await supabase.from("cron_runs").insert({ job }).select("id").maybeSingle();
    id = data?.id ? String(data.id) : null;
  } catch {
    id = null;
  }
  const finish = async (ok: boolean, detail: unknown) => {
    if (!id) return;
    try {
      await supabase.from("cron_runs").update({ finished_at: new Date().toISOString(), ok, detail: clip(detail) }).eq("id", id);
    } catch {
      // The job's own result still goes back to the caller.
    }
  };
  try {
    const result = await run(supabase);
    await finish(true, result);
    return result;
  } catch (error) {
    await finish(false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
