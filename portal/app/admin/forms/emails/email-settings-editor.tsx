"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "@/components/chevron";
import { useRouter } from "next/navigation";
import {
  saveEmailSignature,
  saveEmailTemplate,
  saveReminderTimings,
  sendTemplateTest,
} from "@/app/admin/email-actions";
import {
  EMAIL_TEMPLATES,
  REMINDER_LIMITS,
  REMINDER_STEPS,
  TOKEN_HELP,
  asReminderTiming,
  renderEmail,
  sampleValues,
  type EmailSettings,
  type EmailTemplateDefinition,
  type EmailTemplateGroup,
  type EmailTemplateSetting,
  type ReminderTiming,
  type ReminderTurnKey,
} from "@/lib/email-templates";
import { PORTAL_URL } from "@/lib/portal-url";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm text-body outline-none focus:border-primary";
const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Message = { kind: "ok" | "error"; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.kind === "error" ? "alert" : "status"}
      className={`text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
    >
      {message.text}
    </p>
  );
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// ---------------------------------------------------------------------------

function SignatureCard({
  value,
  onChange,
  saved,
}: {
  value: string;
  onChange: (value: string) => void;
  saved: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const result = await saveEmailSignature(value);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: "Signature saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-lg">
      <h2 className="text-h4">Signature</h2>
      <p className="mt-xs text-body-sm text-muted">
        Added wherever an email uses {"{signature}"}, and at the end of emails
        you send from a client page.
      </p>
      <label className="mt-md block text-label uppercase tracking-label text-muted">
        Sign-off
        <textarea
          className={`${fieldClass} min-h-[88px] resize-y`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || value.trim() === saved}
          className={primaryButton}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <Feedback message={message} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function TemplateCard({
  definition,
  setting,
  signature,
}: {
  definition: EmailTemplateDefinition;
  setting: EmailTemplateSetting;
  signature: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(setting.enabled);
  const [subject, setSubject] = useState(setting.subject);
  const [body, setBody] = useState(setting.body);
  const [pending, setPending] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const dirty =
    enabled !== setting.enabled ||
    subject !== setting.subject ||
    body !== setting.body;
  const isDefault =
    subject === definition.subject && body === definition.body;

  const preview = useMemo(
    () =>
      renderEmail(
        { subject, body },
        sampleValues(definition, { portalUrl: PORTAL_URL, signature }),
      ),
    [subject, body, definition, signature],
  );

  async function onSave() {
    setPending("save");
    setMessage(null);
    try {
      const result = await saveEmailTemplate(definition.key, {
        enabled,
        subject,
        body,
      });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(null);
    }
  }

  async function onTest() {
    setPending("test");
    setMessage(null);
    try {
      const result = await sendTemplateTest(definition.key, {
        subject,
        body,
        signature,
      });
      setMessage(
        result.ok
          ? { kind: "ok", text: "Test sent to your inbox, with sample details." }
          : { kind: "error", text: result.reason },
      );
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to send.") });
    } finally {
      setPending(null);
    }
  }

  function onRestoreDefault() {
    if (isDefault) return;
    if (
      !window.confirm(
        `Replace the wording with the default "${definition.title}" email? Nothing is saved until you click Save.`,
      )
    ) {
      return;
    }
    setSubject(definition.subject);
    setBody(definition.body);
    setMessage({ kind: "ok", text: "Default restored. Click Save to keep it." });
  }

  return (
    <details className="group/email rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden flex-wrap items-center justify-between gap-sm px-lg py-md">
        <span className="flex items-center gap-sm">
          <ChevronDown className="h-4 w-4 -rotate-90 text-muted transition-transform duration-hover group-open/email:rotate-0" />
          <span className="text-body-sm text-heading">{definition.title}</span>
        </span>
        <span className="flex items-center gap-sm text-label uppercase tracking-label">
          {setting.customized ? <span className="text-muted">Edited</span> : null}
          {definition.switchable ? (
            <span className={setting.enabled ? "text-success" : "text-error"}>
              {setting.enabled ? "On" : "Off"}
            </span>
          ) : null}
        </span>
      </summary>

      <div className="space-y-md border-t border-border px-lg py-lg">
        <p className="text-body-sm text-muted">{definition.trigger}</p>

        {definition.switchable ? (
          <label className="flex items-center gap-sm text-body-sm text-heading">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Send this email
          </label>
        ) : null}

        <label className="block text-label uppercase tracking-label text-muted">
          Subject
          <input
            type="text"
            className={fieldClass}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>

        <label className="block text-label uppercase tracking-label text-muted">
          Email
          <textarea
            className={`${fieldClass} min-h-[220px] resize-y`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck
          />
        </label>

        <div>
          <p className="text-label uppercase tracking-label text-muted">
            Fill-ins
          </p>
          <dl className="mt-sm grid gap-x-md gap-y-xs text-body-sm sm:grid-cols-[auto_1fr]">
            {definition.tokens.map((token) => (
              <div key={token} className="contents">
                <dt className="font-mono text-mono text-heading">{`{${token}}`}</dt>
                <dd className="text-muted">{TOKEN_HELP[token]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <p className="text-label uppercase tracking-label text-muted">
            Preview · sample details
          </p>
          <div className="mt-sm rounded-md border border-border bg-background p-md text-body-sm">
            <p className="text-heading">{preview.subject}</p>
            <p className="mt-sm whitespace-pre-wrap break-words text-body">
              {preview.body}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={onSave}
            disabled={pending !== null || !dirty}
            className={primaryButton}
          >
            {pending === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onRestoreDefault}
            disabled={pending !== null || isDefault}
            className={secondaryButton}
          >
            Restore default
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={pending !== null}
            className={secondaryButton}
          >
            {pending === "test" ? "Sending…" : "Send me a test"}
          </button>
          <Feedback message={message} />
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------

/** The same clamping the server applies, so the form shows what was saved. */
function clampTimings(values: Record<ReminderTurnKey, ReminderTiming>) {
  const next = { ...values };
  for (const step of REMINDER_STEPS) {
    next[step.key] = asReminderTiming(values[step.key], step.defaults);
  }
  return next;
}

function RemindersCard({
  timings,
}: {
  timings: Record<ReminderTurnKey, ReminderTiming>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(timings);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const dirty = JSON.stringify(values) !== JSON.stringify(timings);

  function update(key: ReminderTurnKey, patch: Partial<ReminderTiming>) {
    setValues((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function numberField(
    key: ReminderTurnKey,
    field: "first_after_days" | "every_days" | "max_reminders",
    label: string,
  ) {
    const limits = REMINDER_LIMITS[field];
    return (
      <input
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        step={1}
        aria-label={label}
        value={values[key][field]}
        disabled={!values[key].enabled}
        onChange={(event) =>
          update(key, { [field]: Number(event.target.value) })
        }
        className="w-20 rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body outline-none focus:border-primary disabled:opacity-40"
      />
    );
  }

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const result = await saveReminderTimings(values);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setValues(clampTimings(values));
      setMessage({ kind: "ok", text: "Reminder schedule saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h3 className="text-h4">Reminder schedule</h3>
        <p className="mt-xs text-body-sm text-muted">
          While a step waits on the client: the first reminder is due after
          the set number of days, then repeats until the maximum. Due
          reminders wait under Notify &amp; Nudge → Ready to send; nothing goes out until
          you click Send. With &quot;Alert me&quot; on, you get a stalled
          alert once they run out. Checked once a day.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Step</th>
              <th className="px-md py-sm font-medium">On</th>
              <th className="px-md py-sm font-medium">First after (days)</th>
              <th className="px-md py-sm font-medium">Then every (days)</th>
              <th className="px-md py-sm font-medium">Max</th>
              <th className="px-md py-sm font-medium">Alert me</th>
            </tr>
          </thead>
          <tbody>
            {REMINDER_STEPS.map((step) => (
              <tr key={step.key} className="border-b border-border last:border-b-0">
                <td className="px-lg py-sm text-heading">{step.label}</td>
                <td className="px-md py-sm">
                  <input
                    type="checkbox"
                    aria-label={`Remind for ${step.label}`}
                    checked={values[step.key].enabled}
                    onChange={(event) =>
                      update(step.key, { enabled: event.target.checked })
                    }
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td className="px-md py-sm">
                  {numberField(step.key, "first_after_days", `${step.label}: first reminder after days`)}
                </td>
                <td className="px-md py-sm">
                  {numberField(step.key, "every_days", `${step.label}: repeat every days`)}
                </td>
                <td className="px-md py-sm">
                  {numberField(step.key, "max_reminders", `${step.label}: maximum reminders`)}
                </td>
                <td className="px-md py-sm">
                  <input
                    type="checkbox"
                    aria-label={`${step.label}: alert me when reminders run out`}
                    checked={values[step.key].stall_alert}
                    disabled={!values[step.key].enabled}
                    onChange={(event) =>
                      update(step.key, { stall_alert: event.target.checked })
                    }
                    className="h-4 w-4 accent-primary disabled:opacity-40"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-sm border-t border-border px-lg py-md">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          className={primaryButton}
        >
          {pending ? "Saving…" : "Save schedule"}
        </button>
        <Feedback message={message} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const GROUPS: { group: EmailTemplateGroup; title: string; description: string }[] = [
  {
    group: "client",
    title: "Emails to clients",
    description: "Sent when a step becomes the client's turn.",
  },
  {
    group: "admin",
    title: "Emails to you",
    description:
      "Sent when a client acts. Your in-app Notifications record every event either way.",
  },
  {
    group: "reminder",
    title: "Reminders",
    description:
      "Nudges while a step waits on the client. Paused clients get none.",
  },
];

export function EmailSettingsEditor({ settings }: { settings: EmailSettings }) {
  const [signature, setSignature] = useState(settings.signature);
  const previewSignature = signature.trim() || settings.signature;

  return (
    <div className="space-y-xl">
      <SignatureCard
        value={signature}
        onChange={setSignature}
        saved={settings.signature}
      />
      {GROUPS.map(({ group, title, description }) => (
        <section key={group} id={`emails-${group}`} className="scroll-mt-lg">
          <h2 className="text-h3">{title}</h2>
          <p className="mt-xs text-body-sm text-muted">{description}</p>
          <div className="mt-md space-y-sm">
            {group === "reminder" ? <RemindersCard timings={settings.timings} /> : null}
            {EMAIL_TEMPLATES.filter((template) => template.group === group).map(
              (template) => (
                <TemplateCard
                  key={template.key}
                  definition={template}
                  setting={settings.templates[template.key]}
                  signature={previewSignature}
                />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
