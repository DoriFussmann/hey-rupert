-- A live campaign paused for a US federal holiday (runHolidayGuard in
-- lib/outreach/live-server.ts, cron /api/cron/holidays). Set when the
-- campaign is paused that morning, cleared when it starts again. Kept apart
-- from paused_at, Rupert's own pause. Safe to run more than once.
alter table public.outreach_campaigns add column if not exists holiday_paused_at timestamptz;
comment on column public.outreach_campaigns.holiday_paused_at is 'Paused for a US federal holiday; cleared on the next Business Day.';
