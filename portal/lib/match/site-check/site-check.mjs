// Rupert Match: website check. Node 18+, no dependencies.
// Server-side port of site_check.py (same statuses, same output shape), so the website can run it
// as a background job and store results (see docs/ARCHITECTURE.md, "Website check").
//
//   import { checkSite, scanSites } from './site-check.mjs'
//   const result = await checkSite({ id: 'F00001', web: 'https://example.vc' })
//   const all = await scanSites(firms, { concurrency: 24, onProgress: (done, total) => {} })
//
// CLI: node site-check.mjs firms.json [out.json]     (firms.json = [{id, name, web}] or a normalized db with .firms)
//
// Output per firm: { st, why?, code?, title?, desc?, h1?, moved?, stages?, sectors?, check?, tls?, at }
//   st: ok | moved | offtopic | thin | blocked | broken | parked | inactive | none

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PARKED = /domain (is |may be )?for sale|buy this domain|this domain (name )?(is|has been) (registered|parked)|parked (free|domain)|hugedomains|sedoparking|dan\.com|afternic|godaddy\.com\/domainsearch|domain has expired|account (has been )?suspended|website coming soon|under construction/i;
const INACTIVE = /no longer (making|accepting) (new )?investments|not (currently |actively )?(making|accepting) new investments|(fund|firm) (is|has) (closed|wound down)|winding down|ceased (operations|investing)|we have stopped investing/i;
const INVEST = /\b(invest(s|ing|ment|ments|or|ors)?|venture|capital|fund|portfolio|founders?|startups?|private equity|backing|backed|partners?)\b/gi;
const STAGES = { 'Pre-Seed': /pre[- ]?seed/i, 'Seed': /\bseed\b/i, 'Series A': /series a\b/i, 'Series B': /series b\b/i, 'Growth': /\bgrowth[- ](stage|equity)|\blate[- ]stage/i,
  'Buyout': /\bbuy[- ]?outs?\b|\blower[- ]middle[- ]market|\bmiddle[- ]market/i, 'Early stage': /\bearly[- ]stage/i };
const SECTORS = { 'AI/ML': /\b(ai|artificial intelligence|machine learning|ml)\b/i, 'Fintech': /fintech|financial (services|technology)|payments|banking/i,
  'Healthtech': /health ?tech|digital health|healthcare/i, 'Life Sciences': /life sciences|biotech|therapeutics/i, 'Climate': /climate|clean ?tech|decarboni[sz]|energy transition|sustainab/i,
  'SaaS': /\bsaas\b|b2b software|enterprise software/i, 'Cybersecurity': /cyber ?security|\bsecurity\b/i, 'Consumer': /\bconsumer\b|\bd2c\b|\bdtc\b|\bbrands?\b/i,
  'Deeptech': /deep ?tech|frontier tech|hard ?tech|robotics|semiconductor|quantum/i, 'Marketplace': /marketplace/i, 'Edtech': /edtech|education/i, 'Proptech': /proptech|real estate/i,
  'Web3': /web3|crypto|blockchain|defi/i, 'Industrial': /industrial|manufacturing|supply chain|logistics/i, 'Food/Ag': /food ?tech|ag ?tech|agri/i, 'Insurtech': /insurtech|insurance/i,
  'Mobility': /mobility|transportation|automotive/i, 'Space': /space ?tech|aerospace/i };
