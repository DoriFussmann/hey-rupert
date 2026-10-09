-- Service Order + Setup Fee flow.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- One row per Service Order pushed to a client. At most one active
-- (unarchived) row per client. Signing data is stored on the row.
create table if not exists public.service_order_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content text not null default '',
  payment_link text not null default '',
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

create index if not exists service_order_sends_client_sent_at_idx
  on public.service_order_sends (client_id, sent_at desc);

create unique index if not exists service_order_sends_one_active
  on public.service_order_sends (client_id)
  where archived_at is null;

-- No policies on purpose: only the service role (server code) reads or
-- writes Service Orders.
alter table public.service_order_sends enable row level security;

-- Stripe payment link for the Setup Fee invoice, shown in the client portal.
alter table public.clients
  add column if not exists setup_invoice_url text;

-- The separate "payment" stage no longer exists: the Setup Fee is now paid
-- alongside the Service Order. Move any client still on it.
update public.clients
  set stage = case
    when payment_received_at is not null then 'setup'
    else 'service_order'
  end
  where stage = 'payment';
