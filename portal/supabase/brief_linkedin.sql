-- Founder's LinkedIn for the Company Brief (Oct 30 2026). AI can't read
-- LinkedIn, so Rupert uploads the founder's profile as a PDF (LinkedIn →
-- More → Save to PDF) in the Framing Room; the brief waits for it, or for
-- Rupert to skip it. The client never sees these files.
-- Run once in the Supabase SQL editor. Safe to run again.

create table if not exists public.brief_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- 'linkedin': a founder's LinkedIn PDF. 'linkedin_skipped': Rupert chose to build without one.
  kind text not null check (kind in ('linkedin', 'linkedin_skipped')),
  name text not null default '',
  path text not null default '',
  size integer not null default 0,
  type text not null default '',
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists brief_files_client_idx on public.brief_files (client_id, created_at);
alter table public.brief_files enable row level security;
