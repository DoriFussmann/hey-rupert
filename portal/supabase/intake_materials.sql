-- Intake with Company Materials: the founder shares their materials inside
-- the intake, and completing the intake also submits them.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- Where a shared file and the founder's answers disagreed, and what the
-- founder confirmed:
-- [{ id, topic_id, file, file_says, founder_says, resolution,
--    status: "open" | "resolved", updated_at }]
alter table public.intake_interviews
  add column if not exists material_conflicts jsonb not null default '[]'::jsonb;

-- Completes the intake and submits the company materials together, so one
-- never happens without the other. Moves the client to Setup.
-- Returns false when the intake was already complete (nothing changes).
create or replace function public.complete_intake_with_materials(
  p_client_id uuid,
  p_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  completed integer;
begin
  update public.clients
     set intake_completed_at = p_at
   where id = p_client_id
     and intake_completed_at is null;
  get diagnostics completed = row_count;
  if completed = 0 then
    return false;
  end if;

  update public.setup_steps
     set status = 'submitted',
         published = draft,
         version = version + 1,
         published_at = p_at,
         history = history || jsonb_build_array(
           jsonb_build_object(
             'version', version + 1,
             'published_at', p_at,
             'response', null
           )
         ),
         turn_since = p_at,
         completed_at = p_at,
         updated_at = p_at
   where client_id = p_client_id
     and step = 'materials'
     and status = 'draft';

  update public.clients
     set stage = 'setup'
   where id = p_client_id
     and stage in ('nda', 'intake');

  return true;
end;
$$;

revoke all on function public.complete_intake_with_materials(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_intake_with_materials(uuid, timestamptz)
  to service_role;
