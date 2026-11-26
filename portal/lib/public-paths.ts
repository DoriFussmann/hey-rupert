// Paths the middleware lets through without a signed-in session. Each of
// them checks its own secret. Kept pure so a test can hold vercel.json to it:
// a scheduled job whose path is not public is redirected to /login and never
// runs, with nothing to show for it.

export function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/auth/setup" ||
    // Stripe calls this without a session; it verifies Stripe's signature.
    pathname === "/api/stripe/webhook" ||
    // Vercel Cron calls these without a session; every one checks CRON_SECRET.
    pathname.startsWith("/api/cron/") ||
    // Cal.com calls this without a session; it checks CAL_WEBHOOK_SECRET.
    pathname === "/api/cal/webhook" ||
    // Instantly calls this without a session; it checks INSTANTLY_WEBHOOK_SECRET.
    pathname === "/api/instantly/webhook" ||
    // Resend calls this without a session; it checks RESEND_WEBHOOK_SECRET.
    pathname === "/api/resend/webhook" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  );
}
