import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isServiceRoleConfigured } from "@/lib/env";

export function createServiceClient() {
  if (!isServiceRoleConfigured()) {
    throw new Error(
      "Supabase service role is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
