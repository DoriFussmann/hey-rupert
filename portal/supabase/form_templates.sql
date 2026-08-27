create table if not exists public.form_templates (
  slug text primary key,
  title text not null,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.form_templates enable row level security;
