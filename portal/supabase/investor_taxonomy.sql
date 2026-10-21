-- Investor taxonomy: canonical categories, how Fund Database values map to
-- them, the sector relationship graph, a change log, and coverage runs.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run: the
-- seed only adds what is missing and never overwrites reviewed data.
-- Needs portal/supabase/rupert_match.sql to have run first.
--
-- The Fund Database is never edited: firms keep their raw values, and their
-- canonical categories come from these mappings.
-- Seed: generated from the vocabulary in lib/match/engine/rupert-match-engine.cjs.
-- raw_key is the value in comparable form (see rawKey in lib/taxonomy/core.ts).

-- ---------------------------------------------------------------------------
-- Canonical categories. Parents are for browsing; only tax_edges relate sectors.
create table if not exists public.tax_nodes (
  id text primary key check (id ~ '^[a-z0-9_.]+$'),
  dimension text not null
    check (dimension in ('sector', 'stage', 'geography', 'financing', 'firm_type')),
  label text not null check (length(label) between 1 and 120),
  parent_id text references public.tax_nodes(id) on delete restrict,
  -- sector: group | sector | generalist | thesis
  -- geography: region | subregion | country | us_region | us_state
  -- stage: group | stage; financing; firm_type
  kind text not null,
  description text not null default '',
  synonyms text[] not null default '{}',
  -- geography: { memberOf: [ids] }; stage: { ladder: n }; sector: { granularity }
  attrs jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'retired')),
  sort integer not null default 0,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tax_nodes_dimension on public.tax_nodes (dimension, sort, label);
alter table public.tax_nodes enable row level security;

-- ---------------------------------------------------------------------------
-- One row per distinct raw value of a Fund Database field.
--   mapped:   node_ids are its canonical categories (one or more)
--   unmapped: no decision yet
--   ignored:  the value deliberately carries no meaning
-- ai_proposal holds an AI suggestion; it is never used until a person accepts it.
create table if not exists public.tax_aliases (
  field text not null
    check (field in ('industry', 'vertical', 'stage', 'geography', 'financing', 'firm_type', 'hq_country', 'hq_state', 'region')),
  raw_key text not null,
  raw_value text not null,
  node_ids text[] not null default '{}',
  state text not null default 'unmapped' check (state in ('mapped', 'unmapped', 'ignored')),
  review text not null default 'needs_review' check (review in ('approved', 'needs_review')),
  method text not null default 'import' check (method in ('seed', 'import', 'manual', 'ai')),
  rationale text not null default '',
  -- { nodeIds, confidence, rationale, at }
  ai_proposal jsonb,
  first_seen_version uuid references public.fund_db_versions(id) on delete set null,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (field, raw_key),
  check (state <> 'mapped' or cardinality(node_ids) > 0)
);

create index if not exists tax_aliases_queue on public.tax_aliases (state, review);
alter table public.tax_aliases enable row level security;

-- ---------------------------------------------------------------------------
-- Sector relationship graph. One edge per pair; directed = holds from → to only.
-- Rejected edges stay, so the same relationship is not proposed again.
create table if not exists public.tax_edges (
  id uuid primary key default gen_random_uuid(),
  from_id text not null references public.tax_nodes(id) on delete cascade,
  to_id text not null references public.tax_nodes(id) on delete cascade,
  relation text not null check (relation in ('equivalent', 'immediate', 'broad', 'weak')),
  directed boolean not null default false,
  origin text not null check (origin in ('seed', 'legacy', 'manual', 'ai')),
  review text not null default 'needs_review' check (review in ('approved', 'needs_review', 'rejected')),
  rationale text not null default '',
  source text not null default '',
  context text not null default '',
  reviewed_by text,
  reviewed_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);

create unique index if not exists tax_edges_pair
  on public.tax_edges (least(from_id, to_id), greatest(from_id, to_id));
alter table public.tax_edges enable row level security;

-- ---------------------------------------------------------------------------
-- Every change to the three tables above, with the row before and after. The
-- latest id is the taxonomy revision.
create table if not exists public.tax_changes (
  id bigserial primary key,
  entity text not null,
  entity_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor text,
  at timestamptz not null default now()
);

create index if not exists tax_changes_entity on public.tax_changes (entity, entity_key, id desc);
alter table public.tax_changes enable row level security;

create or replace function public.tax_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_json jsonb;
  row_key text;
begin
  if tg_op = 'DELETE' then
    row_json := to_jsonb(old);
  else
    row_json := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return null;
  end if;
  row_key := case tg_table_name
    when 'tax_aliases' then (row_json->>'field') || '|' || (row_json->>'raw_key')
    else row_json->>'id'
  end;
  insert into public.tax_changes (entity, entity_key, action, before, after, actor)
  values (
    tg_table_name,
    row_key,
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    row_json->>'updated_by'
  );
  return null;
end;
$$;

revoke all on function public.tax_log_change() from public, anon, authenticated;

drop trigger if exists tax_nodes_log on public.tax_nodes;
create trigger tax_nodes_log after insert or update or delete on public.tax_nodes
  for each row execute function public.tax_log_change();
drop trigger if exists tax_aliases_log on public.tax_aliases;
create trigger tax_aliases_log after insert or update or delete on public.tax_aliases
  for each row execute function public.tax_log_change();
