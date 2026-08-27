"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="bp-panel" aria-hidden="true">
        <div className="bp-panel__lighting"></div>
        <div className="bp-panel__grid"></div>

        <div className="bp-panel__middle">
          <h1 className="bp-panel__title">Rupert</h1>
          <p className="bp-panel__subcopy">
            Investor outreach, managed for you.
          </p>
        </div>

        <p className="bp-panel__footer">
          Human-led. Tailor-made. Fully transparent.
        </p>
      </div>

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

            <span className="bp-password">
              <input
                className="bp-input bp-password__input"
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="bp-password__toggle"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg
                  className="bp-eye bp-eye--show"
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ display: showPassword ? "none" : undefined }}
                >
                  <path d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12s-4 7.5-10.5 7.5S1.5 12 1.5 12Z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg
                  className="bp-eye bp-eye--hide"
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ display: showPassword ? undefined : "none" }}
                >
                  <path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M6.6 6.7C4 8.4 2.3 11 1.5 12c0 0 4 7.5 10.5 7.5 2 0 3.7-.5 5.1-1.3M17.5 17.4c2.4-1.7 4-4.4 5-5.4 0 0-1.6-3-4.9-5.3M12 4.5c.6 0 1.2.05 1.8.15"></path>
                </svg>
              </button>
            </span>

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
