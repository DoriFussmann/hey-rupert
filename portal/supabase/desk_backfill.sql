-- The Desk: backfill. Gives current clients their past record, built from
-- what the portal already holds:
--   setup_steps.history   every version Rupert published and the client's
--                         response to it (narrative, investor list, email copy)
--   setup_steps (materials)  each materials submission, and Rupert's requests for more
--   questions on a step   asked in the portal, or logged from an email or a call
--   client_feedback       logged feedback that is not in a step's thread
--
-- Every entry keeps the date it happened (occurred_at); created_at is when
-- this script ran. It follows the same rules as the live portal: a change
-- request opens a Feedback item, the next version answers it, a confirmation
-- closes it.
--
-- Run once in the Supabase SQL editor, after desk.sql. Safe to re-run: every
-- entry has a stable key, so nothing is added twice.
--
-- Covers active clients only (not archived, not the test pilot, not the
-- Match Sandbox). Past materials submissions and old logged feedback come in
-- closed, so the inbox starts with only what is really waiting on us.

-- Whether an event is already on a client's Desk, as an item or as a message.
create or replace function pg_temp.desk_seen(p_client_id uuid, p_ref text)
returns boolean
language sql
as $$
  select exists (select 1 from public.desk_items where client_id = p_client_id and source_ref = p_ref)
      or exists (select 1 from public.desk_messages where client_id = p_client_id and source_ref = p_ref);
$$;

do $$
declare
  c record;
  s record;
  h jsonb;
  q jsonb;
  f record;
  v_admin text;
  v_client text;
  v_step_label text;
  v_href text;
  v_version integer;
  v_published timestamptz;
  v_response jsonb;
  v_decision text;
  v_at timestamptz;
  v_body text;
  v_notes text;
  v_open uuid;
  v_latest uuid;
  v_item uuid;
  v_status text;
  v_last_version integer;
  v_title text;
  v_attachments jsonb;
  v_source text;
  v_files jsonb;
