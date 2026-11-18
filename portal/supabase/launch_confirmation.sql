-- Launch Confirmation: the agreement a client confirms as the last step of Go
-- Live (lib/outreach/live-server.ts, requestLaunch). The confirmed text is
-- kept in signed_documents with the version it came from; the postal address
-- that goes into every campaign email is kept on the client.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs signed_documents.sql and legal_versions.sql.

alter table public.signed_documents
  drop constraint if exists signed_documents_doc_type_check;
alter table public.signed_documents
  add constraint signed_documents_doc_type_check
  check (doc_type in ('nda', 'launch_confirmation'));

alter table public.clients
  add column if not exists postal_address text;
