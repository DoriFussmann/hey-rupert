// Convert Intake Interview answers into the engine's match profile, plus warnings for the operator.
//   import { intakeToProfile } from './intake/to-profile.mjs'
//   const { profile, warnings, missing } = intakeToProfile(answers)
// `answers` uses the ids in intake-questions.json. Free text is fine; this normalizes it.
import RME from '../engine/index.mjs';

const ABBR = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const COUNTRY_ALIASES = { 'usa':'United States','us':'United States','u.s.':'United States','united states of america':'United States','america':'United States','uk':'United Kingdom','england':'United Kingdom','britain':'United Kingdom','great britain':'United Kingdom','uae':'United Arab Emirates','south korea':'Korea (South)','korea':'Korea (South)','czech republic':'Czechia','holland':'Netherlands' };
const REQUIRED = ['company_name','website','one_liner','stage','raise_amount','instrument','core_vertical','hq_country','hq_city'];
const REQUIRED_ASK = ['need_lead','revenue','existing_investors','already_pitched','competitors'];

const list = v => Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : String(v ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
const isNone = v => /^(none|no|n\/a|na|nothing|not yet|nobody|-)$/i.test(String(v ?? '').trim());
const ci = (val, options) => options.find(o => o.toLowerCase() === String(val).trim().toLowerCase());

export function parseMoney(s) {
  const m = String(s ?? '').toLowerCase().replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|mm|mn|million|b|bn|billion)?/);
  if (!m) return null; const n = parseFloat(m[1]), u = m[2] || '';
  return n * (/^k|thousand/.test(u) ? 1e3 : /^(m|mm|mn|million)$/.test(u) ? 1e6 : /^(b|bn|billion)$/.test(u) ? 1e9 : 1);
}
export function normStage(s) {
  const t = String(s ?? '').toLowerCase();
  if (!t) return { stage: '' };
  if (/pre[- ]?seed|angel|friends|f&f|family and friends/.test(t)) return { stage: 'Pre-Seed' };
  if (/seed/.test(t)) return { stage: 'Seed', note: /\+|ext|bridge|plus/.test(t) ? 'Seed extension / seed+: consider Series A firms too (broaden Match).' : undefined };
  if (/series\s*a\b|\ba round|^a$/.test(t)) return { stage: 'Series A' };
  if (/series\s*b\b|^b$/.test(t)) return { stage: 'Series B' };
  if (/series\s*[c-z]\b|later|late[- ]stage|^[c-f]$/.test(t)) return { stage: 'Series C and Beyond' };
  if (/growth/.test(t)) return { stage: 'Growth Equity' };
  if (/buy ?out|sale of (the )?company|acquisition|sell the company/.test(t)) return { stage: 'Buyout' };
  if (/recap/.test(t)) return { stage: 'Recapitalization' };
  const exact = ci(s, [...RME.VC_LADDER, ...RME.PE_STAGES]); return { stage: exact || '' };
}
export function normInstrument(s) {
  const t = String(s ?? '').toLowerCase(); const out = new Set();
  if (/safe|convertible|note|equity|priced|preferred|shares|stock/.test(t)) out.add('Equity');
  if (/venture debt|debt|loan|credit/.test(t)) out.add('Debt');
  if (/revenue[- ]based|rbf|royalt/.test(t)) out.add('Royalties');
  if (/mezz/.test(t)) out.add('Mezzanine');
  return out.size ? [...out] : ['Equity'];
}
function normCountry(s) { const t = String(s ?? '').trim(); return ci(t, RME.COUNTRIES) || COUNTRY_ALIASES[t.toLowerCase()] || ''; }
function normState(s) { const t = String(s ?? '').trim(); return ABBR[t.toUpperCase()] || Object.values(ABBR).find(v => v.toLowerCase() === t.toLowerCase()) || ''; }