begin
  -- The name on Rupert's messages: the first word of the email signature.
  select split_part(btrim(split_part(body, E'\n', 1)), ' ', 1) into v_admin
  from public.email_settings where key = 'signature';
  v_admin := coalesce(nullif(v_admin, ''), 'Dori');

  for c in
    select id,
           coalesce(
             nullif(btrim(concat_ws(' ', first_name, last_name)), ''),
             nullif(btrim(founder_name), ''),
             nullif(btrim(company_name), ''),
             'Client'
           ) as name
    from public.clients
    where archived_at is null
      and coalesce(is_test_pilot, false) = false
      and coalesce(is_match_sandbox, false) = false
  loop
    v_client := c.name;

    -- -----------------------------------------------------------------------
    -- Review steps: each version and the client's response to it, in order.
    for s in
      select step, status, history, published
      from public.setup_steps
      where client_id = c.id and step in ('framing', 'investor_list', 'email_copy')
      order by step
    loop
      v_step_label := case s.step
        when 'framing' then 'Narrative'
        when 'investor_list' then 'Investor List'
        else 'Email Copy' end;
      v_href := case s.step
        when 'framing' then '/portal/setup/framing'
        when 'investor_list' then '/portal/setup/investor-list'
        else '/portal/setup/email-copy' end;

      for h in
        select value from jsonb_array_elements(coalesce(s.history, '[]'::jsonb))
        order by (value->>'version')::integer
      loop
        v_version := (h->>'version')::integer;
        v_published := nullif(h->>'published_at', '')::timestamptz;
        continue when v_version is null or v_published is null;
        v_attachments := jsonb_build_array(jsonb_build_object(
          'kind', 'link', 'url', v_href, 'label', v_step_label,
          'asset', jsonb_build_object('title', v_step_label, 'version', v_version)
        ));

        -- Rupert published this version.
        select id into v_open from public.desk_items
        where client_id = c.id and step = s.step and source = 'step' and status <> 'closed'
        order by last_message_at desc limit 1;
        if pg_temp.desk_seen(c.id, format('step:%s:v%s', s.step, v_version)) then
          null;
        elsif v_open is not null then
          perform public.desk_post_message(
            v_open, 'admin', v_admin,
            format('Version %s is in your portal, updated from your feedback. Review it and confirm, or tell us what to change.', v_version),
            v_attachments, null, null, v_published, 'waiting_client',
            format('step:%s:v%s', s.step, v_version)
          );
        else
          perform public.desk_open_item(
            c.id, 'update', s.step, 'step', v_href, format('step:%s:v%s', s.step, v_version),
            'admin', 'closed',
            case s.step
              when 'framing' then 'Your outreach narrative is '
              when 'investor_list' then 'Your investor list is '
              else 'Your outreach emails are ' end
              || case when v_version > 1 then 'updated' else 'ready' end,
            v_published, 'admin', v_admin,
            format('Version %s is in your portal. Review it and confirm, or tell us what to change.', v_version),
            v_attachments, null
          );
        end if;

        -- The client's response to it, if any.
        v_response := h->'response';
        continue when v_response is null or jsonb_typeof(v_response) <> 'object';
        v_decision := v_response->>'decision';
        v_at := coalesce(nullif(v_response->>'at', '')::timestamptz, v_published);
        continue when v_decision not in ('confirmed', 'changes_requested');
        continue when pg_temp.desk_seen(c.id, format('step:%s:v%s:response', s.step, v_version));

        select string_agg(
                 coalesce(nullif(v_response->'item_labels'->>n.key, ''), n.key) || ': ' || n.value,
                 E'\n' order by n.key
               )
          into v_notes
        from jsonb_each_text(
          case when jsonb_typeof(v_response->'item_notes') = 'object' then v_response->'item_notes' else '{}'::jsonb end
        ) n
        where btrim(n.value) <> '';
        v_body := concat_ws(
          E'\n\n',
          case when v_decision = 'confirmed'
            then format('Confirmed version %s.', v_version)
            else format('Asked for changes to version %s.', v_version) end,
          nullif(btrim(coalesce(v_response->>'note', '')), ''),
          v_notes
        );

        select id into v_open from public.desk_items
        where client_id = c.id and step = s.step and source = 'step' and status <> 'closed'
        order by last_message_at desc limit 1;
        select id into v_latest from public.desk_items
        where client_id = c.id and step = s.step and source = 'step'
        order by last_message_at desc limit 1;

        if v_decision = 'confirmed' then
          v_item := coalesce(v_open, v_latest);
          if v_item is not null then
            perform public.desk_post_message(
              v_item, 'client', v_client, left(v_body, 20000), '[]'::jsonb,
              case when v_open is not null then 'closed' end, null, v_at, 'closed',
              format('step:%s:v%s:response', s.step, v_version)
            );
          end if;
        elsif v_open is not null then
          perform public.desk_post_message(
            v_open, 'client', v_client, left(v_body, 20000), '[]'::jsonb, null, null, v_at, 'waiting_us',
            format('step:%s:v%s:response', s.step, v_version)
          );
        else
          perform public.desk_open_item(
            c.id, 'feedback', s.step, 'step', v_href, format('step:%s:v%s:response', s.step, v_version),
            'client', 'waiting_us',
            format('Changes requested: %s (version %s)', v_step_label, v_version),
            v_at, 'client', v_client, left(v_body, 20000), '[]'::jsonb, null
          );
        end if;
      end loop;

      -- Questions on the step: asked in the portal, or logged from an email or a call.
      for q in
        select value from jsonb_array_elements(
          case when jsonb_typeof(s.published->'questions') = 'array' then s.published->'questions' else '[]'::jsonb end
        )
      loop
        continue when coalesce(q->>'id', '') = '' or btrim(coalesce(q->>'question', '')) = '';
        v_source := case when q->'via'->>'channel' in ('email', 'call', 'message', 'meeting')
          then q->'via'->>'channel' else 'step' end;
        v_at := coalesce(
          case when q->'via'->>'on' ~ '^\d{4}-\d{2}-\d{2}$'
            then ((q->'via'->>'on') || 'T12:00:00Z')::timestamptz end,
          nullif(q->>'asked_at', '')::timestamptz,
          now()
        );
        v_status := case
          when coalesce(q->>'answered_at', '') <> '' or coalesce(q->>'resolved_at', '') <> '' then 'closed'
          else 'waiting_us' end;
        v_title := left(split_part(btrim(q->>'question'), E'\n', 1), 90);

        v_item := (public.desk_open_item(
          c.id,
          case when v_source = 'step' then 'question' else 'feedback' end,
          s.step, v_source, v_href, 'question:' || (q->>'id'),
          'client', 'waiting_us', v_title, v_at,
          'client', v_client, left(q->>'question', 20000), '[]'::jsonb,
          case when v_source <> 'step' then coalesce(q->'via'->>'by', 'admin') end
        )->>'id')::uuid;

        if v_status = 'closed' then
          perform public.desk_post_message(
            v_item, 'admin', v_admin,
            coalesce(nullif(btrim(coalesce(q->>'answer', '')), ''), 'Followed up with you on this directly.'),
            '[]'::jsonb, 'closed', null,
            coalesce(nullif(q->>'answered_at', '')::timestamptz, nullif(q->>'resolved_at', '')::timestamptz, v_at),
            'closed', 'question:' || (q->>'id') || ':answer'
          );
        end if;
      end loop;
    end loop;

    -- -----------------------------------------------------------------------
    -- Company materials: each submission, and Rupert's requests for more.
    for s in
      select status, history, published, version
      from public.setup_steps
      where client_id = c.id and step = 'materials'
    loop
      v_last_version := s.version;
      for h in
        select value from jsonb_array_elements(coalesce(s.history, '[]'::jsonb))
        order by (value->>'version')::integer
      loop
        v_version := (h->>'version')::integer;
        v_published := nullif(h->>'published_at', '')::timestamptz;
        continue when v_version is null or v_published is null;

        -- Only the files of the latest submission are known; they are listed on it.
        v_files := '[]'::jsonb;
        if v_version = v_last_version and jsonb_typeof(s.published->'files') = 'array' then
          select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', 'file', 'path', file->>'path', 'name', coalesce(file->>'name', 'file'),
                   'size', coalesce((file->>'size')::bigint, 0), 'type', coalesce(file->>'type', '')
                 )), '[]'::jsonb)
            into v_files
          from (
            select value as file
            from jsonb_array_elements(s.published->'files')
            where value->>'path' like c.id::text || '/%'
            limit 10
          ) listed;
        end if;

        select id into v_open from public.desk_items
        where client_id = c.id and step = 'materials' and source = 'materials'
          and opened_by = 'admin' and status <> 'closed'
        order by last_message_at desc limit 1;
        if pg_temp.desk_seen(c.id, format('materials:v%s', v_version)) then
          null;
        elsif v_open is not null then
          -- Rupert had asked for more: this submission answered it.
          perform public.desk_post_message(
            v_open, 'client', v_client, 'Company materials resubmitted.', v_files,
            'closed', null, v_published, 'closed', format('materials:v%s', v_version)
          );
        else
          perform public.desk_open_item(
            c.id, 'materials', 'materials', 'materials', '/portal/what-rupert-knows?open=files',
            format('materials:v%s', v_version), 'client', 'closed',
            case when v_version > 1 then 'Company materials resubmitted' else 'Company materials submitted' end,
            v_published, 'client', v_client, 'Company materials submitted.', v_files, null
          );
        end if;

        -- Rupert sent them back, asking for more.
        v_response := h->'response';
        if v_response is not null and jsonb_typeof(v_response) = 'object'
           and v_response->>'decision' = 'changes_requested'
           and btrim(coalesce(v_response->>'note', '')) <> '' then
          perform public.desk_open_item(
            c.id, 'question', 'materials', 'materials', '/portal/materials',
            format('materials:v%s:reopened', v_version), 'admin', 'waiting_client',
            left(split_part(btrim(v_response->>'note'), E'\n', 1), 90),
            coalesce(nullif(v_response->>'at', '')::timestamptz, v_published),
            'admin', v_admin, left(v_response->>'note', 20000), '[]'::jsonb, null
          );
        end if;
      end loop;
    end loop;

    -- -----------------------------------------------------------------------
    -- Logged feedback that is not in a step's thread (the same key as a
    -- thread question, so one already brought in above is not repeated).
    -- Older than two weeks: closed, as a record. Recent: waiting on us.
    for f in
      select id, about, channel, said_on, original, logged_by
      from public.client_feedback
      where client_id = c.id and deleted_at is null and btrim(original) <> ''
    loop
      perform public.desk_open_item(
        c.id, 'feedback',
        case when f.about in ('framing', 'investor_list', 'email_copy') then f.about else 'general' end,
        f.channel,
        case f.about
          when 'framing' then '/portal/setup/framing'
          when 'investor_list' then '/portal/setup/investor-list'
          when 'email_copy' then '/portal/setup/email-copy' end,
        'question:' || f.id::text,
        'client',
        case when f.said_on < current_date - 14 then 'closed' else 'waiting_us' end,
        left(split_part(btrim(f.original), E'\n', 1), 90),
        (f.said_on::text || 'T12:00:00Z')::timestamptz,
        'client', v_client, left(f.original, 20000), '[]'::jsonb, coalesce(f.logged_by, 'admin')
      );
    end loop;
  end loop;
end;
$$;

-- What came in, per client.
select c.company_name,
       count(distinct i.id) as items,
       count(m.id) as messages,
       count(distinct i.id) filter (where i.status = 'waiting_us') as waiting_on_us,
       count(distinct i.id) filter (where i.status = 'waiting_client') as waiting_on_client
from public.clients c
join public.desk_items i on i.client_id = c.id
left join public.desk_messages m on m.item_id = i.id
group by c.company_name
order by c.company_name;
