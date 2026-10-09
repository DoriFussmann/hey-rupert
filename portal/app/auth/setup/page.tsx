import type { Metadata } from "next";
import { SetPasswordForm } from "@/app/auth/setup/set-password-form";
import { SetupUnavailable } from "@/app/auth/setup/setup-unavailable";
import { AuthBrandPanel } from "@/components/auth-brand-panel";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import { SETUP_LINK_UNAVAILABLE_MESSAGE } from "@/lib/password-policy";
import { findActiveSetup } from "@/lib/password-setup";
import { roleFromUser } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/admin";
import "@/app/login/login.css";

export const metadata: Metadata = {
  title: "Set your password",
  robots: "noindex, nofollow",
  // The token is in the URL; never send it to other sites.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

type SetupState =
  | { kind: "ready"; email: string }
  | { kind: "unavailable"; message: string };

const NOT_AVAILABLE_ERROR =
  "This page isn't available right now. Please try again later, or contact Dori.";

// Rendering only looks the token up; it is consumed when the form is
// submitted, so link scanners that open the page don't use it up.
async function loadSetup(token: string): Promise<SetupState> {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return { kind: "unavailable", message: NOT_AVAILABLE_ERROR };
  }

  const supabase = createServiceClient();
  const lookup = await findActiveSetup(supabase, token);
  if (!lookup.ok) return { kind: "unavailable", message: NOT_AVAILABLE_ERROR };
  if (!lookup.clientId) {
    return { kind: "unavailable", message: SETUP_LINK_UNAVAILABLE_MESSAGE };
  }

  const { data, error } = await supabase.auth.admin.getUserById(
    lookup.clientId,
  );
  const user = data?.user;
  if (error || !user?.email || roleFromUser(user) !== "client") {
    return { kind: "unavailable", message: SETUP_LINK_UNAVAILABLE_MESSAGE };
  }

  return { kind: "ready", email: user.email };
}

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string | string[] };
}) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const state = await loadSetup(token);

  return (
    <main id="main-content" className="bp-login">
      <AuthBrandPanel />

      <div className="bp-form-side">
        <div className="bp-card">
          {state.kind === "ready" ? (
            <SetPasswordForm token={token} email={state.email} />
          ) : (
            <SetupUnavailable message={state.message} />
          )}
        </div>
      </div>
    </main>
  );
}
