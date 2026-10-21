// The test client (the Test Pilot): a pretend company for trying the whole
// flow, from matching to its own test portal, without a real client or any
// email. Pure module (no server code).

export const SANDBOX_COMPANY_NAME = "Test Pilot (sandbox)";

export const SANDBOX_MIGRATION_MISSING =
  "The test client is not set up in the database yet. Run portal/supabase/match_sandbox.sql in Supabase.";
