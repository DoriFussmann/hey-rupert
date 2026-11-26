-- Everything client-facing moves to heyrupert.com addresses. This script
-- changes the notice address in the two legal templates new documents are
-- made from: the Service Order ("Rupert notice email") and the NDA.
--
-- Run it only once the dori@heyrupert.com mailbox exists and receives mail:
-- legal notices sent to it must arrive.
--
-- Each template is saved as a new version through legal_save_version(), so
-- the change is in the version history like any other edit. Documents already
-- sent or signed keep their own text, with the old address. Safe to re-run:
-- saving the same text again is not a new version.

select slug,
       public.legal_save_version(
         slug,
         title,
         replace(content, 'dori@thenightventures.com', 'dori@heyrupert.com'),
         'Rupert''s notice email moved to dori@heyrupert.com.',
         'migration'
       ) as saved
from public.form_templates
where slug in ('service_order', 'nda')
  and content like '%dori@thenightventures.com%';

-- Anything else still naming the old address (should return no rows; an
-- email template or signature edited in Forms → Emails would show up here).
select 'form_templates' as place, slug as key
from public.form_templates
where content ilike '%thenightventures.com%'
union all
select 'email_settings', key
from public.email_settings
where coalesce(subject, '') ilike '%thenightventures.com%'
   or coalesce(body, '') ilike '%thenightventures.com%';
