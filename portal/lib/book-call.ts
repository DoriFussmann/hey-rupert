/** Rupert's 15-minute call (Cal.com), booked from the client portal. */
export const BOOK_CALL_URL = "https://cal.com/team-rupert-2zxrkh/15min";

export type BookCallClient = {
  founder_name?: string | null;
  first_name?: string | null;
  email?: string | null;
  founder_email?: string | null;
  company_name?: string | null;
};

const clean = (value: string | null | undefined) => (value ?? "").trim();

/**
 * The booking link with the client's details filled in, using Cal.com's
 * standard prefill parameters: name, email and notes (the company).
 * Without a client, the plain link.
 */
export function bookCallHref(client: BookCallClient | null | undefined, base = BOOK_CALL_URL) {
  if (!client) return base;
  const url = new URL(base);
  const name = clean(client.founder_name) || clean(client.first_name);
  const email = clean(client.email) || clean(client.founder_email);
  const company = clean(client.company_name);
  if (name) url.searchParams.set("name", name);
  if (email) url.searchParams.set("email", email);
  if (company) url.searchParams.set("notes", `Company: ${company}`);
  return url.toString();
}
