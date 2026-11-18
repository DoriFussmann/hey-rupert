-- Legal document versions: the Statement of Work, Service Order, NDA and
-- Launch Confirmation keep every saved version in form_template_versions (the
-- table the AI prompts already use). form_templates holds the active version's
-- text, and active_version says which one it is.
--
-- Saving goes through legal_save_version(): it adds the next version and makes
-- it active in one step. Versions can't be changed or deleted.
--
-- Each document sent to a client records the version it came from
-- (template_version) and whether its text was changed for that client
-- (customized), so the admin can list the clients on each version.
--
-- At the end, the history so far is rebuilt from what was sent. Run once in
-- the Supabase SQL editor before deploying. Safe to run again.

-- A Service Order is longer than a prompt.
alter table public.form_template_versions
  drop constraint if exists form_template_versions_content_check;
alter table public.form_template_versions
  add constraint form_template_versions_content_check
  check (length(btrim(content)) between 1 and 60000);

alter table public.statement_of_work_sends
  add column if not exists template_version integer,
  add column if not exists customized boolean not null default false;

alter table public.service_order_sends
  add column if not exists template_version integer,
  add column if not exists customized boolean not null default false;

alter table public.signed_documents
  add column if not exists template_version integer,
  add column if not exists customized boolean not null default false;

create or replace function public.legal_save_version(
  p_slug text,
  p_title text,
  p_content text,
  p_note text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text := btrim(coalesce(p_content, ''));
  v_version integer;
  v_active integer;
  v_current text;
begin
  if p_slug is null
     or p_slug not in ('statement_of_work', 'service_order', 'nda', 'launch_confirmation') then
    raise exception 'Not a legal document: %', p_slug;
  end if;
  if v_content = '' then
    raise exception 'The document cannot be empty.';
  end if;
  if length(v_content) > 60000 then
    raise exception 'Keep the document under 60000 characters.';
  end if;

  insert into public.form_templates (slug, title, content, updated_at)
  values (p_slug, coalesce(nullif(btrim(p_title), ''), p_slug), '', now())
  on conflict (slug) do nothing;
  -- One save at a time per document.
  select active_version, btrim(coalesce(content, ''))
    into v_active, v_current
  from public.form_templates
  where slug = p_slug
  for update;

  -- Saving the same text again is not a new version.
  if v_active is not null and v_current = v_content then
    return jsonb_build_object('version', v_active, 'unchanged', true);
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.form_template_versions
  where slug = p_slug;

  insert into public.form_template_versions (slug, version, content, note, created_by)
  values (p_slug, v_version, v_content, left(btrim(coalesce(p_note, '')), 300), p_actor);

  update public.form_templates
  set content = v_content,
      active_version = v_version,
      title = coalesce(nullif(btrim(p_title), ''), title),
      updated_at = now()
  where slug = p_slug;

  return jsonb_build_object('version', v_version, 'unchanged', false);
end;
$$;

revoke all on function public.legal_save_version(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.legal_save_version(text, text, text, text, text) to service_role;

-- History so far, rebuilt from what was sent. A text sent to one client only
-- because its terms were negotiated (custom fees, a negotiated NDA) is not a
-- version: that send is marked customized and belongs to the version in use
-- at the time. Skipped for a document that already has versions.
do $$
declare
  v_slug text;
  v_row record;
  v_version integer;
begin
  insert into public.form_templates (slug, title, content, updated_at)
  values ('nda', 'NDA', '', now())
  on conflict (slug) do nothing;

  create temporary table legal_sent on commit drop as
    select 'statement_of_work'::text as slug, s.id, btrim(s.content) as content, s.sent_at
    from public.statement_of_work_sends s
    union all
    select 'service_order', s.id, btrim(s.content), s.sent_at
    from public.service_order_sends s
    union all
    select 'nda', s.id, btrim(s.content), s.sent_at
    from public.signed_documents s
    where s.doc_type = 'nda';

  foreach v_slug in array array['statement_of_work', 'service_order', 'nda'] loop
    if exists (select 1 from public.form_template_versions where slug = v_slug) then
      continue;
    end if;

    v_version := 0;
    -- A version is a text that reached two or more clients, or the first text
    -- ever sent, or the text in the template today.
    for v_row in
      select t.content, min(t.sent_at) as first_sent
      from legal_sent t
      where t.slug = v_slug and t.content <> ''
      group by t.content
      having count(*) >= 2
         or min(t.sent_at) = (select min(sent_at) from legal_sent where slug = v_slug)
         or t.content = (select btrim(content) from public.form_templates where slug = v_slug)
      order by min(t.sent_at)
    loop
      v_version := v_version + 1;
      insert into public.form_template_versions (slug, version, content, note, created_by, created_at)
      values (v_slug, v_version, v_row.content, 'From the documents already sent.', 'history', v_row.first_sent);
    end loop;

    if v_version > 0 then
      update public.form_templates f
      set active_version = v.version,
          content = v.content
      from public.form_template_versions v
      where f.slug = v_slug
        and v.slug = v_slug
        and v.version = v_version
        and (btrim(coalesce(f.content, '')) = '' or btrim(f.content) = v.content);
    end if;
  end loop;

  -- Which version each send came from: an exact match, otherwise the newest
  -- version that existed when it was sent, marked customized.
  update public.statement_of_work_sends s
  set template_version = m.version, customized = m.customized
  from (
    select t.id,
      coalesce(
        (select v.version from public.form_template_versions v where v.slug = t.slug and v.content = t.content),
        (select max(v.version) from public.form_template_versions v where v.slug = t.slug and v.created_at <= t.sent_at)
      ) as version,
      not exists (select 1 from public.form_template_versions v where v.slug = t.slug and v.content = t.content) as customized
    from legal_sent t where t.slug = 'statement_of_work'
  ) m
  where s.id = m.id and s.template_version is null and m.version is not null;

  update public.service_order_sends s
  set template_version = m.version, customized = m.customized
  from (
    select t.id,
      coalesce(
        (select v.version from public.form_template_versions v where v.slug = t.slug and v.content = t.content),
        (select max(v.version) from public.form_template_versions v where v.slug = t.slug and v.created_at <= t.sent_at)
      ) as version,
      not exists (select 1 from public.form_template_versions v where v.slug = t.slug and v.content = t.content) as customized
    from legal_sent t where t.slug = 'service_order'
  ) m
  where s.id = m.id and s.template_version is null and m.version is not null;

  update public.signed_documents s
  set template_version = m.version, customized = m.customized
  from (
    select t.id,
      coalesce(
        (select v.version from public.form_template_versions v where v.slug = t.slug and v.content = t.content),
        (select max(v.version) from public.form_template_versions v where v.slug = t.slug and v.created_at <= t.sent_at)
      ) as version,
      not exists (select 1 from public.form_template_versions v where v.slug = t.slug and v.content = t.content) as customized
    from legal_sent t where t.slug = 'nda'
  ) m
  where s.id = m.id and s.template_version is null and m.version is not null;
end;
$$;
