create table if not exists public.statement_of_work_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content text not null default '',
  sent_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists statement_of_work_sends_client_sent_at_idx
  on public.statement_of_work_sends (client_id, sent_at desc);

create unique index if not exists statement_of_work_sends_one_active
  on public.statement_of_work_sends (client_id)
  where archived_at is null;

alter table public.statement_of_work_sends enable row level security;
