-- The Desk: one record per client of everything they send Rupert and every
-- answer he gives. Three tables:
--   desk_items     one row per thing asked, sent or shared
--   desk_messages  the back-and-forth under an item; never edited or deleted
--   desk_notes     Rupert's internal notes on an item; never visible to a client
--
-- Run once in the Supabase SQL editor before deploying the Desk. Safe to
-- re-run. Then run desk_backfill.sql to give current clients their past record.

-- ---------------------------------------------------------------------------
-- Items

create table if not exists public.desk_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null
    check (type in ('question', 'feedback', 'materials', 'request', 'shared_asset', 'update')),
  -- The setup step it belongs to, or 'general'.
  step text not null default 'general'
    check (step in ('general', 'materials', 'framing', 'investor_list', 'email_copy', 'campaign')),
  -- Where it came from: the Desk itself, a step's review panel, a materials
  -- upload, or something said outside the portal and logged by Rupert.
  source text not null default 'desk'
    check (source in ('desk', 'step', 'materials', 'email', 'call', 'message', 'meeting')),
  -- The link back to where it came from (a portal path), when there is one.
  source_href text
    check (source_href is null or (source_href like '/portal%' and char_length(source_href) <= 300)),
  -- Stable key of the event that created it (a step version, a question id),
  -- so an automatic item or a backfilled one is never created twice.
  source_ref text check (source_ref is null or char_length(source_ref) <= 200),
  -- Who opened it. An email Rupert logs for the client is opened by 'client'.
  opened_by text not null check (opened_by in ('client', 'admin')),
  -- Who it is waiting on.
  status text not null check (status in ('waiting_us', 'waiting_client', 'closed')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- When it happened (an email's own date for logged and backfilled items)…
  occurred_at timestamptz not null default now(),
  -- …and when it was entered.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint desk_items_source_ref_key unique (client_id, source_ref)
);

create index if not exists desk_items_client_idx
  on public.desk_items (client_id, last_message_at desc);
-- The cross-client inbox: open items waiting on Rupert, oldest first.
create index if not exists desk_items_waiting_us_idx
  on public.desk_items (last_message_at)
  where status = 'waiting_us';

-- ---------------------------------------------------------------------------
-- Messages

create table if not exists public.desk_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.desk_items(id) on delete cascade,
  -- Repeated from the item so the access rule below reads one column.
  client_id uuid not null references public.clients(id) on delete cascade,
  author text not null check (author in ('client', 'admin', 'system')),
  -- The author's name as it was when they wrote it.
  author_name text not null default '' check (char_length(author_name) <= 200),
  body text not null default '' check (char_length(body) <= 20000),
  -- [{ kind: 'file', path, name, size, type } | { kind: 'link', url, label }],
  -- each optionally a shared asset: { asset: { title, version } }.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  -- Set when this message closed or reopened the item (its body is the note).
  event text check (event in ('closed', 'reopened')),
  -- Rupert's login, when he logged this for the client (an email, a call).
  logged_by text check (logged_by is null or char_length(logged_by) <= 200),
  -- When it happened, and when it was entered.
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Stable key of the event that wrote it (see desk_items.source_ref).
  source_ref text check (source_ref is null or char_length(source_ref) <= 200),
  constraint desk_messages_source_ref_key unique (item_id, source_ref),
  constraint desk_messages_not_empty
    check (event is not null or char_length(btrim(body)) > 0 or jsonb_array_length(attachments) > 0)
);

create index if not exists desk_messages_item_idx
  on public.desk_messages (item_id, occurred_at, created_at);
