-- What Rupert did after a bounce (lib/outreach/bounce-server.ts). Applied 2026-11-27.
alter table outreach_messages add column if not exists bounce jsonb;
comment on column outreach_messages.bounce is 'What Rupert did after a bounce: {email, at, action: new_address|removed, new_email, replaced_by, note}.';
