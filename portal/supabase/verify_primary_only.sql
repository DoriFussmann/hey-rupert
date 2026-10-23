-- Verify Emails: "Primary only" (one person per fund). Each verification run
-- records which contacts it covered; this lets a run record "primary".
-- Run once in the Supabase SQL editor. Safe to run again.

do $$
declare
  v_name text;
begin
  -- The scope check from contact_verification.sql, whatever its name.
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'verification_runs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%scope%'
  loop
    execute format('alter table public.verification_runs drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.verification_runs
  add constraint verification_runs_scope_check
  check (scope in ('all', 'sequence', 'primary', 'wave1'));
