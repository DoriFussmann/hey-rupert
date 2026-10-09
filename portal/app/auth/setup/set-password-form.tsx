"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { completePasswordSetup } from "@/app/auth/setup/actions";
import { SetupUnavailable } from "@/app/auth/setup/setup-unavailable";
import { PasswordInput } from "@/components/password-input";
import {
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
} from "@/lib/password-policy";

export function SetPasswordForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canSubmit = Boolean(password && confirm && !pending);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await completePasswordSetup(token, password, confirm);

      if (!result.ok) {
        if (result.unavailable) {
          setUnavailable(result.error);
        } else {
          setError(result.error);
        }
        setPending(false);
        return;
      }

      router.replace(result.redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  if (unavailable) return <SetupUnavailable message={unavailable} />;

  return (
    <form className="bp-fields" onSubmit={onSubmit} noValidate>
      <h1 className="bp-card__title">Set your password</h1>

      <input
        className="bp-input"
        id="setup-email"
        name="email"
        type="email"
        aria-label="Email"
        autoComplete="username"
        readOnly
        value={email}
      />

      <PasswordInput
        id="setup-password"
        name="password"
        placeholder="New password"
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={setPassword}
      />

      <PasswordInput
        id="setup-confirm"
        name="confirm"
        placeholder="Confirm password"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
      />

      <p className="bp-text">At least {MIN_PASSWORD_LENGTH} characters.</p>

      <button className="bp-btn" type="submit" disabled={!canSubmit}>
        {pending ? "Saving…" : "Set password"}
      </button>

      {error ? (
        <p className="bp-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
