// Connecting the client's inbox when Google's sign-in is blocked: the rules
// and the texts, kept pure so they can be tested.
//
// Two ways out, both offered on the Go Live page:
//   1. The company's Google Workspace admin trusts the sending app (2 minutes),
//      then the client signs in with Google as usual.
//   2. A Google app password: works for personal Gmail and when no admin is
//      at hand. It goes straight to the sending platform; Rupert never stores it.

/** The sending platform's name as Google Admin lists it. */
export const SENDING_APP_NAME = "Instantly oAuth Email v1";

export const GOOGLE_ADMIN_URL = "https://admin.google.com/ac/owl/list?tab=configuredApps";
export const GOOGLE_2SV_URL = "https://myaccount.google.com/signinoptions/twosv";
export const GOOGLE_APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";

/** The app's OAuth client ID, read from the Google sign-in address when it carries one. */
export function clientIdFromAuthUrl(authUrl: string | null | undefined): string | null {
  if (!authUrl) return null;
  try {
    const id = new URL(authUrl).searchParams.get("client_id") ?? "";
    return /^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** What the client forwards to their Google Workspace admin. */
export function adminMessage(input: { company: string; clientId: string | null }) {
  const search = input.clientId ? `paste this Client ID and search:\n   ${input.clientId}` : `search for "Instantly"`;
  return [
    "Hi,",
    "",
    `${input.company ? `At ${input.company} we` : "We"} use Hey Rupert to send investor emails from my own inbox. Google blocked the sign-in because our Workspace limits third-party apps. Could you mark the sending app as trusted? It takes about two minutes:`,
    "",
    "1. Open admin.google.com → Security → Access and data control → API controls.",
    '2. Click "Manage App Access" (or "Manage Third-Party App Access").',
    `3. Click "Add app" (or "Configure new app") → "OAuth App Name Or Client ID", and ${search}`,
    `4. Select "${SENDING_APP_NAME}", choose our organization (all users, or my unit), and set access to "Trusted". Save.`,
    "",
    "It can take a few minutes to apply. The app only sends and reads mail for the one inbox I connect.",
    "",
    "Thank you",
  ].join("\n");
}

/** A Google app password is 16 letters, shown in four groups. Returns it without spaces, or null. */
export function cleanAppPassword(raw: string): string | null {
  const clean = raw.replace(/[\s-]/g, "").toLowerCase();
  return /^[a-z]{16}$/.test(clean) ? clean : null;
}

export type AppPasswordInput = { email: string; name: string; password: string };

/** Checks the form. Returns the cleaned values or what to fix. */
export function checkAppPasswordForm(
  input: AppPasswordInput,
): { ok: true; email: string; firstName: string; lastName: string; password: string } | { ok: false; error: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the email address of the inbox." };
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Enter your name as investors should see it." };
  const password = cleanAppPassword(input.password);
  if (!password) {
    return { ok: false, error: "That isn't a Google app password. It is 16 letters, shown as four groups of four. Your normal Google password won't work here." };
  }
  const [firstName, ...rest] = name.split(" ");
  return { ok: true, email, firstName, lastName: rest.join(" ") || firstName, password };
}

/** A plain message for what the sending platform said when the app password was refused. */
export function appPasswordFailure(status: number | undefined, message: string): string {
  const text = message.toLowerCase();
  if (/already|exists|duplicate/.test(text)) return "This inbox is already connected to Rupert's sending account. Tell Rupert and he'll link it.";
  if (status === 400 || status === 401 || status === 403 || status === 422 || /auth|credential|password|login|imap|smtp/.test(text)) {
    return "Google didn't accept that app password for this address. Create a new one and paste it again. If your company manages your Google account, your admin may have turned app passwords off: use the admin steps above instead.";
  }
  return "The inbox couldn't be connected just now. Try again in a minute; Rupert has been told if it keeps failing.";
}
