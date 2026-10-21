// ===== Rupert Match Engine =====
// Pure functions: normalize DB rows, score firms against a client profile, tier them, rank contacts.
const RME = (() => {
  const split = v => (v == null || v === '') ? [] : String(v).split(';').map(s => s.trim()).filter(Boolean);
  const str = v => (v == null) ? '' : String(v).trim();
  const lc = s => str(s).toLowerCase();

  // ---------- taxonomy ----------
  const VC_LADDER = ['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C and Beyond', 'Growth Equity'];
  const PE_STAGES = ['Buyout', 'Recapitalization', 'Acquisition', 'Corporate Divestiture', 'Restructuring', 'Consolidation',
    'Special Situations', 'Going Private', 'Turnaround', 'Ownership Transition', 'PIPE', 'Family Succession',
    'Secondary Purchase', 'Privatization', 'Distressed Debt', 'Shareholder Liquidity', 'Refinancing', 'Bankruptcy'];
  const PE_ADJ = {
    'Buyout': ['Recapitalization', 'Acquisition', 'Ownership Transition', 'Family Succession', 'Going Private'],
    'Recapitalization': ['Buyout', 'Shareholder Liquidity', 'Refinancing', 'Growth Equity'],
    'Acquisition': ['Buyout', 'Consolidation'], 'Consolidation': ['Acquisition', 'Buyout'],
    'Turnaround': ['Restructuring', 'Special Situations', 'Distressed Debt'], 'Restructuring': ['Turnaround', 'Special Situations'],
    'Special Situations': ['Turnaround', 'Restructuring', 'Distressed Debt'], 'Family Succession': ['Ownership Transition', 'Buyout'],
    'Ownership Transition': ['Family Succession', 'Buyout'], 'Secondary Purchase': ['Shareholder Liquidity'],
    'Shareholder Liquidity': ['Secondary Purchase', 'Recapitalization'], 'Corporate Divestiture': ['Buyout', 'Acquisition'],
  };
  const INDUSTRIES = ['Software', 'IT Services', 'Financial Services', 'Healthcare Services', 'Communications & Networking',
    'Consumer Products & Services', 'Distribution/Retailing', 'Media & Entertainment', 'Business Products & Services',
    'Energy/Natural Resources', 'Internet Technology', 'Medical Devices & Equipment', 'Manufacturing', 'Food Services & Products',
    'Biotechnology', 'Chemicals & Materials', 'Industrial Products & Services', 'Education & Training', 'Pharmaceuticals',
    'Diversified', 'Electronics', 'Transportation', 'Environment', 'Telecommunications', 'Real Estate/Construction',
    'Computers & Peripherals', 'Semiconductors', 'Agriculture & Fishery', 'Aerospace & Defense'];
  const VERTICALS = ['AI/ML', 'SaaS', 'Fintech', 'Healthtech', 'Life Sciences', 'Cybersecurity', 'Infrastructure', 'Marketplace',
    'Deeptech', 'Climate Tech', 'Edtech', 'Robotics', 'Cleantech', 'Web3', 'IoT', 'E-commerce', 'Blockchain', 'Data', 'Proptech',
    'Medtech', 'Insurtech', 'Agtech', 'Foodtech', 'Consumer Tech', 'Spacetech', 'HRtech', 'Decarbonization Tech', 'Adtech',
    'Frontiertech', 'Cloud Computing', 'Impact Investing', '3D Printing', 'Cannabis', 'Nanotechnology'];
  // vertical adjacency (used for Expansion-level sector fit)
  const V_ADJ = {
    'AI/ML': ['Data', 'Deeptech', 'SaaS', 'Cloud Computing', 'Frontiertech'], 'SaaS': ['Cloud Computing', 'AI/ML', 'Data', 'HRtech'],
    'Fintech': ['Insurtech', 'Blockchain', 'Web3', 'Proptech'], 'Insurtech': ['Fintech', 'Healthtech'],
    'Healthtech': ['Medtech', 'Life Sciences', 'Insurtech'], 'Medtech': ['Healthtech', 'Life Sciences'], 'Life Sciences': ['Healthtech', 'Medtech'],
    'Cybersecurity': ['Infrastructure', 'Cloud Computing', 'Data'], 'Infrastructure': ['Cloud Computing', 'Cybersecurity', 'Data'],
    'Data': ['AI/ML', 'Cloud Computing', 'SaaS'], 'Cloud Computing': ['Infrastructure', 'SaaS', 'Data'],
    'Marketplace': ['E-commerce', 'Consumer Tech'], 'E-commerce': ['Marketplace', 'Consumer Tech', 'Adtech'], 'Consumer Tech': ['E-commerce', 'Marketplace'],
    'Adtech': ['E-commerce', 'Data'], 'Deeptech': ['Frontiertech', 'Robotics', 'AI/ML', 'Spacetech', 'Nanotechnology'],
    'Frontiertech': ['Deeptech', 'Spacetech'], 'Robotics': ['Deeptech', 'IoT', '3D Printing'], 'IoT': ['Robotics', 'Infrastructure'],
    '3D Printing': ['Robotics', 'Deeptech'], 'Spacetech': ['Deeptech', 'Frontiertech'],
    'Climate Tech': ['Cleantech', 'Decarbonization Tech', 'Impact Investing'], 'Cleantech': ['Climate Tech', 'Decarbonization Tech'],
    'Decarbonization Tech': ['Climate Tech', 'Cleantech'], 'Impact Investing': ['Climate Tech'],
    'Agtech': ['Foodtech', 'Climate Tech'], 'Foodtech': ['Agtech', 'Consumer Tech'], 'Edtech': ['HRtech', 'Consumer Tech'], 'HRtech': ['SaaS', 'Edtech'],
    'Web3': ['Blockchain', 'Fintech'], 'Blockchain': ['Web3', 'Fintech'], 'Proptech': ['Fintech'], 'Cannabis': ['Consumer Tech'], 'Nanotechnology': ['Deeptech'],
  };
  // vertical -> likely industries (for auto-suggest & tie-break)
  const V2I = {
    'AI/ML': ['Software', 'Internet Technology'], 'SaaS': ['Software'], 'Fintech': ['Financial Services', 'Software'],
    'Healthtech': ['Healthcare Services', 'Software'], 'Life Sciences': ['Biotechnology', 'Pharmaceuticals'],
    'Cybersecurity': ['Software', 'IT Services'], 'Infrastructure': ['IT Services', 'Communications & Networking'],
    'Marketplace': ['Internet Technology', 'Consumer Products & Services'], 'Deeptech': ['Electronics', 'Semiconductors'],
    'Climate Tech': ['Energy/Natural Resources', 'Environment'], 'Edtech': ['Education & Training', 'Software'],
    'Robotics': ['Industrial Products & Services', 'Electronics'], 'Cleantech': ['Energy/Natural Resources', 'Environment'],
    'Web3': ['Financial Services', 'Internet Technology'], 'IoT': ['Electronics', 'Communications & Networking'],
    'E-commerce': ['Distribution/Retailing', 'Internet Technology'], 'Blockchain': ['Financial Services', 'Software'],
    'Data': ['Software', 'IT Services'], 'Proptech': ['Real Estate/Construction', 'Software'], 'Medtech': ['Medical Devices & Equipment'],
    'Insurtech': ['Financial Services'], 'Agtech': ['Agriculture & Fishery'], 'Foodtech': ['Food Services & Products'],
    'Consumer Tech': ['Consumer Products & Services', 'Internet Technology'], 'Spacetech': ['Aerospace & Defense'],
    'HRtech': ['Business Products & Services', 'Software'], 'Decarbonization Tech': ['Environment', 'Energy/Natural Resources'],
    'Adtech': ['Media & Entertainment', 'Internet Technology'], 'Frontiertech': ['Electronics'], 'Cloud Computing': ['IT Services', 'Software'],
    'Impact Investing': ['Diversified'], '3D Printing': ['Manufacturing'], 'Cannabis': ['Consumer Products & Services'], 'Nanotechnology': ['Chemicals & Materials'],
  };

  const STATE_REGION = {};
  const _sr = { 'California': ['California'], 'Northwest': ['Washington', 'Oregon', 'Alaska', 'Hawaii'],
    'Southwest': ['Arizona', 'New Mexico', 'Texas', 'Oklahoma', 'Nevada'], 'Rocky Mountains': ['Colorado', 'Utah', 'Wyoming', 'Montana', 'Idaho'],
    'Midwest': ['Illinois', 'Ohio', 'Michigan', 'Indiana', 'Wisconsin', 'Minnesota', 'Iowa', 'Missouri', 'Kansas', 'Nebraska', 'North Dakota', 'South Dakota'],
    'Southeast': ['Florida', 'Georgia', 'North Carolina', 'South Carolina', 'Tennessee', 'Alabama', 'Mississippi', 'Louisiana', 'Kentucky', 'Arkansas', 'West Virginia'],
    'Mid-Atlantic': ['New York', 'New Jersey', 'Pennsylvania', 'Delaware', 'Maryland', 'District of Columbia', 'Virginia'],
    'Northeast': ['Massachusetts', 'Connecticut', 'Rhode Island', 'Vermont', 'New Hampshire', 'Maine'] };
  Object.entries(_sr).forEach(([r, l]) => l.forEach(st => STATE_REGION[st] = r));
  const US_REGIONS = ['California', 'Northwest', 'Southwest', 'Rocky Mountains', 'Midwest', 'Southeast', 'Mid-Atlantic', 'Northeast'];
  const EU_W = ['United Kingdom', 'Ireland', 'France', 'Belgium', 'Netherlands', 'Luxembourg', 'Germany', 'Switzerland', 'Austria', 'Spain',
    'Portugal', 'Italy', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland', 'Greece', 'Cyprus'];
  const EU_C = ['Germany', 'Austria', 'Switzerland', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'];
  const EU_E = ['Poland', 'Romania', 'Bulgaria', 'Ukraine', 'Russia', 'Estonia', 'Latvia', 'Lithuania', 'Croatia', 'Serbia', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia'];
  const ASIA = ['China', 'India', 'Singapore', 'Japan', 'Korea (South)', 'Indonesia', 'Hong Kong', 'Malaysia', 'Vietnam', 'Taiwan', 'Thailand',
    'Philippines', 'Pakistan', 'Sri Lanka', 'Myanmar', 'Cambodia', 'Australia', 'New Zealand'];
  const MIDEAST = ['Israel', 'United Arab Emirates', 'Saudi Arabia', 'Turkey', 'Egypt'];
  const AFRICA = ['South Africa', 'Kenya', 'Nigeria', 'Egypt', 'Ethiopia'];
  const LATAM = ['Brazil', 'Mexico', 'Colombia', 'Chile', 'Argentina'];
  const COUNTRIES = [...new Set(['United States', 'Canada', ...EU_W, ...EU_C, ...EU_E, ...ASIA, ...MIDEAST, ...AFRICA, ...LATAM])].sort();

  function bucketsFor(country) {
    const b = [];
    const eu = EU_W.includes(country) || EU_C.includes(country) || EU_E.includes(country);
    if (eu) b.push('Europe');
    if (EU_W.includes(country)) b.push('Europe (Western)');
    if (EU_C.includes(country)) b.push('Europe (Central)');
    if (EU_E.includes(country)) b.push('Europe (Eastern)');
    if (ASIA.includes(country)) b.push('Asia');
    if (MIDEAST.includes(country)) b.push('Middle East');
    if (AFRICA.includes(country)) b.push('Africa');
    if (LATAM.includes(country)) b.push('Latin America');
    return b;
  }
  function firmRegionOf(country) {
    if (country === 'United States' || country === 'Canada') return 'North America';
    if (EU_W.includes(country) || EU_C.includes(country) || EU_E.includes(country)) return 'Europe';
    if (ASIA.includes(country)) return 'Asia';
    if (LATAM.includes(country)) return 'Latin America';
    return 'Middle East/Africa';
  }

  // ---------- normalize raw sheet rows ----------
  function normalize(firmRows, contactRows, officeRows) {
    const firms = firmRows.map(r => {
      let yr = parseInt(r['Year Founded'], 10); if (!(yr > 1800 && yr <= 2026)) yr = null;
      return {
        id: str(r['FirmID']), name: str(r['Firm Name']), type: str(r['Type of Firm']), region: str(r['Region']), year: yr,
        stages: split(r['Stage']), fin: split(r['Financing']), ind: split(r['Industry']), vert: split(r['Vertical']), geo: split(r['Geography']),
        city: str(r['City']), state: str(r['State']), country: str(r['Country']), web: str(r['Website']), email: str(r['Email']), phone: str(r['Phone']),
        nContacts: parseInt(r['Total Contacts'], 10) || 0, offices: [],
      };
    });
    const byName = new Map(); firms.forEach(f => { const k = lc(f.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f); });
    (officeRows || []).forEach(o => {
      const list = byName.get(lc(o['Firm Name'])); if (!list) return;
      const rec = { city: str(o['City']), country: str(o['Country']), type: str(o['Office Type']) };
      list.forEach(f => { if (!f.offices.some(x => x.city === rec.city && x.country === rec.country)) f.offices.push(rec); });
    });
    const contacts = contactRows.map(r => ({
      fid: str(r['FirmID']), first: str(r['First Name']), last: str(r['Last Name']), prefix: str(r['Prefix']),
      title: str(r['Title']), email: str(r['Work Email']) || '', phone: str(r['Work Phone']),
      city: str(r['City']), state: str(r['State']), country: str(r['Country']), officeType: str(r['Office Type']),
      principal: str(r['Principal Contact']) === 'Yes', lead: str(r['Office Lead Contact']) === 'Yes', matchQ: str(r['Firm Match']),
    }));
    return { firms, contacts, loadedAt: new Date().toISOString() };
  }

  // ---------- contact roles ----------
  function roleOf(title) {
    const t = ' ' + lc(title) + ' ';
    if (/\b(cfo|coo|cco|cto|controller|counsel|legal|compliance|finance|financial officer|accounting|accountant|marketing|communications|human resources|\bhr\b|talent|people|office manager|administrat|assistant|investor relations|\bir\b|platform|operations|chief of staff|treasurer|secretary|tax|fund admin|recruit|portfolio support|design|engineer|business development|growth manager|\bcao\b)\b/.test(t)) return 'ops';
    if (/(venture partner|operating partner|advisor|adviser|entrepreneur in residence|\beir\b|senior advisor|limited partner|board member|chairman emeritus|of counsel)/.test(t)) return 'advisor';
    if (/(general partner|managing partner|founding partner|senior partner|co-managing|\bpartner\b|managing director|founder|\bceo\b|president|chief investment|\bcio\b|chairman|\bchair\b|head of|co-head|managing member|chief executive|general manager)/.test(t)) return 'decision';
    if (/(principal|vice president|\bvp\b|director|investment manager|senior investment|investment professional|investment executive|investment lead|investment officer|portfolio manager|fund manager|venture capitalist|\bmanager\b|investing|investments?\b)/.test(t)) return 'champion';
    if (/(associate|analyst|investor|investment team|scout|fellow)/.test(t)) return 'scout';
    return 'other';
  }
  const ROLE_LABEL = { decision: 'Decision maker', champion: 'Deal champion', scout: 'Scout / screener', advisor: 'Advisor (low priority)', ops: 'Non-investing (skip)', other: 'Unclear role' };

  // ---------- default firm types by stage ----------
  function defaultTypes(stage) {
    if (['Pre-Seed', 'Seed'].includes(stage)) return ['Venture Capital Investment Firm', 'Angel Investor Group', 'Family Investment Office'];
    if (['Series A', 'Series B', 'Series C and Beyond'].includes(stage)) return ['Venture Capital Investment Firm', 'Family Investment Office'];
    if (stage === 'Growth Equity') return ['Venture Capital Investment Firm', 'Private Equity Investment Firm', 'Family Investment Office'];
    return ['Private Equity Investment Firm', 'Family Investment Office'];
  }

  // ---------- scoring ----------
  function stageFit(f, stage) {
    if (f.stages.includes(stage)) return { s: 1, how: 'exact' };
    const i = VC_LADDER.indexOf(stage);
    if (i >= 0) {
      const adj = [VC_LADDER[i - 1], VC_LADDER[i + 1]].filter(Boolean).filter(x => f.stages.includes(x));
      if (adj.length) return { s: 0.5, how: 'adjacent', adj };
      return { s: 0, how: 'none' };
    }
    const adj = (PE_ADJ[stage] || []).filter(x => f.stages.includes(x));
    if (adj.length) return { s: 0.5, how: 'adjacent', adj };
    return { s: 0, how: 'none' };
  }

  function sectorFit(f, p) {
    const V = p.verticals || [], I = p.industries || [];
    const vMatch = V.filter(v => f.vert.includes(v));
    const iMatch = I.filter(i => f.ind.includes(i));
    const adjSet = new Set(V.flatMap(v => V_ADJ[v] || []));
    const vAdj = f.vert.filter(v => adjSet.has(v) && !V.includes(v));
    const generalist = f.ind.includes('Diversified') || f.ind.length >= 15;
    // primary hit: the client's #1 vertical when the firm tags verticals, else the #1 industry
    const primaryHit = (V[0] && f.vert.length) ? f.vert.includes(V[0]) : !!(I[0] && f.ind.includes(I[0]));
    let s = 0, how = 'none';
    if (vMatch.length && iMatch.length) { s = 1; how = 'vertical+industry'; }
    else if (vMatch.length) { s = 0.95; how = 'vertical'; }
    else if (iMatch.length && (!f.vert.length || !V.length)) { s = 0.85; how = 'industry (firm has no vertical tags)'; }
    else if (iMatch.length && vAdj.length) { s = 0.75; how = 'industry + adjacent vertical'; }
    else if (iMatch.length) { s = 0.6; how = 'industry only'; }
    else if (vAdj.length) { s = 0.5; how = 'adjacent vertical'; }
    else if (generalist) { s = 0.4; how = 'generalist'; }
    const specialist = (iMatch.length && f.ind.length <= 4) || (vMatch.length && f.vert.length <= 3);
    const fV = f.vert.length ? (vMatch.length + 0.5 * vAdj.length) / f.vert.length : 0;
    const fI = f.ind.length ? iMatch.length / f.ind.length : 0;
    const focus = Math.min(1, Math.max(fV, fI));
    return { s, how, vMatch, iMatch, vAdj, generalist, specialist, focus, primaryHit };
  }

  // "near": same city, or same US region, or (outside US) same country
  function isNear(c, p) {
    if (!p.country || c.country !== p.country) return false;
    if (p.city && lc(c.city) === lc(p.city)) return true;
    if (p.country === 'United States') return !!(p.usRegion && STATE_REGION[c.state] === p.usRegion);
    return !!p.city ? false : true;
  }
  const nearLabel = p => p.country === 'United States' ? (p.usRegion || p.city || 'US') : (p.city || p.country);

  function rankContacts(f, contacts, p) {
    const big = f.nContacts > 15, early = ['Pre-Seed', 'Seed'].includes(p.stage);
    const base = { decision: big ? 2.6 : 3, champion: big ? 3 : (early ? 2.2 : 2.6), scout: big ? 1.8 : 1.4, advisor: 0.8, other: 1, ops: -10 };
    const out = contacts.map(c => {
      const role = roleOf(c.title);
      let sc = base[role];
      const why = [];
      if (c.country && c.country === p.country) { sc += 0.6; }
      if (p.city && lc(c.city) === lc(p.city)) { sc += 0.9; why.push(`same city (${c.city})`); }
      else if (isNear(c, p)) { sc += 0.6; why.push(`near you (${c.city || c.state})`); }
      else if (c.country && c.country === p.country) why.push(`based in ${c.country}`);
      if (c.principal) { sc += 0.3; why.push('firm principal contact'); }
      if (c.lead) { sc += 0.2; why.push('office lead'); }
      if (/general partner|managing partner|founding partner|founder/.test(lc(c.title)) && !big) { sc += 0.3; }
      if (!c.email) { sc -= 20; why.push('no email on file'); }
      return { ...c, role, roleLabel: ROLE_LABEL[role], score: Math.round(sc * 10) / 10, why };
    }).sort((a, b) => b.score - a.score);
    return out;
  }

  function pickSequence(ranked) {
    const usable = ranked.filter(c => c.email && c.role !== 'ops');
    if (!usable.length) return [];
    const seq = [usable[0]];
    const rest = usable.slice(1).filter(c => c.role !== 'advisor');
    const pref = usable[0].role === 'decision' ? ['champion', 'decision', 'scout'] : ['decision', 'champion', 'scout'];
    const second = pref.map(r => rest.find(c => c.role === r)).find(Boolean) || rest[0];
    if (second) seq.push(second);
    return seq.map((c, i) => ({ ...c, seq: i === 0 ? 'Primary' : 'Backup' }));
  }

  function parseExclusions(text) {
    return str(text).split(/[\n,;]+/).map(s => lc(s).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(s => s.length > 1);
  }
  const domainOf = w => lc(w).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

  // main

  // ---------- geography ----------
  // xb: cross-border mode for a non-US company expanding into the US: 'all' | 'intl' (US funds that also invest abroad) | 'none'
  function geoFit(f, p, firmContactsCountries, xb) {
    const C = p.country, R = p.usRegion, geo = f.geo;
    const usSubs = geo.filter(g => g.startsWith('United States ('));
    if (C === 'United States') {
      if (R && geo.includes(`United States (${R})`)) return { s: 1, how: `invests in ${R} specifically`, local: true, explicit: true };
      if (geo.includes('United States')) return { s: 1, how: 'invests across the US', explicit: true };
      if (usSubs.length) return { s: 0.35, how: `US focus is ${usSubs.map(x => x.slice(15, -1)).join(', ')} only` };
    } else if (C && geo.includes(C)) return { s: 1, how: `invests in ${C}`, explicit: true };
    const b = bucketsFor(C).filter(x => geo.includes(x));
    if (b.length) return { s: 0.8, how: `covers ${b[0]}`, regional: true };
    if (C && firmContactsCountries && firmContactsCountries.has(C)) return { s: 0.6, how: `has people based in ${C}, though ${C} isn't in its stated geography` };
    if (C && f.offices.some(o => o.country === C)) return { s: 0.6, how: `has an office in ${C}, though ${C} isn't in its stated geography` };
    const markets = p.markets || [];
    if (C !== 'United States' && markets.includes('United States') && (geo.includes('United States') || usSubs.length) && xb !== 'none') {
      const intl = geo.some(g => g !== 'United States' && !g.startsWith('United States ('));
      if (intl) return { s: 0.4, how: 'US fund that also invests abroad; you are entering the US', cross: true };
      if (xb === 'all') return { s: 0.25, how: 'US-only fund; usually needs a US entity or HQ', cross: true };
    }
    const m = markets.find(m => geo.includes(m) && !(m === 'United States' && C !== 'United States'));
    if (m && xb !== 'none') return { s: 0.35, how: `invests in ${m}, a market you sell into`, cross: true };
    return { s: 0, how: 'outside geography' };
  }

  // ---------- tuning levels (-3 widest … +3 strictest) ----------
  const LEVELS = [-3, -2, -1, 0, 1, 2, 3];
  const TUNE = {
    bullseye: {
      '-3': { minFocus: 0.1, core: false, explicitGeo: false, maxStages: 99, both: false, minConf: 0 },
      '-2': { minFocus: 0.2, core: false, explicitGeo: false, maxStages: 99, both: false, minConf: 0 },
      '-1': { minFocus: 0.3, core: true, explicitGeo: false, maxStages: 99, both: false, minConf: 0 },
      '0': { minFocus: 0.4, core: true, explicitGeo: false, maxStages: 99, both: false, minConf: 0 },
      '1': { minFocus: 0.5, core: true, explicitGeo: true, maxStages: 4, both: false, minConf: 0.6 },
      '2': { minFocus: 0.6, core: true, explicitGeo: true, maxStages: 3, both: true, minConf: 0.99 },
      '3': { minFocus: 0.75, core: true, explicitGeo: true, maxStages: 2, both: true, minConf: 0.99 },
    },
    match: {
      '-3': { minSector: 0.3, minGeo: 0.35, adj: 'any' },
      '-2': { minSector: 0.4, minGeo: 0.6, adj: 'any' },
      '-1': { minSector: 0.5, minGeo: 0.6, adj: 'strong' },
      '0': { minSector: 0.6, minGeo: 0.8, adj: 'strong' },
      '1': { minSector: 0.75, minGeo: 0.8, adj: 'none' },
      '2': { minSector: 0.85, minGeo: 1, adj: 'none' },
      '3': { minSector: 0.95, minGeo: 1, adj: 'none' },
    },
    expansion: {
      '-3': { weakMin: 0, xb: 'all', generalist: true, minFit: 0 },
      '-2': { weakMin: 0.01, xb: 'all', generalist: true, minFit: 0 },
      '-1': { weakMin: 0.25, xb: 'all', generalist: true, minFit: 0 },
      '0': { weakMin: 0.35, xb: 'intl', generalist: true, minFit: 0 },
      '1': { weakMin: 0.4, xb: 'intl', generalist: false, minFit: 55 },
      '2': { weakMin: 0.5, xb: 'none', generalist: false, minFit: 60 },
      '3': { weakMin: 0.6, xb: 'none', generalist: false, minFit: 65 },
    },
  };
  function rulesText(tier, lvl, p) {
    const t = TUNE[tier][String(lvl)];
    const core = (p.verticals && p.verticals[0]) || (p.industries && p.industries[0]) || 'core sector';
    if (tier === 'bullseye') return [
      `exact ${p.stage}`,
      t.core ? `hits ${core}` : 'any sector hit',
      t.both ? 'vertical and industry both match' : null,
      `your sectors ≥ ${Math.round(t.minFocus * 100)}% of its focus`,
      t.explicitGeo ? 'names your country/region' : 'your country or region',
      t.maxStages < 99 ? `≤ ${t.maxStages} stages` : null,
      t.minConf ? `data confidence ${t.minConf >= 0.99 ? 'high' : 'medium+'}` : null,
      'no generalists',
    ].filter(Boolean);
    if (tier === 'match') return [
      t.adj === 'none' ? `exact ${p.stage}` : t.adj === 'strong' ? `${p.stage}, or next stage if sector fit is strong` : `${p.stage} or next stage`,
      `sector fit ≥ ${Math.round(t.minSector * 100)}`,
      t.minGeo >= 1 ? 'names your country/region' : t.minGeo >= 0.8 ? 'your country or region' : t.minGeo >= 0.6 ? 'country, region or local team' : 'any geography link, incl. markets you sell into',
    ];
    return [
      'two of stage / sector / geography strong',
      t.weakMin ? `third ≥ ${Math.round(t.weakMin * 100)}` : 'third: any link',
      t.xb === 'all' ? 'all US funds if you sell in the US' : t.xb === 'intl' ? 'US funds only if they invest abroad' : 'no cross-border',
      t.generalist ? 'generalists allowed' : 'no generalists',
      t.minFit ? `fit ≥ ${t.minFit}` : null,
    ].filter(Boolean);
  }

  // ---------- data confidence & red flags ----------
  function assess(f, fc, seq, nameDup) {
    const investing = fc.filter(c => c.email && !['ops', 'advisor'].includes(roleOf(c.title)));
    const exactShare = fc.length ? fc.filter(c => c.matchQ.startsWith('Exact')).length / fc.length : 0;
    const generalist = f.ind.includes('Diversified') || f.ind.length >= 15;
    const checks = [
      [f.vert.length > 0, 'vertical tags present', 'no vertical tags'],
      [!generalist, 'focused industry list', `${f.ind.length} industries listed`],
      [f.stages.length <= 8, 'clear stage focus', `${f.stages.length} stages listed`],
      [!!f.year, 'founding year known', 'founding year missing'],
      [investing.length >= 2, `${investing.length} investing contacts`, `${investing.length} investing contact${investing.length === 1 ? '' : 's'}`],
      [exactShare >= 0.5, 'contacts matched on firm + address', 'contacts matched on firm name only'],
    ];
    const conf = checks.filter(c => c[0]).length / checks.length;
    const flags = [];
    const add = (sev, text) => flags.push({ sev, text });
    if (nameDup) add('high', 'Duplicate firm name in DB: confirm it\'s the right entity');
    if (fc.some(c => c.matchQ.includes('ambiguous'))) add('high', 'Contacts linked to an ambiguous firm (multiple HQs)');
    if (!seq.length) add('high', 'No reachable investing contact');
    else if (!['decision', 'champion'].includes(seq[0].role)) add('med', 'Best contact is junior or unclear role');
    if (!f.web) add('med', 'No website on file');
    if (f.stages.length >= 8) add('med', `Multi-stage platform (${f.stages.length} stages)`);
    if (generalist) add('med', 'Generalist mandate');
    if (exactShare < 0.5 && fc.length) add('low', 'People matched by firm name only: check they still work there');
    if (!f.vert.length && f.year && f.year < 2005) add('low', `Older firm (${f.year}) with no vertical tags: data may be stale`);
    return { conf, confLabel: conf >= 0.99 ? 'High' : conf >= 0.6 ? 'Medium' : 'Low', checks: checks.map(c => ({ ok: c[0], text: c[0] ? c[1] : c[2] })), flags, generalist };
  }

  // ---------- fit score (0–100, rarely 100) ----------
  function fitScore(st, se, ge, f, seq, nearPeople, localPeople) {
    const stageFocus = f.stages.length <= 2 ? 1 : f.stages.length === 3 ? 0.7 : f.stages.length <= 5 ? 0.4 : 0.1;
    const prox = nearPeople ? 1 : localPeople ? 0.5 : 0;
    const access = !seq.length ? 0 : ['decision', 'champion'].includes(seq[0].role) ? (seq.length > 1 ? 1 : 0.8) : 0.5;
    const fresh = !f.year ? 0.3 : f.year >= 2020 ? 1 : f.year >= 2015 ? 0.7 : f.year >= 2008 ? 0.4 : 0.2;
    const both = se.vMatch.length && se.iMatch.length ? 1 : 0;
    const parts = {
      Stage: 20 * st.s, Sector: 20 * se.s, Geography: 14 * ge.s, 'Thesis focus': 16 * se.focus, 'Stage focus': 6 * stageFocus,
      'Team near you': 6 * prox, 'Reachable decision maker': 6 * access, 'Fund freshness': 6 * fresh, 'Vertical + industry': 6 * both,
    };
    const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
    return { total: Math.min(100, total), parts };
  }

  // ---------- website check ----------
  const STAGE_WORDS = { 'Pre-Seed': ['Pre-Seed', 'Seed', 'Early stage'], 'Seed': ['Seed', 'Pre-Seed', 'Early stage'], 'Series A': ['Series A', 'Early stage'],
    'Series B': ['Series B', 'Growth'], 'Series C and Beyond': ['Growth'], 'Growth Equity': ['Growth'] };
  const V2SITE = { 'AI/ML': ['AI/ML'], 'Fintech': ['Fintech'], 'Insurtech': ['Insurtech', 'Fintech'], 'Healthtech': ['Healthtech'], 'Medtech': ['Healthtech', 'Life Sciences'],
    'Life Sciences': ['Life Sciences'], 'Climate Tech': ['Climate'], 'Cleantech': ['Climate'], 'Decarbonization Tech': ['Climate'], 'Impact Investing': ['Climate'],
    'SaaS': ['SaaS'], 'Cloud Computing': ['SaaS'], 'Data': ['SaaS', 'AI/ML'], 'HRtech': ['SaaS'], 'Cybersecurity': ['Cybersecurity'], 'Infrastructure': ['SaaS', 'Cybersecurity'],
    'Consumer Tech': ['Consumer'], 'E-commerce': ['Consumer', 'Marketplace'], 'Marketplace': ['Marketplace', 'Consumer'], 'Adtech': ['Consumer', 'SaaS'],
    'Deeptech': ['Deeptech'], 'Robotics': ['Deeptech', 'Industrial'], 'Frontiertech': ['Deeptech'], 'IoT': ['Deeptech', 'Industrial'], '3D Printing': ['Deeptech', 'Industrial'],
    'Nanotechnology': ['Deeptech'], 'Spacetech': ['Space', 'Deeptech'], 'Edtech': ['Edtech'], 'Proptech': ['Proptech'], 'Web3': ['Web3'], 'Blockchain': ['Web3'],
    'Agtech': ['Food/Ag'], 'Foodtech': ['Food/Ag'], 'Cannabis': ['Consumer'] };
  const SITE_LABEL = { ok: 'Website OK', moved: 'Redirects', offtopic: 'Off-topic site', thin: 'Unreadable site', blocked: 'Site blocks checks', broken: 'Dead website', parked: 'Parked domain', inactive: 'Not investing', none: 'No website', unscanned: 'Not scanned' };
  function money(s) {
    const m = String(s || '').toLowerCase().replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|mm|mn|million|b|bn|billion)?/);
    if (!m) return null; const n = parseFloat(m[1]), u = m[2] || '';
    return n * (/^k|thousand/.test(u) ? 1e3 : /^(m|mm|mn|million)$/.test(u) ? 1e6 : /^(b|bn|billion)$/.test(u) ? 1e9 : 1);
  }
  function applySite(r, p) {
    const s = r.site, st = s.st;
    const add = (sev, text) => r.A.flags.push({ sev, text });
    if (st === 'broken') add('high', `Website dead: ${s.why || 'no response'}`);
    else if (st === 'parked') add('high', 'Website is parked or for sale');
    else if (st === 'inactive') add('high', 'Website says it is not making new investments');
    else if (st === 'offtopic') add('high', `Website doesn't read like an investor${s.title ? ` (“${s.title}”)` : ''}`);
    else if (st === 'moved') add('med', `Website redirects to ${s.moved}: rebrand, merger or acquisition?`);
    else if (st === 'blocked' || st === 'thin') add('low', 'Website could not be read automatically: open it to check');
    else if (st === 'none') add('med', 'No website on file');
    else if (st === 'unscanned') add('low', 'Not in the website scan');
    if (st === 'ok' || st === 'moved') r.pros.push(`Website live${s.title ? `: “${s.title.slice(0, 60)}”` : ''}`);
    const want = STAGE_WORDS[p.stage];
    if (want && s.stages && s.stages.length) {
      const hit = s.stages.filter(x => want.includes(x));
      if (hit.length) r.pros.push(`Website mentions ${hit.join(', ')}`);
      else add('med', `Website talks about ${s.stages.join(', ')}, not ${p.stage}`);
    }
    const wantS = [...new Set((p.verticals || []).flatMap(v => V2SITE[v] || []))];
    if (wantS.length && s.sectors && s.sectors.length) {
      const hit = s.sectors.filter(x => wantS.includes(x));
      if (hit.length) r.pros.push(`Website mentions ${hit.join(', ')}`);
    }
    if (s.check) {
      const raise = money(p.raise); const parts = s.check.split(/\s?(?:-|–|—|to|and)\s?/i);
      const lo = money(parts[0]), hi = money(parts[parts.length - 1]) || lo;
      if (raise && lo && lo > raise * 0.8) add('high', `Stated check ${s.check} is too big for a ${p.raise} round`);
      else if (raise && hi && hi < raise * 0.03) add('med', `Stated check ${s.check} is small for a ${p.raise} round`);
      else r.pros.push(`Stated check size: ${s.check}`);
    }
  }

  // ---------- main ----------
  // p.tune = {bullseye:-3..3, match, expansion}; p.filters = {noPlatforms, needDecision, needEmail, foundedAfter, minConf, nearOnly}
  function run(db, p, opts = {}) {
    const types = (p.firmTypes && p.firmTypes.length) ? p.firmTypes : defaultTypes(p.stage);
    const inst = (p.instruments && p.instruments.length) ? p.instruments : ['Equity'];
    const tune = Object.assign({ bullseye: 0, match: 0, expansion: 0 }, p.tune || {});
    const TB = TUNE.bullseye[String(tune.bullseye)], TM = TUNE.match[String(tune.match)], TE = TUNE.expansion[String(tune.expansion)];
    const flt = Object.assign({ noPlatforms: false, needDecision: false, needEmail: false, foundedAfter: 0, minConf: 0, nearOnly: false }, p.filters || {});
    const excl = parseExclusions(p.exclusions);
    const suppressed = opts.suppressed || {};   // firmId -> reason (global "not active" etc.)
    const rejected = opts.rejected || {};       // firmId -> reason (this client)
    const cByFirm = db._cByFirm || (db._cByFirm = (() => { const m = new Map(); db.contacts.forEach(c => { if (!m.has(c.fid)) m.set(c.fid, []); m.get(c.fid).push(c); }); return m; })());
    const nameCount = db._nameCount || (db._nameCount = (() => { const m = new Map(); db.firms.forEach(f => m.set(lc(f.name), (m.get(lc(f.name)) || 0) + 1)); return m; })());
    const funnel = { total: db.firms.length, type: 0, instrument: 0, stage: 0, sector: 0, geo: 0, excluded: 0, suppressed: 0, rejected: 0, filtered: 0 };
    const results = [];
    for (const f of db.firms) {
      const fname = lc(f.name), fdom = domainOf(f.web);
      if (excl.some(e => e === fname || (fdom && e === fdom) || (e.length > 3 && fname.includes(e)))) { funnel.excluded++; continue; }
      if (suppressed[f.id]) { funnel.suppressed++; continue; }
      if (!types.includes(f.type)) continue; funnel.type++;
      if (!f.fin.some(x => inst.includes(x))) continue; funnel.instrument++;
      const st = stageFit(f, p.stage); if (st.s === 0) continue; funnel.stage++;
      const se = sectorFit(f, p); if (se.s === 0) continue; funnel.sector++;
      const fc = cByFirm.get(f.id) || [];
      const ge = geoFit(f, p, new Set(fc.map(c => c.country)), TE.xb); if (ge.s === 0) continue; funnel.geo++;

      const ranked = rankContacts(f, fc, p);
      const seq = pickSequence(ranked);
      const A = assess(f, fc, seq, (nameCount.get(fname) || 0) > 1);
      const localPeople = fc.filter(c => c.country === p.country).length;
      const nearPeople = fc.filter(c => isNear(c, p)).length;
      const fit = fitScore(st, se, ge, f, seq, nearPeople, localPeople);

      // hard filters
      if ((flt.noPlatforms && f.stages.length >= 8) || (flt.needDecision && !(seq[0] && ['decision', 'champion'].includes(seq[0].role))) || (flt.needEmail && !seq.length)
        || (flt.foundedAfter && !(f.year && f.year >= flt.foundedAfter)) || (flt.minConf && A.conf < flt.minConf) || (flt.nearOnly && !nearPeople)) { funnel.filtered++; continue; }

      // tiers cascade: bullseye → match → expansion
      const S = st.s === 1, T = se.s >= 0.6, G = ge.s >= 0.8;
      let tier = null, why = '';
      const bOK = S && se.s >= 0.85 && (TB.core ? se.primaryHit : (se.vMatch.length || se.iMatch.length)) && (TB.explicitGeo ? ge.explicit : ge.s >= 0.8)
        && se.focus >= TB.minFocus && !A.generalist && f.stages.length <= TB.maxStages && (!TB.both || (se.vMatch.length && se.iMatch.length)) && A.conf >= TB.minConf;
      if (bOK) { tier = 'bullseye'; why = 'Right stage, your core sector, your geography, and a focused thesis.'; }
      else {
        const stageOK = S || (st.s === 0.5 && (TM.adj === 'any' ? se.s >= 0.6 : TM.adj === 'strong' ? se.s >= 0.85 : false));
        if (stageOK && se.s >= TM.minSector && ge.s >= TM.minGeo) {
          tier = 'match';
          why = !S ? 'Strong sector and geography; stage is one step off.' : se.s < 0.85 ? 'Stage and geography fit; sector link is broader than your core.' : 'Fits on all three, but the thesis is broad or the data is thin.';
        } else {
          const dims = [st.s, se.s, ge.s], strong = [S, T, G];
          const nStrong = strong.filter(Boolean).length;
          const weak = dims[strong.indexOf(false)];
          if (nStrong >= 2 && (nStrong === 3 || weak >= TE.weakMin) && (TE.generalist || se.how !== 'generalist') && fit.total >= TE.minFit) {
            tier = 'expansion';
            why = (!S ? 'Stage is one step off.' : !T ? 'Sector link is adjacent or generalist.' : 'Geography is a stretch: ' + ge.how + '.') + ' Send after the core tiers.';
          }
        }
      }
      if (!tier) continue;
      if (rejected[f.id]) { funnel.rejected++; }

      const pros = [], cons = [];
      if (se.vMatch.length) pros.push(`Vertical: ${se.vMatch.join(', ')}`);
      if (se.iMatch.length) pros.push(`Industry: ${se.iMatch.join(', ')}`);
      if (se.focus >= 0.5) pros.push(`Your sectors are ${Math.round(se.focus * 100)}% of its focus`);
      if (ge.s >= 0.8) pros.push(`Geography: ${ge.how}`);
      if (st.s === 1) pros.push(`${p.stage} investor` + (f.stages.length <= 3 ? ` (only ${f.stages.join(', ')})` : ''));
      if (nearPeople) pros.push(`${nearPeople} team member${nearPeople > 1 ? 's' : ''} near you`);
      if (f.year && f.year >= 2020) pros.push(`Founded ${f.year}: likely early in deploying`);
      if (st.how === 'adjacent') cons.push(`Stage stretch: lists ${st.adj.join(', ')}, not ${p.stage}`);
      if (se.vAdj.length && !se.vMatch.length) cons.push(`Adjacent vertical only (${se.vAdj.join(', ')})`);
      if (se.how === 'generalist') cons.push('Sector fit is generalist only');
      if (ge.s < 0.8) cons.push(`Geography: ${ge.how}`);
      if (f.type === 'Angel Investor Group') cons.push('Angel group: smaller checks, slower process');
      if (f.type === 'Family Investment Office') cons.push('Family office: thesis and pace vary');
      if (f.type === 'Private Equity Investment Firm' && VC_LADDER.slice(0, 3).includes(p.stage)) cons.push('PE firm at an early stage: confirm the program is active');
      const verify = ['Check size fits your round', 'Active: deals in the last 12 months', 'No competitor in portfolio'];
      if (p.lead) verify.push('Leads rounds at this stage');

      results.push({ f, tier, score: fit.total, fit, st, se, ge, A, pros, cons, verify, why, seq, ranked, nearPeople, localPeople,
        loc: f.country === 'United States' ? `US · ${STATE_REGION[f.state] || 'Other'}` : (f.country || 'Unknown'), rejected: rejected[f.id] || null });
    }
    const order = { bullseye: 0, match: 1, expansion: 2 };
    const tieBreak = (a, b) => b.score - a.score || (b.A.conf - a.A.conf) || (b.f.year || 0) - (a.f.year || 0);
    results.sort((a, b) => order[a.tier] - order[b.tier] || tieBreak(a, b));

    // ---- website check on the top N of each tier (before the wave cap) ----
    const sites = opts.sites || null, siteN = p.siteN == null ? 50 : p.siteN, dropDead = p.dropDead !== false;
    const siteStats = { bullseye: {}, match: {}, expansion: {} }, deadRemoved = [];
    if (sites && siteN !== 0) {
      const seen = { bullseye: 0, match: 0, expansion: 0 };
      for (const r of results) {
        if (r.rejected) continue;
        if (siteN > 0 && seen[r.tier] >= siteN) continue;
        seen[r.tier]++;
        const sc = sites[r.f.id];
        r.site = sc || { st: 'unscanned' };
        const st = r.site.st; siteStats[r.tier][st] = (siteStats[r.tier][st] || 0) + 1;
        applySite(r, p);
        if (dropDead && ['broken', 'parked', 'inactive'].includes(st)) { r.dead = true; deadRemoved.push(r); }
      }
    }
    if (deadRemoved.length) { for (let i = results.length - 1; i >= 0; i--) if (results[i].dead) results.splice(i, 1); }
    funnel.deadSite = deadRemoved.length;
    const wave = p.waveSize > 0 ? p.waveSize : 100;
    let qualifiedBullseye = 0;
    results.forEach(r => { if (r.tier === 'bullseye') { qualifiedBullseye++; if (qualifiedBullseye > wave) { r.tier = 'match'; r.overflow = true; r.why = `Bullseye-grade, but outside your first wave of ${wave}. Send in wave 2.`; } } });
    results.sort((a, b) => order[a.tier] - order[b.tier] || (a.overflow ? 0 : 1) - (b.overflow ? 0 : 1) || tieBreak(a, b));
    const counts = { bullseye: 0, match: 0, expansion: 0 };
    results.forEach(r => { if (!r.rejected) counts[r.tier]++; });
    const people = results.filter(r => !r.rejected).reduce((n, r) => n + r.seq.length, 0);
    return { results, counts, funnel, types, inst, people, qualifiedBullseye, wave, tune, siteStats, deadRemoved, siteN: sites ? siteN : 0 };
  }

  // quick count preview for a tuning change (used by the steppers)
  function preview(db, p, tier, lvl, opts) {
    const q = { ...p, tune: { ...(p.tune || {}), [tier]: lvl } };
    return run(db, q, opts).counts;
  }

  return { normalize, run, preview, rulesText, SITE_LABEL, roleOf, ROLE_LABEL, VC_LADDER, PE_STAGES, INDUSTRIES, VERTICALS, V2I, US_REGIONS, COUNTRIES, STATE_REGION, LEVELS, TUNE, defaultTypes, bucketsFor,
    // Shared with the four-tier engine (lib/match/tiers), unchanged.
    rankContacts, pickSequence, assess, applySite, isNear, parseExclusions, domainOf };
})();
if (typeof module !== 'undefined') module.exports = RME;
