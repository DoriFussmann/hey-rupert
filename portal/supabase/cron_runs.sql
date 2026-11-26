-- One row per run of a scheduled job (lib/cron-log.ts): started when the job
-- is called, completed when it ends. Shows which jobs really fire.
-- Safe to run more than once.
create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb
);
create index if not exists cron_runs_job_started on public.cron_runs (job, started_at desc);
alter table public.cron_runs enable row level security;