create index if not exists desk_messages_client_idx
  on public.desk_messages (client_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Internal notes (their own table, so no rule on messages can ever show them)

create table if not exists public.desk_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.desk_items(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  -- Rupert's login.
  author text check (author is null or char_length(author) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists desk_notes_item_idx on public.desk_notes (item_id, created_at);

-- ---------------------------------------------------------------------------
-- The record stands: messages can't be changed or removed, and an item can't
-- be removed or moved to another client. This holds for every role, the
-- server's service role included. The one exception is deleting the client
-- itself, which takes its Desk with it.

create or replace function public.desk_messages_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Reached through the client being deleted (directly, or through its item).
    if not exists (select 1 from public.clients where id = old.client_id)
       or not exists (select 1 from public.desk_items where id = old.item_id) then
      return old;
    end if;
    raise exception 'Desk messages cannot be deleted.' using errcode = '42501';
  end if;
  raise exception 'Desk messages cannot be changed.' using errcode = '42501';
end;
$$;

drop trigger if exists desk_messages_immutable on public.desk_messages;
create trigger desk_messages_immutable
  before update or delete on public.desk_messages
  for each row execute function public.desk_messages_immutable();

create or replace function public.desk_no_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The Desk record cannot be truncated.' using errcode = '42501';
end;
$$;

drop trigger if exists desk_messages_no_truncate on public.desk_messages;
create trigger desk_messages_no_truncate
  before truncate on public.desk_messages
  for each statement execute function public.desk_no_truncate();

drop trigger if exists desk_items_no_truncate on public.desk_items;
create trigger desk_items_no_truncate
  before truncate on public.desk_items
  for each statement execute function public.desk_no_truncate();

create or replace function public.desk_items_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Reached through the client being deleted.
    if not exists (select 1 from public.clients where id = old.client_id) then
      return old;
    end if;
    raise exception 'Desk items cannot be deleted. Close the item instead.' using errcode = '42501';
  end if;
  -- What an item is and where it came from never change; its status,
  -- title and timestamps do.
  if new.client_id is distinct from old.client_id
     or new.type is distinct from old.type
     or new.opened_by is distinct from old.opened_by
     or new.source is distinct from old.source
     or new.source_ref is distinct from old.source_ref
     or new.occurred_at is distinct from old.occurred_at
     or new.created_at is distinct from old.created_at then
    raise exception 'That part of a Desk item cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists desk_items_guard on public.desk_items;
create trigger desk_items_guard
  before update or delete on public.desk_items
  for each row execute function public.desk_items_guard();

-- A message always belongs to its item's client.
create or replace function public.desk_child_client_matches()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.desk_items where id = new.item_id and client_id = new.client_id
  ) then
    raise exception 'The item belongs to another client.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists desk_messages_client_matches on public.desk_messages;
create trigger desk_messages_client_matches
  before insert on public.desk_messages
  for each row execute function public.desk_child_client_matches();

drop trigger if exists desk_notes_client_matches on public.desk_notes;
create trigger desk_notes_client_matches
  before insert on public.desk_notes
  for each row execute function public.desk_child_client_matches();

-- ---------------------------------------------------------------------------
-- Access (row-level security)
--
-- A signed-in client reads their own items and messages. A view-only viewer
-- reads those of the client they were added to. An admin reads everything.
-- Nobody writes through the API: the portal's server code does (service
-- role), after checking who is asking.

create or replace function public.desk_can_read(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() = p_client_id
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    or exists (
      select 1
      from public.client_viewers v
      where v.id = auth.uid()
        and v.client_id = p_client_id
    );
$$;

revoke all on function public.desk_can_read(uuid) from public, anon;
grant execute on function public.desk_can_read(uuid) to authenticated, service_role;

alter table public.desk_items enable row level security;
alter table public.desk_messages enable row level security;
alter table public.desk_notes enable row level security;

drop policy if exists desk_items_read on public.desk_items;
create policy desk_items_read on public.desk_items
  for select to authenticated
  using (public.desk_can_read(client_id));

drop policy if exists desk_messages_read on public.desk_messages;
create policy desk_messages_read on public.desk_messages
  for select to authenticated
  using (public.desk_can_read(client_id));

-- No INSERT, UPDATE or DELETE policy on any of the three tables, and no
-- policy at all on desk_notes: it is read and written by the server only.
revoke all on public.desk_items from anon, authenticated;
revoke all on public.desk_messages from anon, authenticated;
revoke all on public.desk_notes from anon, authenticated;
grant select on public.desk_items to authenticated;
grant select on public.desk_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Writing (server only)
--
-- An item is opened together with its first message, and a message is posted
-- together with the item's new status, so the two never disagree. Both take
-- an optional source_ref: the same event recorded twice changes nothing.

create or replace function public.desk_open_item(
  p_client_id uuid,
  p_type text,
  p_step text,
  p_source text,
  p_source_href text,
  p_source_ref text,
  p_opened_by text,
  p_status text,
  p_title text,
  p_occurred_at timestamptz,
  p_author text,
  p_author_name text,
  p_body text,
  p_attachments jsonb,
  p_logged_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_source_ref is not null then
    select id into v_id
    from public.desk_items
    where client_id = p_client_id and source_ref = p_source_ref;
    if found then
      return jsonb_build_object('id', v_id, 'created', false);
    end if;
  end if;

  insert into public.desk_items (
    client_id, type, step, source, source_href, source_ref, opened_by, status,
    title, occurred_at, last_message_at, closed_at
  )
  values (
    p_client_id, p_type, coalesce(p_step, 'general'), coalesce(p_source, 'desk'),
    p_source_href, p_source_ref, p_opened_by, p_status,
    btrim(p_title), v_at, v_at,
    case when p_status = 'closed' then v_at end
  )
  on conflict on constraint desk_items_source_ref_key do nothing
  returning id into v_id;

  -- The same event arrived twice at once: the other one opened it.
  if v_id is null then
    select id into v_id
    from public.desk_items
    where client_id = p_client_id and source_ref = p_source_ref;
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  insert into public.desk_messages (
    item_id, client_id, author, author_name, body, attachments, logged_by, occurred_at
  )
  values (
    v_id, p_client_id, p_author, coalesce(p_author_name, ''), coalesce(p_body, ''),
    coalesce(p_attachments, '[]'::jsonb), p_logged_by, v_at
  );

  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;

create or replace function public.desk_post_message(
  p_item_id uuid,
  p_author text,
  p_author_name text,
  p_body text,
  p_attachments jsonb,
  p_event text,
  p_logged_by text,
  p_occurred_at timestamptz,
  -- The item's status after this message; null keeps it.
  p_status text,
  p_source_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.desk_items%rowtype;
  v_id uuid;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_status text;
begin
  -- One writer at a time per item.
  select * into v_item from public.desk_items where id = p_item_id for update;
  if not found then
    raise exception 'That item is not on the Desk.' using errcode = 'P0002';
  end if;

  if p_source_ref is not null then
    select id into v_id
    from public.desk_messages
    where item_id = p_item_id and source_ref = p_source_ref;
    if found then
      return jsonb_build_object('id', v_id, 'created', false, 'status', v_item.status);
    end if;
  end if;

  v_status := coalesce(p_status, v_item.status);

  insert into public.desk_messages (
    item_id, client_id, author, author_name, body, attachments, event,
    logged_by, occurred_at, source_ref
  )
  values (
    p_item_id, v_item.client_id, p_author, coalesce(p_author_name, ''), coalesce(p_body, ''),
    coalesce(p_attachments, '[]'::jsonb), p_event, p_logged_by, v_at, p_source_ref
  )
  returning id into v_id;

  update public.desk_items
     set status = v_status,
         closed_at = case
           when v_status <> 'closed' then null
           when v_item.status = 'closed' then v_item.closed_at
           else now()
         end,
         last_message_at = greatest(last_message_at, v_at),
         updated_at = now()
   where id = p_item_id;

  return jsonb_build_object('id', v_id, 'created', true, 'status', v_status);
end;
$$;

revoke all on function public.desk_open_item(
  uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.desk_open_item(
  uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, jsonb, text
) to service_role;

revoke all on function public.desk_post_message(
  uuid, text, text, text, jsonb, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.desk_post_message(
  uuid, text, text, text, jsonb, text, text, timestamptz, text, text
) to service_role;

-- Files attached on the Desk live in the private client-materials bucket,
-- under <client id>/desk/. Like company materials, they are uploaded with
-- one-time signed URLs and downloaded with short-lived signed links, both
-- issued by the server, so no storage policies are needed.