const MONEY = String.raw`(?:\$|€|£|us\$|usd\s?)\s?\d+(?:[.,]\d+)?\s?(?:k|m|mm|mn|million|thousand|bn|b|billion)?`;
const CHECK = new RegExp(`(${MONEY}\\s?(?:-|–|—|to)\\s?${MONEY}|(?:up to|between|from)\\s${MONEY}(?:\\s?(?:and|to|-|–)\\s?${MONEY})?)`, 'gi');
const CHECK_CTX = /check|ticket|initial investment|invest(s|ing)? (between|from|up to)|first (check|cheque)|cheque|we (lead|write|invest)|commitment/i;

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const textOf = raw => decode(raw.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (raw, name) => { const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = raw.match(new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']*)`, 'i')) || raw.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${n}["']`, 'i'));
  return m ? decode(m[1]).trim() : ''; };
const domainOf = u => { try { return new URL(u.includes('//') ? u : 'http://' + u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

export async function checkSite(firm, { timeoutMs = 15000 } = {}) {
  const out = { st: 'none', at: new Date().toISOString().slice(0, 10) };
  const web = (firm.web || '').trim();
  if (!web) return { ...out, why: 'No website in database' };
  const url = web.startsWith('http') ? web : 'http://' + web;
  const orig = domainOf(url);
  const tries = url.startsWith('http://') ? [url, url.replace('http://', 'https://')] : [url];
  let res = null, raw = null, lastErr = null;
  for (const u of tries) {
    try {
      res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
      if ([401, 403, 429, 503].includes(res.status)) return { ...out, st: 'blocked', code: res.status, why: `Site blocks automated checks (HTTP ${res.status})` };
      raw = (await res.text()).slice(0, 600000);
      break;
    } catch (e) { lastErr = e?.cause?.code || e?.name || String(e); res = null; }
  }
  if (!res) {
    const dns = /ENOTFOUND|EAI_AGAIN/.test(lastErr || '');
    const tls = /CERT|SSL|TLS/i.test(lastErr || '');
    return { ...out, st: 'broken', why: dns ? 'Domain does not resolve' : tls ? `TLS error (${lastErr})` : lastErr === 'TimeoutError' ? 'No response (timeout)' : (lastErr || 'No response') };
  }
  const title = textOf((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).slice(0, 140);
  const desc = (meta(raw, 'description') || meta(raw, 'og:description')).slice(0, 220);
  const h1 = textOf((raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1]).slice(0, 120);
  const body = textOf(raw);
  const blob = [title, desc, h1, body.slice(0, 20000)].join(' ');
  const finalDom = domainOf(res.url || url);
  Object.assign(out, { code: res.status, title, desc, h1 });
  if (finalDom && orig && finalDom !== orig && !finalDom.endsWith('.' + orig) && !orig.endsWith('.' + finalDom)) out.moved = finalDom;
  out.stages = Object.entries(STAGES).filter(([, re]) => re.test(blob)).map(([k]) => k);
  out.sectors = Object.entries(SECTORS).filter(([, re]) => re.test(blob)).map(([k]) => k);
  const scan = body.slice(0, 30000);
  for (const m of scan.matchAll(CHECK)) {
    const ctx = scan.slice(Math.max(0, m.index - 120), m.index + m[0].length + 60);
    if (CHECK_CTX.test(ctx)) { out.check = m[0].trim().slice(0, 40); break; }
  }
  const hits = (blob.match(INVEST) || []).length;
  if (res.status >= 400) Object.assign(out, { st: 'broken', why: `HTTP ${res.status}` });
  else if (PARKED.test(blob.slice(0, 4000))) Object.assign(out, { st: 'parked', why: 'Parked, for sale or placeholder page' });
  else if (INACTIVE.test(blob)) Object.assign(out, { st: 'inactive', why: 'Site says it is not making new investments' });
  else if (body.length < 150 && hits < 2) Object.assign(out, { st: 'thin', why: 'Page has almost no readable text (JavaScript site); title only' });
  else if (hits < 3) Object.assign(out, { st: 'offtopic', why: "Page doesn't read like an investor" });
  else if (out.moved) Object.assign(out, { st: 'moved', why: `Redirects to ${finalDom}: rebrand, merger or acquisition?` });
  else out.st = 'ok';
  return out;
}

export async function scanSites(firms, { concurrency = 24, timeoutMs = 15000, onProgress } = {}) {
  const results = {}; let i = 0, done = 0;
  async function worker() {
    while (i < firms.length) {
      const f = firms[i++];
      try { results[f.id] = await checkSite(f, { timeoutMs }); } catch (e) { results[f.id] = { st: 'broken', why: String(e).slice(0, 80), at: new Date().toISOString().slice(0, 10) }; }
      onProgress?.(++done, firms.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, firms.length) }, worker));
  const summary = {}; for (const r of Object.values(results)) summary[r.st] = (summary[r.st] || 0) + 1;
  return { kind: 'rupert-site-scan', version: 1, scannedAt: new Date().toISOString().slice(0, 19), count: Object.keys(results).length, summary, firms: results };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const [, , inPath, outPath = 'site_scan.json'] = process.argv;
  if (!inPath) { console.error('usage: node site-check.mjs firms.json [out.json]'); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const firms = (Array.isArray(j) ? j : j.firms).map(f => ({ id: f.id, name: f.name, web: f.web }));
  console.log(`Checking ${firms.length} websites…`);
  const scan = await scanSites(firms, { onProgress: (d, t) => { if (d % 250 === 0 || d === t) console.log(`  ${d}/${t}`); } });
  fs.writeFileSync(outPath, JSON.stringify(scan));
  console.log('Done:', scan.summary, '→', outPath);
}
