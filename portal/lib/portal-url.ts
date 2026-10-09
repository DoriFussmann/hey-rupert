// Public origin of the client portal. Used for links that go out in emails, so
// set NEXT_PUBLIC_PORTAL_URL to the domain clients should see.
export const PORTAL_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL || "https://heyrupert.com"
).replace(/\/+$/, "");

export const PORTAL_HOST = PORTAL_URL.replace(/^https?:\/\//, "");