drop trigger if exists tax_edges_log on public.tax_edges;
create trigger tax_edges_log after insert or update or delete on public.tax_edges
  for each row execute function public.tax_log_change();

-- ---------------------------------------------------------------------------
-- Coverage and data-quality results, one per database version and taxonomy
-- revision. Re-running for the same pair replaces it.
create table if not exists public.tax_coverage_runs (
  id uuid primary key default gen_random_uuid(),
  fund_db_version_id uuid not null references public.fund_db_versions(id) on delete cascade,
  taxonomy_revision bigint not null,
  report jsonb not null,
  -- Every firm's mapping, in the private fund-database bucket.
  mappings_path text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (fund_db_version_id, taxonomy_revision)
);

create index if not exists tax_coverage_runs_latest on public.tax_coverage_runs (fund_db_version_id, created_at desc);
alter table public.tax_coverage_runs enable row level security;

-- ---------------------------------------------------------------------------

-- Comparable form of a raw value; the same rule as rawKey() in lib/taxonomy/core.ts.
create or replace function public.tax_raw_key(value text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(normalize(value, NFKC)), E'\u2010\u2011\u2012\u2013\u2014\u2015', '------'),
    '\s*([/&,-])\s*', '\1', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Seed: 243 categories, 301 value mappings, 103 relationships to review.
-- Generated from the vocabulary in lib/match/engine/rupert-match-engine.cjs.
-- Only adds what is missing; never overwrites anything already there.