export function intakeToProfile(a = {}) {
  const warnings = [], missing = [], unasked = [];
  const answered = id => a[id] != null && String(a[id]).trim() !== '' && !(Array.isArray(a[id]) && !a[id].length);
  REQUIRED.forEach(id => { if (!answered(id)) missing.push(id); });
  if (normCountry(a.hq_country) === 'United States' && !answered('hq_state')) missing.push('hq_state');
  REQUIRED_ASK.forEach(id => { if (!answered(id)) unasked.push(id); });

  const { stage, note } = normStage(a.stage); if (note) warnings.push(note);
  if (answered('stage') && !stage) warnings.push(`Stage "${a.stage}" not recognized. Confirm with the founder.`);
  const verticals = list(a.core_vertical).map(v => ci(v, RME.VERTICALS)).filter(Boolean).slice(0, 3);
  if (answered('core_vertical') && !verticals.length) warnings.push('Core vertical is not a taxonomy label. Map it to one of the VERTICALS.');
  let industries = list(a.core_industry).map(v => ci(v, RME.INDUSTRIES)).filter(Boolean).slice(0, 3);
  if (!industries.length && verticals.length) { industries = [...new Set(verticals.flatMap(v => RME.V2I[v] || []))].slice(0, 3); if (industries.length) warnings.push(`Industries derived from verticals: ${industries.join(', ')}. Confirm in the read-back.`); }
  const country = normCountry(a.hq_country); if (answered('hq_country') && !country) warnings.push(`Country "${a.hq_country}" not in the database's country list.`);
  const state = normState(a.hq_state); const usRegion = country === 'United States' && state ? (RME.STATE_REGION[state] || '') : '';
  if (country === 'United States' && answered('hq_state') && !state) warnings.push(`US state "${a.hq_state}" not recognized.`);
  const MARKETS = ['United States','Canada','United Kingdom','Europe','Germany','France','Israel','India','Singapore','Asia','Latin America','Middle East','Africa','Australia','Japan','Brazil','Mexico'];
  const markets = list(a.markets).map(m => ci(m, MARKETS) || COUNTRY_ALIASES[m.toLowerCase()] || '').filter(m => m && m !== country);
  const excl = [...(isNone(a.existing_investors) ? [] : list(a.existing_investors)), ...(isNone(a.already_pitched) ? [] : list(a.already_pitched).map(x => x.split(/[-–:(]/)[0].trim())), ...(isNone(a.no_go) ? [] : list(a.no_go))];
  const firmTypes = answered('investor_types') ? list(a.investor_types).map(t => ci(t, ['Venture Capital Investment Firm','Family Investment Office','Angel Investor Group','Private Equity Investment Firm']) || ({ vc:'Venture Capital Investment Firm', 'family office':'Family Investment Office', 'angel group':'Angel Investor Group', 'angel groups':'Angel Investor Group', pe:'Private Equity Investment Firm' })[t.toLowerCase()]).filter(Boolean) : null;

  // consistency checks: things a human should confirm before running
  const raise = parseMoney(a.raise_amount), rev = /pre[- ]?revenue|no revenue|^0$/i.test(String(a.revenue ?? '')) ? 0 : parseMoney(a.revenue);
  const arr = rev == null ? null : (/mrr|month/i.test(String(a.revenue)) ? rev * 12 : rev);
  const typical = { 'Pre-Seed': [1e5, 2.5e6], 'Seed': [5e5, 6e6], 'Series A': [3e6, 2.5e7], 'Series B': [1e7, 6e7] }[stage];
  if (typical && raise && (raise < typical[0] * 0.5 || raise > typical[1] * 1.5)) warnings.push(`Raising ${a.raise_amount} is unusual for ${stage} (typical ${typical.map(n => '$' + (n >= 1e6 ? n / 1e6 + 'M' : n / 1e3 + 'k')).join('–')}). Confirm the stage.`);
  if (stage === 'Pre-Seed' && arr > 1e6) warnings.push('Pre-seed with >$1M ARR: investors will likely see this as Seed or A.');
  if (stage === 'Series A' && arr === 0) warnings.push('Series A while pre-revenue: confirm, or consider Seed.');
  if (stage && RME.PE_STAGES.includes(stage) && verticals.length && ['AI/ML','SaaS','Web3'].includes(verticals[0])) warnings.push('PE stage with a venture-style vertical: confirm the round type.');
  if (country && country !== 'United States' && markets.includes('United States') && !/delaware|us |u\.s\.|c-?corp/i.test(String(a.entity ?? ''))) warnings.push('Selling into the US but no US entity: many US funds will require a Delaware flip.');

  const notes = [a.traction_proof, a.committed_so_far && `Committed: ${a.committed_so_far}`, a.founders && `Team: ${list(a.founders).join('; ')}`, a.previous_rounds && `Previous: ${a.previous_rounds}`].filter(Boolean).join(' · ');
  const profile = {
    name: a.company_name || '', web: a.website || '', oneliner: a.one_liner || '', model: ci(a.business_model, ['B2B','B2C','B2B2C','Marketplace','Hardware']) || '',
    stage, raise: a.raise_amount ? String(a.raise_amount) : '', instruments: normInstrument(a.instrument), firmTypes: firmTypes && firmTypes.length ? firmTypes : null,
    lead: /need/i.test(String(a.need_lead ?? '')), verticals, industries, country, usRegion, city: a.hq_city || '', markets: [...new Set(markets)],
    arr: a.revenue ? String(a.revenue) : '', growth: a.growth ? String(a.growth) : '', notes, exclusions: [...new Set(excl)].join('\n'),
    waveSize: 100, tune: { bullseye: 0, match: 0, expansion: 0 }, filters: {}, siteN: 50, dropDead: true,
    intake: { competitors: isNone(a.competitors) ? [] : list(a.competitors), entity: a.entity || '', valuation: a.valuation || '', timeline: a.close_timeline || '', warm: list(a.warm_connections), deck: a.deck || '' },
  };
  const ready = !missing.length && !!stage && (verticals.length || industries.length) && !!country;
  return { profile, ready, missing, unasked, warnings };
}
