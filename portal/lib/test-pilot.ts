// Test pilot: shared constants and rules. Pure module (server and browser).

export const TEST_PILOT_MIGRATION_MISSING =
  "The test pilot columns are missing. Run portal/supabase/test_pilot.sql in the Supabase SQL editor, then try again.";

/** True when a database error is about a column added by test_pilot.sql. */
export function isTestPilotColumnError(message: string) {
  return /is_test_pilot|stripe_invoice_id|company_website|client_checks/.test(message);
}

/**
 * Placeholder login for a test pilot client added without an email. The
 * example.com domain is reserved, so nothing can ever be delivered there.
 */
export function testPilotEmail(id: string) {
  return `test-pilot+${id}@example.com`;
}

/** Signer used when a test pilot "client" signs the Service Order or NDA. */
export function testSigner(client: {
  company_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
}) {
  const name = [client.first_name, client.last_name]
    .map((part) => (part != null ? String(part).trim() : ""))
    .filter(Boolean)
    .join(" ");
  return {
    company_name: String(client.company_name ?? "").trim() || "Test company",
    signer_name: name || "Test Pilot",
    signer_email: String(client.email ?? "").trim() || "test-pilot@example.com",
    signer_title: "CEO (test pilot)",
  };
}
