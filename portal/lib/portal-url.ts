// Public origin of the client portal. Used for links that go out in emails
// and for the webhook addresses Instantly calls, so set NEXT_PUBLIC_PORTAL_URL
// to the domain clients should see.
//
// The bare heyrupert.com answers with a 308 redirect to www.heyrupert.com, and
// webhook senders (Instantly, Stripe) don't follow redirects, so the bare
// domain is always turned into www here.
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL || "https://www.heyrupert.com")
  .replace(/\/+$/, "")
  .replace(/^https?:\/\/heyrupert\.com$/i, "https://www.heyrupert.com");

export const PORTAL_HOST = PORTAL_URL.replace(/^https?:\/\//, "");
