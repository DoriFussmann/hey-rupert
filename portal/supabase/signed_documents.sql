-- Signable documents beyond the Service Order (NDA now; more later).
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- One row per document pushed to a client. At most one active (unarchived)
-- row per client and document type. Signing data is stored on the row.
create table if not exists public.signed_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  doc_type text not null check (doc_type in ('nda')),
  content text not null default '',
  sent_at timestamptz not null default now(),
  archived_at timestamptz,
  signed_at timestamptz,
  signer_company text,
  signer_name text,
  signer_email text,
  signer_title text,
  signed_content text,
  signed_ip text,
  signed_user_agent text
);

create index if not exists signed_documents_client_type_sent_at_idx
  on public.signed_documents (client_id, doc_type, sent_at desc);

create unique index if not exists signed_documents_one_active
  on public.signed_documents (client_id, doc_type)
  where archived_at is null;

-- No policies on purpose: only the service role (server code) reads or
-- writes these documents.
alter table public.signed_documents enable row level security;

-- When the current NDA was pushed to the client (null = not issued).
alter table public.clients
  add column if not exists nda_sent_at timestamptz;