-- One statement (no temporary table): the seed categories, then the value
-- mappings derived from them. attrs: 'b' = broad sector (provider Industry),
-- 's' = specific sector (provider Vertical), otherwise JSON.
-- Each seeded value is the category's own label (firm types excepted).
with seed (id, label, parent_id, kind, sort, attrs) as (values
  ('sector.grp.software', 'Software & IT', null, 'group', 0, null),
  ('sector.grp.financial', 'Financial services', null, 'group', 1, null),
  ('sector.grp.health', 'Health & life sciences', null, 'group', 2, null),
  ('sector.grp.consumer', 'Consumer & commerce', null, 'group', 3, null),
  ('sector.grp.media', 'Media & advertising', null, 'group', 4, null),
  ('sector.grp.industrial', 'Industrial & business', null, 'group', 5, null),
  ('sector.grp.climate', 'Energy & climate', null, 'group', 6, null),
  ('sector.grp.deeptech', 'Hardware & deep tech', null, 'group', 7, null),
  ('sector.grp.telecom', 'Communications', null, 'group', 8, null),
  ('sector.grp.real_estate', 'Real estate', null, 'group', 9, null),
  ('sector.grp.education', 'Education', null, 'group', 10, null),
  ('sector.grp.food_ag', 'Food & agriculture', null, 'group', 11, null),
  ('sector.grp.cross', 'Cross-sector', null, 'group', 12, null),
  ('sector.software', 'Software', 'sector.grp.software', 'sector', 0, 'b'),
  ('sector.it_services', 'IT Services', 'sector.grp.software', 'sector', 0, 'b'),
  ('sector.financial_services', 'Financial Services', 'sector.grp.financial', 'sector', 0, 'b'),
  ('sector.healthcare_services', 'Healthcare Services', 'sector.grp.health', 'sector', 0, 'b'),
  ('sector.communications_and_networking', 'Communications & Networking', 'sector.grp.telecom', 'sector', 0, 'b'),
  ('sector.consumer_products_and_services', 'Consumer Products & Services', 'sector.grp.consumer', 'sector', 0, 'b'),
  ('sector.distribution_retailing', 'Distribution/Retailing', 'sector.grp.consumer', 'sector', 0, 'b'),
  ('sector.media_and_entertainment', 'Media & Entertainment', 'sector.grp.media', 'sector', 0, 'b'),
  ('sector.business_products_and_services', 'Business Products & Services', 'sector.grp.industrial', 'sector', 0, 'b'),
  ('sector.energy_natural_resources', 'Energy/Natural Resources', 'sector.grp.climate', 'sector', 0, 'b'),
  ('sector.internet_technology', 'Internet Technology', 'sector.grp.software', 'sector', 0, 'b'),
  ('sector.medical_devices_and_equipment', 'Medical Devices & Equipment', 'sector.grp.health', 'sector', 0, 'b'),
  ('sector.manufacturing', 'Manufacturing', 'sector.grp.industrial', 'sector', 0, 'b'),
  ('sector.food_services_and_products', 'Food Services & Products', 'sector.grp.food_ag', 'sector', 0, 'b'),
  ('sector.biotechnology', 'Biotechnology', 'sector.grp.health', 'sector', 0, 'b'),
  ('sector.chemicals_and_materials', 'Chemicals & Materials', 'sector.grp.industrial', 'sector', 0, 'b'),
  ('sector.industrial_products_and_services', 'Industrial Products & Services', 'sector.grp.industrial', 'sector', 0, 'b'),
  ('sector.education_and_training', 'Education & Training', 'sector.grp.education', 'sector', 0, 'b'),
  ('sector.pharmaceuticals', 'Pharmaceuticals', 'sector.grp.health', 'sector', 0, 'b'),
  ('sector.diversified', 'Diversified', 'sector.grp.cross', 'generalist', 0, 'b'),
  ('sector.electronics', 'Electronics', 'sector.grp.deeptech', 'sector', 0, 'b'),
  ('sector.transportation', 'Transportation', 'sector.grp.industrial', 'sector', 0, 'b'),
  ('sector.environment', 'Environment', 'sector.grp.climate', 'sector', 0, 'b'),
  ('sector.telecommunications', 'Telecommunications', 'sector.grp.telecom', 'sector', 0, 'b'),
  ('sector.real_estate_construction', 'Real Estate/Construction', 'sector.grp.real_estate', 'sector', 0, 'b'),
  ('sector.computers_and_peripherals', 'Computers & Peripherals', 'sector.grp.deeptech', 'sector', 0, 'b'),
  ('sector.semiconductors', 'Semiconductors', 'sector.grp.deeptech', 'sector', 0, 'b'),
  ('sector.agriculture_and_fishery', 'Agriculture & Fishery', 'sector.grp.food_ag', 'sector', 0, 'b'),
  ('sector.aerospace_and_defense', 'Aerospace & Defense', 'sector.grp.deeptech', 'sector', 0, 'b'),
  ('sector.ai_ml', 'AI/ML', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.saas', 'SaaS', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.fintech', 'Fintech', 'sector.grp.financial', 'sector', 0, 's'),
  ('sector.healthtech', 'Healthtech', 'sector.grp.health', 'sector', 0, 's'),
  ('sector.life_sciences', 'Life Sciences', 'sector.grp.health', 'sector', 0, 's'),
  ('sector.cybersecurity', 'Cybersecurity', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.infrastructure', 'Infrastructure', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.marketplace', 'Marketplace', 'sector.grp.consumer', 'sector', 0, 's'),
  ('sector.deeptech', 'Deeptech', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.climate_tech', 'Climate Tech', 'sector.grp.climate', 'sector', 0, 's'),
  ('sector.edtech', 'Edtech', 'sector.grp.education', 'sector', 0, 's'),
  ('sector.robotics', 'Robotics', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.cleantech', 'Cleantech', 'sector.grp.climate', 'sector', 0, 's'),
  ('sector.web3', 'Web3', 'sector.grp.financial', 'sector', 0, 's'),
  ('sector.iot', 'IoT', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.e_commerce', 'E-commerce', 'sector.grp.consumer', 'sector', 0, 's'),
  ('sector.blockchain', 'Blockchain', 'sector.grp.financial', 'sector', 0, 's'),
  ('sector.data', 'Data', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.proptech', 'Proptech', 'sector.grp.real_estate', 'sector', 0, 's'),
  ('sector.medtech', 'Medtech', 'sector.grp.health', 'sector', 0, 's'),
  ('sector.insurtech', 'Insurtech', 'sector.grp.financial', 'sector', 0, 's'),
  ('sector.agtech', 'Agtech', 'sector.grp.food_ag', 'sector', 0, 's'),
  ('sector.foodtech', 'Foodtech', 'sector.grp.food_ag', 'sector', 0, 's'),
  ('sector.consumer_tech', 'Consumer Tech', 'sector.grp.consumer', 'sector', 0, 's'),
  ('sector.spacetech', 'Spacetech', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.hrtech', 'HRtech', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.decarbonization_tech', 'Decarbonization Tech', 'sector.grp.climate', 'sector', 0, 's'),
  ('sector.adtech', 'Adtech', 'sector.grp.media', 'sector', 0, 's'),
  ('sector.frontiertech', 'Frontiertech', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.cloud_computing', 'Cloud Computing', 'sector.grp.software', 'sector', 0, 's'),
  ('sector.impact_investing', 'Impact Investing', 'sector.grp.cross', 'thesis', 0, 's'),
  ('sector.3d_printing', '3D Printing', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('sector.cannabis', 'Cannabis', 'sector.grp.consumer', 'sector', 0, 's'),
  ('sector.nanotechnology', 'Nanotechnology', 'sector.grp.deeptech', 'sector', 0, 's'),
  ('stage.grp.venture', 'Venture', null, 'group', 0, null),
  ('stage.grp.pe', 'Private equity situations', null, 'group', 1, null),
  ('stage.pre_seed', 'Pre-Seed', 'stage.grp.venture', 'stage', 0, '{"ladder":1}'),
  ('stage.seed', 'Seed', 'stage.grp.venture', 'stage', 1, '{"ladder":2}'),
  ('stage.series_a', 'Series A', 'stage.grp.venture', 'stage', 2, '{"ladder":3}'),
  ('stage.series_b', 'Series B', 'stage.grp.venture', 'stage', 3, '{"ladder":4}'),
  ('stage.series_c_plus', 'Series C and Beyond', 'stage.grp.venture', 'stage', 4, '{"ladder":5}'),
  ('stage.growth', 'Growth Equity', 'stage.grp.venture', 'stage', 5, '{"ladder":6}'),
  ('stage.pe.buyout', 'Buyout', 'stage.grp.pe', 'stage', 0, null),
  ('stage.pe.recapitalization', 'Recapitalization', 'stage.grp.pe', 'stage', 1, null),
  ('stage.pe.acquisition', 'Acquisition', 'stage.grp.pe', 'stage', 2, null),
  ('stage.pe.corporate_divestiture', 'Corporate Divestiture', 'stage.grp.pe', 'stage', 3, null),
  ('stage.pe.restructuring', 'Restructuring', 'stage.grp.pe', 'stage', 4, null),
  ('stage.pe.consolidation', 'Consolidation', 'stage.grp.pe', 'stage', 5, null),
  ('stage.pe.special_situations', 'Special Situations', 'stage.grp.pe', 'stage', 6, null),
  ('stage.pe.going_private', 'Going Private', 'stage.grp.pe', 'stage', 7, null),
  ('stage.pe.turnaround', 'Turnaround', 'stage.grp.pe', 'stage', 8, null),
  ('stage.pe.ownership_transition', 'Ownership Transition', 'stage.grp.pe', 'stage', 9, null),
  ('stage.pe.pipe', 'PIPE', 'stage.grp.pe', 'stage', 10, null),
  ('stage.pe.family_succession', 'Family Succession', 'stage.grp.pe', 'stage', 11, null),
  ('stage.pe.secondary_purchase', 'Secondary Purchase', 'stage.grp.pe', 'stage', 12, null),
  ('stage.pe.privatization', 'Privatization', 'stage.grp.pe', 'stage', 13, null),
  ('stage.pe.distressed_debt', 'Distressed Debt', 'stage.grp.pe', 'stage', 14, null),
  ('stage.pe.shareholder_liquidity', 'Shareholder Liquidity', 'stage.grp.pe', 'stage', 15, null),
  ('stage.pe.refinancing', 'Refinancing', 'stage.grp.pe', 'stage', 16, null),
  ('stage.pe.bankruptcy', 'Bankruptcy', 'stage.grp.pe', 'stage', 17, null),
  ('geo.north_america', 'North America', null, 'region', 0, null),
  ('geo.europe', 'Europe', null, 'region', 1, null),
  ('geo.asia', 'Asia', null, 'region', 2, null),
  ('geo.middle_east', 'Middle East', null, 'region', 3, null),
  ('geo.africa', 'Africa', null, 'region', 4, null),
  ('geo.latin_america', 'Latin America', null, 'region', 5, null),
  ('geo.europe_western', 'Europe (Western)', 'geo.europe', 'subregion', 0, null),
  ('geo.europe_central', 'Europe (Central)', 'geo.europe', 'subregion', 1, null),
  ('geo.europe_eastern', 'Europe (Eastern)', 'geo.europe', 'subregion', 2, null),
  ('geo.us', 'United States', 'geo.north_america', 'country', 0, null),
  ('geo.canada', 'Canada', 'geo.north_america', 'country', 0, null),
  ('geo.argentina', 'Argentina', 'geo.latin_america', 'country', 0, null),
  ('geo.australia', 'Australia', 'geo.asia', 'country', 0, null),
  ('geo.austria', 'Austria', 'geo.europe_western', 'country', 0, '{"memberOf":["geo.europe_central"]}'),
  ('geo.belgium', 'Belgium', 'geo.europe_western', 'country', 0, null),
  ('geo.brazil', 'Brazil', 'geo.latin_america', 'country', 0, null),
  ('geo.bulgaria', 'Bulgaria', 'geo.europe_eastern', 'country', 0, null),
  ('geo.cambodia', 'Cambodia', 'geo.asia', 'country', 0, null),
  ('geo.chile', 'Chile', 'geo.latin_america', 'country', 0, null),
  ('geo.china', 'China', 'geo.asia', 'country', 0, null),
  ('geo.colombia', 'Colombia', 'geo.latin_america', 'country', 0, null),
  ('geo.croatia', 'Croatia', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.cyprus', 'Cyprus', 'geo.europe_western', 'country', 0, null),
  ('geo.czechia', 'Czechia', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.denmark', 'Denmark', 'geo.europe_western', 'country', 0, null),
  ('geo.egypt', 'Egypt', 'geo.middle_east', 'country', 0, '{"memberOf":["geo.africa"]}'),
  ('geo.estonia', 'Estonia', 'geo.europe_eastern', 'country', 0, null),
  ('geo.ethiopia', 'Ethiopia', 'geo.africa', 'country', 0, null),
  ('geo.finland', 'Finland', 'geo.europe_western', 'country', 0, null),
  ('geo.france', 'France', 'geo.europe_western', 'country', 0, null),
  ('geo.germany', 'Germany', 'geo.europe_western', 'country', 0, '{"memberOf":["geo.europe_central"]}'),
  ('geo.greece', 'Greece', 'geo.europe_western', 'country', 0, null),
  ('geo.hong_kong', 'Hong Kong', 'geo.asia', 'country', 0, null),
  ('geo.hungary', 'Hungary', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.iceland', 'Iceland', 'geo.europe_western', 'country', 0, null),
  ('geo.india', 'India', 'geo.asia', 'country', 0, null),
  ('geo.indonesia', 'Indonesia', 'geo.asia', 'country', 0, null),
  ('geo.ireland', 'Ireland', 'geo.europe_western', 'country', 0, null),
  ('geo.israel', 'Israel', 'geo.middle_east', 'country', 0, null),
  ('geo.italy', 'Italy', 'geo.europe_western', 'country', 0, null),
  ('geo.japan', 'Japan', 'geo.asia', 'country', 0, null),
  ('geo.kenya', 'Kenya', 'geo.africa', 'country', 0, null),
  ('geo.korea_south', 'Korea (South)', 'geo.asia', 'country', 0, null),
  ('geo.latvia', 'Latvia', 'geo.europe_eastern', 'country', 0, null),
  ('geo.lithuania', 'Lithuania', 'geo.europe_eastern', 'country', 0, null),
  ('geo.luxembourg', 'Luxembourg', 'geo.europe_western', 'country', 0, null),
  ('geo.malaysia', 'Malaysia', 'geo.asia', 'country', 0, null),
  ('geo.mexico', 'Mexico', 'geo.latin_america', 'country', 0, null),
  ('geo.myanmar', 'Myanmar', 'geo.asia', 'country', 0, null),
  ('geo.netherlands', 'Netherlands', 'geo.europe_western', 'country', 0, null),
  ('geo.new_zealand', 'New Zealand', 'geo.asia', 'country', 0, null),
  ('geo.nigeria', 'Nigeria', 'geo.africa', 'country', 0, null),
  ('geo.norway', 'Norway', 'geo.europe_western', 'country', 0, null),
  ('geo.pakistan', 'Pakistan', 'geo.asia', 'country', 0, null),
  ('geo.philippines', 'Philippines', 'geo.asia', 'country', 0, null),
  ('geo.poland', 'Poland', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.portugal', 'Portugal', 'geo.europe_western', 'country', 0, null),
  ('geo.romania', 'Romania', 'geo.europe_eastern', 'country', 0, null),
  ('geo.russia', 'Russia', 'geo.europe_eastern', 'country', 0, null),
  ('geo.saudi_arabia', 'Saudi Arabia', 'geo.middle_east', 'country', 0, null),
  ('geo.serbia', 'Serbia', 'geo.europe_eastern', 'country', 0, null),
  ('geo.singapore', 'Singapore', 'geo.asia', 'country', 0, null),
  ('geo.slovakia', 'Slovakia', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.slovenia', 'Slovenia', 'geo.europe_central', 'country', 0, '{"memberOf":["geo.europe_eastern"]}'),
  ('geo.south_africa', 'South Africa', 'geo.africa', 'country', 0, null),
  ('geo.spain', 'Spain', 'geo.europe_western', 'country', 0, null),
  ('geo.sri_lanka', 'Sri Lanka', 'geo.asia', 'country', 0, null),
  ('geo.sweden', 'Sweden', 'geo.europe_western', 'country', 0, null),
  ('geo.switzerland', 'Switzerland', 'geo.europe_western', 'country', 0, '{"memberOf":["geo.europe_central"]}'),
  ('geo.taiwan', 'Taiwan', 'geo.asia', 'country', 0, null),
  ('geo.thailand', 'Thailand', 'geo.asia', 'country', 0, null),
  ('geo.turkey', 'Turkey', 'geo.middle_east', 'country', 0, null),
  ('geo.ukraine', 'Ukraine', 'geo.europe_eastern', 'country', 0, null),
  ('geo.united_arab_emirates', 'United Arab Emirates', 'geo.middle_east', 'country', 0, null),
  ('geo.united_kingdom', 'United Kingdom', 'geo.europe_western', 'country', 0, null),
  ('geo.vietnam', 'Vietnam', 'geo.asia', 'country', 0, null),
  ('geo.us.california', 'United States (California)', 'geo.us', 'us_region', 0, null),
  ('geo.us.northwest', 'United States (Northwest)', 'geo.us', 'us_region', 1, null),
  ('geo.us.southwest', 'United States (Southwest)', 'geo.us', 'us_region', 2, null),
  ('geo.us.rocky_mountains', 'United States (Rocky Mountains)', 'geo.us', 'us_region', 3, null),
  ('geo.us.midwest', 'United States (Midwest)', 'geo.us', 'us_region', 4, null),
  ('geo.us.southeast', 'United States (Southeast)', 'geo.us', 'us_region', 5, null),
  ('geo.us.mid_atlantic', 'United States (Mid-Atlantic)', 'geo.us', 'us_region', 6, null),
  ('geo.us.northeast', 'United States (Northeast)', 'geo.us', 'us_region', 7, null),
  ('geo.us.state.washington', 'Washington', 'geo.us.northwest', 'us_state', 0, null),
  ('geo.us.state.oregon', 'Oregon', 'geo.us.northwest', 'us_state', 0, null),
  ('geo.us.state.alaska', 'Alaska', 'geo.us.northwest', 'us_state', 0, null),
  ('geo.us.state.hawaii', 'Hawaii', 'geo.us.northwest', 'us_state', 0, null),
  ('geo.us.state.arizona', 'Arizona', 'geo.us.southwest', 'us_state', 0, null),
  ('geo.us.state.new_mexico', 'New Mexico', 'geo.us.southwest', 'us_state', 0, null),
  ('geo.us.state.texas', 'Texas', 'geo.us.southwest', 'us_state', 0, null),
  ('geo.us.state.oklahoma', 'Oklahoma', 'geo.us.southwest', 'us_state', 0, null),
  ('geo.us.state.nevada', 'Nevada', 'geo.us.southwest', 'us_state', 0, null),
  ('geo.us.state.colorado', 'Colorado', 'geo.us.rocky_mountains', 'us_state', 0, null),
  ('geo.us.state.utah', 'Utah', 'geo.us.rocky_mountains', 'us_state', 0, null),
  ('geo.us.state.wyoming', 'Wyoming', 'geo.us.rocky_mountains', 'us_state', 0, null),
  ('geo.us.state.montana', 'Montana', 'geo.us.rocky_mountains', 'us_state', 0, null),
  ('geo.us.state.idaho', 'Idaho', 'geo.us.rocky_mountains', 'us_state', 0, null),
  ('geo.us.state.illinois', 'Illinois', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.ohio', 'Ohio', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.michigan', 'Michigan', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.indiana', 'Indiana', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.wisconsin', 'Wisconsin', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.minnesota', 'Minnesota', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.iowa', 'Iowa', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.missouri', 'Missouri', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.kansas', 'Kansas', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.nebraska', 'Nebraska', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.north_dakota', 'North Dakota', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.south_dakota', 'South Dakota', 'geo.us.midwest', 'us_state', 0, null),
  ('geo.us.state.florida', 'Florida', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.georgia', 'Georgia', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.north_carolina', 'North Carolina', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.south_carolina', 'South Carolina', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.tennessee', 'Tennessee', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.alabama', 'Alabama', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.mississippi', 'Mississippi', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.louisiana', 'Louisiana', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.kentucky', 'Kentucky', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.arkansas', 'Arkansas', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.west_virginia', 'West Virginia', 'geo.us.southeast', 'us_state', 0, null),
  ('geo.us.state.new_york', 'New York', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.new_jersey', 'New Jersey', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.pennsylvania', 'Pennsylvania', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.delaware', 'Delaware', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.maryland', 'Maryland', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.district_of_columbia', 'District of Columbia', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.virginia', 'Virginia', 'geo.us.mid_atlantic', 'us_state', 0, null),
  ('geo.us.state.massachusetts', 'Massachusetts', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.connecticut', 'Connecticut', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.rhode_island', 'Rhode Island', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.vermont', 'Vermont', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.new_hampshire', 'New Hampshire', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.maine', 'Maine', 'geo.us.northeast', 'us_state', 0, null),
  ('geo.us.state.california', 'California', 'geo.us.california', 'us_state', 0, null),
  ('financing.equity', 'Equity', null, 'financing', 0, null),
  ('financing.debt', 'Debt', null, 'financing', 0, null),
  ('firm_type.vc', 'Venture capital firm', null, 'firm_type', 0, null),
  ('firm_type.pe', 'Private equity firm', null, 'firm_type', 0, null),
  ('firm_type.family_office', 'Family office', null, 'firm_type', 0, null),
  ('firm_type.angel_group', 'Angel group', null, 'firm_type', 0, null)
),
new_nodes as (
  insert into public.tax_nodes (id, dimension, label, parent_id, kind, description, synonyms, attrs, sort, updated_by)
  select
    s.id,
    case split_part(s.id, '.', 1) when 'geo' then 'geography' else split_part(s.id, '.', 1) end,
    s.label,
    s.parent_id,
    s.kind,
    coalesce(x.description, case when s.kind = 'group' and s.id like 'sector.%' then 'Browsing group. Groups do not imply a relationship between their sectors; only relationships do.' else '' end),
    coalesce(x.synonyms, '{}'),
    case s.attrs
      when 'b' then '{"granularity":"broad"}'::jsonb
      when 's' then '{"granularity":"specific"}'::jsonb
      else coalesce(s.attrs, '{}')::jsonb
    end,
    s.sort,
    'seed'
  from seed s
  left join (values
    ('sector.diversified', 'Invests across sectors. Marks a generalist firm; it is not a sector and has no relationships.', array[]::text[]),
    ('sector.ai_ml', '', array['artificial intelligence', 'machine learning']::text[]),
    ('sector.saas', '', array['software as a service']::text[]),
    ('sector.fintech', '', array['financial technology']::text[]),
    ('sector.healthtech', '', array['digital health', 'health tech']::text[]),
    ('sector.cybersecurity', '', array['information security']::text[]),
    ('sector.edtech', '', array['education technology']::text[]),
    ('sector.iot', '', array['internet of things']::text[]),
    ('sector.e_commerce', '', array['ecommerce', 'online retail']::text[]),
    ('sector.proptech', '', array['property technology']::text[]),
    ('sector.medtech', '', array['medical technology']::text[]),
    ('sector.insurtech', '', array['insurance technology']::text[]),
    ('sector.agtech', '', array['agriculture technology']::text[]),
    ('sector.foodtech', '', array['food technology']::text[]),
    ('sector.spacetech', '', array['space technology']::text[]),
    ('sector.adtech', '', array['advertising technology']::text[]),
    ('sector.impact_investing', 'An investment thesis rather than a sector.', array[]::text[]),
    ('geo.australia', 'Grouping follows the current match engine''s region lists. Confirm the provider''s "Asia" includes it.', array[]::text[]),
    ('geo.new_zealand', 'Grouping follows the current match engine''s region lists. Confirm the provider''s "Asia" includes it.', array[]::text[])
  ) as x (id, description, synonyms) on x.id = s.id
  on conflict (id) do nothing
  returning 1
)
insert into public.tax_aliases (field, raw_key, raw_value, node_ids, state, review, method, rationale, reviewed_by, reviewed_at, updated_by)
select m.field, public.tax_raw_key(s.label), s.label, array[s.id], 'mapped', 'approved', 'seed', m.rationale, 'seed', now(), 'seed'
from seed s
join (values
  ('sector:b', 'industry', 'Provider Industry value; same category.'),
  ('sector:s', 'vertical', 'Provider Vertical value; same category.'),
  ('stage', 'stage', 'Provider Stage value; same stage.'),
  ('region', 'geography', 'Provider region value; same region.'),
  ('region', 'region', 'Provider region value; same region.'),
  ('subregion', 'geography', 'Provider region value; same region.'),
  ('country', 'geography', 'Provider country value; same country.'),
  ('country', 'hq_country', 'Provider country value; same country.'),
  ('us_region', 'geography', 'Provider US region value; same region.'),
  ('us_state', 'hq_state', 'US state; same state.'),
  ('financing', 'financing', 'Provider Financing value; same instrument.')
) as m (kind_key, field, rationale)
  on m.kind_key = case when s.id like 'sector.%' then 'sector:' || s.attrs else s.kind end
union all
select 'firm_type', public.tax_raw_key(v.raw_value), v.raw_value, array[v.id], 'mapped', 'approved', 'seed', 'Provider Type of Firm value; same firm type.', 'seed', now(), 'seed'
from (values
  ('Venture Capital Investment Firm', 'firm_type.vc'),
  ('Private Equity Investment Firm', 'firm_type.pe'),
  ('Family Investment Office', 'firm_type.family_office'),
  ('Angel Investor Group', 'firm_type.angel_group')
) as v (raw_value, id)
on conflict (field, raw_key) do nothing;

-- Relationships from the current match engine, all needing review:
-- V_ADJ (listed as adjacent) as immediate, V2I (likely industry of a vertical) as broad.
insert into public.tax_edges (from_id, to_id, relation, directed, origin, review, rationale, source, updated_by)
select
  e.from_id,
  e.to_id,
  case e.list when 'V_ADJ' then 'immediate' else 'broad' end,
  e.directed,
  'legacy',
  'needs_review',
  case e.list
    when 'V_ADJ' then 'Listed as adjacent in the current match engine. No rationale was recorded: confirm, change or reject.'
    else 'The current match engine lists this industry as a likely home for the vertical. Confirm, change or reject.'
  end,
  'rupert-match-engine.cjs ' || e.list,
  'seed'
from (values
  ('sector.ai_ml', 'sector.data', false, 'V_ADJ'),
  ('sector.ai_ml', 'sector.deeptech', false, 'V_ADJ'),
  ('sector.ai_ml', 'sector.saas', false, 'V_ADJ'),
  ('sector.ai_ml', 'sector.cloud_computing', true, 'V_ADJ'),
  ('sector.ai_ml', 'sector.frontiertech', true, 'V_ADJ'),
  ('sector.saas', 'sector.cloud_computing', false, 'V_ADJ'),
  ('sector.saas', 'sector.data', false, 'V_ADJ'),
  ('sector.saas', 'sector.hrtech', false, 'V_ADJ'),
  ('sector.fintech', 'sector.insurtech', false, 'V_ADJ'),
  ('sector.fintech', 'sector.blockchain', false, 'V_ADJ'),
  ('sector.fintech', 'sector.web3', false, 'V_ADJ'),
  ('sector.fintech', 'sector.proptech', false, 'V_ADJ'),
  ('sector.insurtech', 'sector.healthtech', false, 'V_ADJ'),
  ('sector.healthtech', 'sector.medtech', false, 'V_ADJ'),
  ('sector.healthtech', 'sector.life_sciences', false, 'V_ADJ'),
  ('sector.medtech', 'sector.life_sciences', false, 'V_ADJ'),
  ('sector.cybersecurity', 'sector.infrastructure', false, 'V_ADJ'),
  ('sector.cybersecurity', 'sector.cloud_computing', true, 'V_ADJ'),
  ('sector.cybersecurity', 'sector.data', true, 'V_ADJ'),
  ('sector.infrastructure', 'sector.cloud_computing', false, 'V_ADJ'),
  ('sector.infrastructure', 'sector.data', true, 'V_ADJ'),
  ('sector.data', 'sector.cloud_computing', false, 'V_ADJ'),
  ('sector.marketplace', 'sector.e_commerce', false, 'V_ADJ'),
  ('sector.marketplace', 'sector.consumer_tech', false, 'V_ADJ'),
  ('sector.e_commerce', 'sector.consumer_tech', false, 'V_ADJ'),
  ('sector.e_commerce', 'sector.adtech', false, 'V_ADJ'),
  ('sector.adtech', 'sector.data', true, 'V_ADJ'),
  ('sector.deeptech', 'sector.frontiertech', false, 'V_ADJ'),
  ('sector.deeptech', 'sector.robotics', false, 'V_ADJ'),
  ('sector.deeptech', 'sector.spacetech', false, 'V_ADJ'),
  ('sector.deeptech', 'sector.nanotechnology', false, 'V_ADJ'),
  ('sector.frontiertech', 'sector.spacetech', false, 'V_ADJ'),
  ('sector.robotics', 'sector.iot', false, 'V_ADJ'),
  ('sector.robotics', 'sector.3d_printing', false, 'V_ADJ'),
  ('sector.iot', 'sector.infrastructure', true, 'V_ADJ'),
  ('sector.3d_printing', 'sector.deeptech', true, 'V_ADJ'),
  ('sector.climate_tech', 'sector.cleantech', false, 'V_ADJ'),
  ('sector.climate_tech', 'sector.decarbonization_tech', false, 'V_ADJ'),
  ('sector.climate_tech', 'sector.impact_investing', false, 'V_ADJ'),
  ('sector.cleantech', 'sector.decarbonization_tech', false, 'V_ADJ'),
  ('sector.agtech', 'sector.foodtech', false, 'V_ADJ'),
  ('sector.agtech', 'sector.climate_tech', true, 'V_ADJ'),
  ('sector.foodtech', 'sector.consumer_tech', true, 'V_ADJ'),
  ('sector.edtech', 'sector.hrtech', false, 'V_ADJ'),
  ('sector.edtech', 'sector.consumer_tech', true, 'V_ADJ'),
  ('sector.web3', 'sector.blockchain', false, 'V_ADJ'),
  ('sector.cannabis', 'sector.consumer_tech', true, 'V_ADJ'),
  ('sector.ai_ml', 'sector.software', false, 'V2I'),
  ('sector.ai_ml', 'sector.internet_technology', false, 'V2I'),
  ('sector.saas', 'sector.software', false, 'V2I'),
  ('sector.fintech', 'sector.financial_services', false, 'V2I'),
  ('sector.fintech', 'sector.software', false, 'V2I'),
  ('sector.healthtech', 'sector.healthcare_services', false, 'V2I'),
  ('sector.healthtech', 'sector.software', false, 'V2I'),
  ('sector.life_sciences', 'sector.biotechnology', false, 'V2I'),
  ('sector.life_sciences', 'sector.pharmaceuticals', false, 'V2I'),
  ('sector.cybersecurity', 'sector.software', false, 'V2I'),
  ('sector.cybersecurity', 'sector.it_services', false, 'V2I'),
  ('sector.infrastructure', 'sector.it_services', false, 'V2I'),
  ('sector.infrastructure', 'sector.communications_and_networking', false, 'V2I'),
  ('sector.marketplace', 'sector.internet_technology', false, 'V2I'),
  ('sector.marketplace', 'sector.consumer_products_and_services', false, 'V2I'),
  ('sector.deeptech', 'sector.electronics', false, 'V2I'),
  ('sector.deeptech', 'sector.semiconductors', false, 'V2I'),
  ('sector.climate_tech', 'sector.energy_natural_resources', false, 'V2I'),
  ('sector.climate_tech', 'sector.environment', false, 'V2I'),
  ('sector.edtech', 'sector.education_and_training', false, 'V2I'),
  ('sector.edtech', 'sector.software', false, 'V2I'),
  ('sector.robotics', 'sector.industrial_products_and_services', false, 'V2I'),
  ('sector.robotics', 'sector.electronics', false, 'V2I'),
  ('sector.cleantech', 'sector.energy_natural_resources', false, 'V2I'),
  ('sector.cleantech', 'sector.environment', false, 'V2I'),
  ('sector.web3', 'sector.financial_services', false, 'V2I'),
  ('sector.web3', 'sector.internet_technology', false, 'V2I'),
  ('sector.iot', 'sector.electronics', false, 'V2I'),
  ('sector.iot', 'sector.communications_and_networking', false, 'V2I'),
  ('sector.e_commerce', 'sector.distribution_retailing', false, 'V2I'),
  ('sector.e_commerce', 'sector.internet_technology', false, 'V2I'),
  ('sector.blockchain', 'sector.financial_services', false, 'V2I'),
  ('sector.blockchain', 'sector.software', false, 'V2I'),
  ('sector.data', 'sector.software', false, 'V2I'),
  ('sector.data', 'sector.it_services', false, 'V2I'),
  ('sector.proptech', 'sector.real_estate_construction', false, 'V2I'),
  ('sector.proptech', 'sector.software', false, 'V2I'),
  ('sector.medtech', 'sector.medical_devices_and_equipment', false, 'V2I'),
  ('sector.insurtech', 'sector.financial_services', false, 'V2I'),
  ('sector.agtech', 'sector.agriculture_and_fishery', false, 'V2I'),
  ('sector.foodtech', 'sector.food_services_and_products', false, 'V2I'),
  ('sector.consumer_tech', 'sector.consumer_products_and_services', false, 'V2I'),
  ('sector.consumer_tech', 'sector.internet_technology', false, 'V2I'),
  ('sector.spacetech', 'sector.aerospace_and_defense', false, 'V2I'),
  ('sector.hrtech', 'sector.business_products_and_services', false, 'V2I'),
  ('sector.hrtech', 'sector.software', false, 'V2I'),
  ('sector.decarbonization_tech', 'sector.environment', false, 'V2I'),
  ('sector.decarbonization_tech', 'sector.energy_natural_resources', false, 'V2I'),
  ('sector.adtech', 'sector.media_and_entertainment', false, 'V2I'),
  ('sector.adtech', 'sector.internet_technology', false, 'V2I'),
  ('sector.frontiertech', 'sector.electronics', false, 'V2I'),
  ('sector.cloud_computing', 'sector.it_services', false, 'V2I'),
  ('sector.cloud_computing', 'sector.software', false, 'V2I'),
  ('sector.3d_printing', 'sector.manufacturing', false, 'V2I'),
  ('sector.cannabis', 'sector.consumer_products_and_services', false, 'V2I'),
  ('sector.nanotechnology', 'sector.chemicals_and_materials', false, 'V2I')
) as e (from_id, to_id, directed, list)
on conflict do nothing;
