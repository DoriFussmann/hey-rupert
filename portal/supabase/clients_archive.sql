alter table public.clients
  add column if not exists archived_at timestamptz;
