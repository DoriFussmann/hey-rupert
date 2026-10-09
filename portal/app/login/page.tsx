"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthBrandPanel } from "@/components/auth-brand-panel";
import { PasswordInput } from "@/components/password-input";
import { getRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

const LOGIN_ERROR = "Incorrect email or password.";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(
    () => searchParams.get("email")?.trim() ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canSubmit = useMemo(
    () => Boolean(email.trim() && password.trim() && !pending),
    [email, password, pending],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setPending(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError || !data.session) {
        setError(LOGIN_ERROR);
        setPending(false);
        return;
      }

      const role = getRole(data.session.access_token);

      if (role === "admin") {
        router.replace("/admin");
        router.refresh();
        return;
      }

      if (role === "client") {
        router.replace("/portal/onboarding");
        router.refresh();
        return;
      }

      setError(LOGIN_ERROR);
      setPending(false);
    } catch {
      setError(LOGIN_ERROR);
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="bp-login">
      <AuthBrandPanel />

      <div className="bp-form-side">
        <div className="bp-card">
          <form className="bp-fields" onSubmit={onSubmit} noValidate>
            <input
              className="bp-input"
              id="login-email"
              name="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <PasswordInput
              id="login-password"
              name="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
            />

            <button className="bp-btn" type="submit" disabled={!canSubmit}>
              {pending ? "Signing in…" : "Continue"}
            </button>

            {error ? <p className="bp-error">{error}</p> : null}
          </form>
        </div>
      </div>
    </main>
  );
}
