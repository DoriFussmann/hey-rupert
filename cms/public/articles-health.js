/* global document, fetch */
const INDICATORS = [
  { key: "links", label: "Links", symbol: "L" },
  { key: "meta", label: "Meta", symbol: "M" },
  { key: "schema", label: "Schema", symbol: "S" },
  { key: "sitemap", label: "Sitemap", symbol: "☰" },
  { key: "speed", label: "Speed", symbol: "⚡" },
];

const state = {
  articles: [],
  expanded: new Set(),
  pagespeedConfigured: false,
  searchConfigured: false,
  updatedSlugs: new Set(),
  busy: false,
  proposals: [],
};

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    const snippet = text.slice(0, 240) || "(empty response)";
    throw new Error(
      response.ok
        ? `Unexpected non-JSON response: ${snippet}`
        : `Request failed (${response.status}): ${snippet}`,
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

function setStatus(message) {
  const el = document.getElementById("status");
  if (el) el.textContent = message || "";
}

function setProgress(message) {
  const el = document.getElementById("batch-progress");
  if (el) el.textContent = message || "";
}

function markUpdated(slug) {
  state.updatedSlugs.add(slug);
  const banner = document.getElementById("session-banner");
  banner.hidden = false;
  const n = state.updatedSlugs.size;
  banner.textContent = `${n} article${n === 1 ? "" : "s"} updated this session — remember to commit, push, and deploy.`;
}

function statusOf(article, key) {
  if (key === "links") return article.links?.status || "gray";
  const report = article[key];
  if (key === "speed" && report && report.configured === false) return "gray";
  return report?.status || "gray";
}

function renderDots(article) {
  const wrap = document.createElement("span");
  wrap.className = "health-dots";
  wrap.setAttribute("aria-hidden", "true");
  for (const item of INDICATORS) {
    const dot = document.createElement("span");
    const status = statusOf(article, item.key);
    dot.className = `health-dot is-${status}`;
    dot.dataset.key = item.key;
    dot.textContent = item.symbol;
    dot.title = `${item.label}: ${status}`;
    wrap.append(dot);
  }
  return wrap;
}

function findingsList(findings) {
  const list = document.createElement("ul");
  list.className = "health-findings";
  for (const finding of findings || []) {
    const li = document.createElement("li");
    li.className = finding.ok ? "is-ok" : "is-bad";
    li.textContent = finding.message;
    list.append(li);
  }
  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = "Not yet scanned.";
    list.append(li);
  }
  return list;
}

function renderLinksSection(article) {
  const section = document.createElement("section");
  section.className = "health-section";
  const heading = document.createElement("h3");
  heading.textContent = "Links";
  section.append(heading, findingsList(article.links?.findings));

  const missing = article.links?.missing || [];
  if (missing.length) {
    const list = document.createElement("ul");
    for (const target of missing) {
      const item = document.createElement("li");
      item.append(`${target.title} (${target.slug}) `);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Connect";
      button.addEventListener("click", () => connectOne(article.slug, [target.slug]));
      item.append(button);
      list.append(item);
    }
    section.append(list);
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "Connect All Internal Links";
    all.addEventListener("click", () => connectOne(article.slug));
    section.append(all);
  } else {
    const p = document.createElement("p");
    p.textContent = "All required internal links are present.";
    section.append(p);
  }

  const ext = document.createElement("p");
  ext.textContent = `External links: ${article.externalLinks?.length || 0} / 5`;
  section.append(ext);
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add External Links";
  add.addEventListener("click", () => proposeOne(article.slug));
  const propose = document.createElement("button");
  propose.type = "button";
  propose.textContent = "Propose All External Links";
  propose.addEventListener("click", () => proposeOne(article.slug));
  section.append(add, " ", propose);
  return section;
}

function renderDiagnostic(title, report, extra) {
  const section = document.createElement("section");
  section.className = "health-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (extra) section.append(extra);
  section.append(findingsList(report?.findings));
  return section;
}

function speedExtra(article) {
  const wrap = document.createElement("p");
  if (!state.pagespeedConfigured) {
    wrap.textContent = "not configured";
    return wrap;
  }
  if (!article.publishedUrl) {
    wrap.textContent = "Scan disabled — this article has no published URL.";
    return wrap;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = article.speed?.scanned ? "Rescan Speed" : "Scan Speed";
  button.addEventListener("click", () => scanSpeed(article.slug));
  wrap.append(button);
  if (article.speed?.mobile?.scores || article.speed?.desktop?.scores) {
    const detail = document.createElement("pre");
    detail.className = "health-scores";
    const mobile = article.speed.mobile?.scores || {};
    const desktop = article.speed.desktop?.scores || {};
    detail.textContent = [
      `Mobile — Performance ${mobile.performance ?? "—"}, Accessibility ${mobile.accessibility ?? "—"}, Best Practices ${mobile.bestPractices ?? "—"}, SEO ${mobile.seo ?? "—"}`,
      `Desktop — Performance ${desktop.performance ?? "—"}, Accessibility ${desktop.accessibility ?? "—"}, Best Practices ${desktop.bestPractices ?? "—"}, SEO ${desktop.seo ?? "—"}`,
    ].join("\n");
    wrap.append(detail);
  }
  return wrap;
}

function renderPanel(article) {
  const panel = document.createElement("div");
  panel.className = "health-panel";
  panel.hidden = !state.expanded.has(article.slug);
  const scan = document.createElement("p");
  const scanBtn = document.createElement("button");
  scanBtn.type = "button";
  scanBtn.textContent = "Scan diagnostics";
  scanBtn.addEventListener("click", () => scanDiagnostics(article.slug));
  scan.append(scanBtn);
  panel.append(
    scan,
    renderLinksSection(article),
    renderDiagnostic("Meta", article.meta),
    renderDiagnostic("Schema", article.schema),
    renderDiagnostic("Sitemap", article.sitemap),
    renderDiagnostic("Speed", article.speed, speedExtra(article)),
  );
  return panel;
}

function renderList() {
  const list = document.getElementById("health-list");
  list.replaceChildren();
  if (!state.articles.length) {
    const empty = document.createElement("li");
    empty.className = "health-item";
    empty.style.padding = "0.75rem";
    empty.textContent = "No published articles loaded.";
    list.append(empty);
    return;
  }
  for (const article of state.articles) {
    const item = document.createElement("li");
    item.className = "health-item";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "health-row";
    row.setAttribute("aria-expanded", String(state.expanded.has(article.slug)));
    const title = document.createElement("span");
    title.className = "health-title";
    title.textContent = article.title;
    row.append(title, renderDots(article));
    row.addEventListener("click", () => {
      if (state.expanded.has(article.slug)) state.expanded.delete(article.slug);
      else state.expanded.add(article.slug);
      renderList();
    });
    item.append(row, renderPanel(article));
    list.append(item);
  }
}

function mergeArticle(slug, patch) {
  state.articles = state.articles.map((article) =>
    article.slug === slug ? { ...article, ...patch } : article,
  );
}

async function loadArticles() {
  const payload = await readJson(await fetch("/api/health/articles"));
  state.pagespeedConfigured = Boolean(payload.pagespeedConfigured);
  state.searchConfigured = Boolean(payload.searchConfigured);
  const previous = new Map(state.articles.map((article) => [article.slug, article]));
  state.articles = (payload.articles || []).map((article) => {
    const prior = previous.get(article.slug);
    return {
      ...article,
      meta: prior?.meta ?? article.meta,
      schema: prior?.schema ?? article.schema,
      sitemap: prior?.sitemap ?? article.sitemap,
      speed: article.speed,
    };
  });
  renderList();
  if (!state.articles.length) {
    throw new Error("Health API returned no published articles. Restart the CMS with npm run cms.");
  }
}

async function scanDiagnostics(slug) {
  setStatus(slug ? `Scanning diagnostics for ${slug}…` : "Scanning diagnostics…");
  const payload = await readJson(
    await fetch("/api/health/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slug ? { slug } : {}),
    }),
  );
  for (const row of payload.articles || []) {
    mergeArticle(row.slug, {
      meta: row.meta,
      schema: row.schema,
      sitemap: row.sitemap,
    });
  }
  renderList();
  setStatus("Diagnostics updated.");
}

async function scanSpeed(slug) {
  setStatus(`Scanning PageSpeed for ${slug} (mobile + desktop)…`);
  const payload = await readJson(
    await fetch("/api/health/pagespeed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    }),
  );
  mergeArticle(slug, { speed: payload.speed });
  renderList();
  setStatus(`Speed scan finished for ${slug}.`);
}

async function connectOne(slug, targetSlugs) {
  setStatus(`Connecting internal links for ${slug}…`);
  await readJson(
    await fetch("/api/health/links/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetSlugs ? { slug, targetSlugs } : { slug }),
    }),
  );
  markUpdated(slug);
  await loadArticles();
  setStatus(`Connected internal links for ${slug}.`);
}

async function connectAllInternal() {
  const slugs = state.articles.map((article) => article.slug);
  let added = 0;
  let untouched = 0;
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    setProgress(`Connecting ${i + 1} of ${slugs.length}: ${slug}`);
    const payload = await readJson(
      await fetch("/api/health/links/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      }),
    );
    const count = payload.added?.length || 0;
    if (count) {
      added += count;
      markUpdated(slug);
    } else {
      untouched += 1;
    }
  }
  await loadArticles();
  setProgress(`Connected ${added} internal link(s) across ${slugs.length} articles. ${untouched} already complete.`);
  setStatus("Internal link batch finished.");
}

function renderProposals() {
  const section = document.getElementById("propose-review");
  const list = document.getElementById("propose-list");
  list.replaceChildren();
  if (!state.proposals.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const row of state.proposals) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.confidence === "high";
    box.dataset.slug = row.slug;
    box.dataset.url = row.url;
    box.dataset.label = row.label;
    label.append(
      box,
      ` ${row.articleTitle} — ${row.label} — ${row.url} (${row.source}, ${row.confidence})`,
    );
    const addOne = document.createElement("button");
    addOne.type = "button";
    addOne.textContent = "Add";
    addOne.addEventListener("click", () => {
      addLinks(row.slug, [{ label: row.label, url: row.url }]).catch((error) =>
        setStatus(error.message),
      );
    });
    item.append(label, " ", addOne);
    list.append(item);
  }
}

async function proposeOne(slug) {
  setStatus(`Searching external link candidates for ${slug}…`);
  const payload = await readJson(
    await fetch("/api/health/links/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    }),
  );
  const article = state.articles.find((item) => item.slug === slug);
  const incoming = (payload.candidates || []).map((candidate) => ({
    ...candidate,
    slug,
    articleTitle: article?.title || slug,
  }));
  state.proposals = [
    ...state.proposals.filter((row) => row.slug !== slug),
    ...incoming,
  ];
  renderProposals();
  if (!incoming.length) {
    setStatus(
      payload.searchConfigured
        ? `No on-topic external candidates for ${slug}.`
        : `No local candidates for ${slug}. Live search is not configured.`,
    );
    return;
  }
  setStatus(`Proposed ${incoming.length} candidate(s) for ${slug}. Review before adding.`);
}

async function proposeAllExternal() {
  state.proposals = [];
  const slugs = state.articles.map((article) => article.slug);
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    setProgress(`Proposing ${i + 1} of ${slugs.length}: ${slug}`);
    const payload = await readJson(
      await fetch("/api/health/links/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      }),
    );
    const article = state.articles.find((item) => item.slug === slug);
    for (const candidate of payload.candidates || []) {
      state.proposals.push({
        ...candidate,
        slug,
        articleTitle: article?.title || slug,
      });
    }
  }
  renderProposals();
  setProgress(`Proposed ${state.proposals.length} candidate(s) across ${slugs.length} articles. Nothing written yet.`);
  setStatus("Review proposed external links, then Add Selected.");
}

async function addLinks(slug, links) {
  await readJson(
    await fetch("/api/health/links/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, links }),
    }),
  );
  markUpdated(slug);
  state.proposals = state.proposals.filter(
    (row) => !(row.slug === slug && links.some((link) => link.url === row.url)),
  );
  renderProposals();
  await loadArticles();
  setStatus(`Added ${links.length} external link(s) to ${slug}.`);
}

async function addSelected() {
  const boxes = [...document.querySelectorAll("#propose-list input[type=checkbox]:checked")];
  const bySlug = new Map();
  for (const box of boxes) {
    const slug = box.dataset.slug;
    const list = bySlug.get(slug) || [];
    list.push({ label: box.dataset.label, url: box.dataset.url });
    bySlug.set(slug, list);
  }
  const slugs = [...bySlug.keys()];
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    setProgress(`Adding selected links ${i + 1} of ${slugs.length}: ${slug}`);
    await addLinks(slug, bySlug.get(slug));
  }
  setProgress("");
  setStatus(slugs.length ? "Selected external links added." : "No candidates selected.");
}

document.getElementById("connect-all-internal").addEventListener("click", () => {
  connectAllInternal().catch((error) => setStatus(error.message));
});
document.getElementById("propose-all-external").addEventListener("click", () => {
  proposeAllExternal().catch((error) => setStatus(error.message));
});
document.getElementById("scan-all-diagnostics").addEventListener("click", () => {
  scanDiagnostics().catch((error) => setStatus(error.message));
});
document.getElementById("add-selected").addEventListener("click", () => {
  addSelected().catch((error) => setStatus(error.message));
});
document.getElementById("clear-proposed").addEventListener("click", () => {
  state.proposals = [];
  renderProposals();
});

setStatus("Loading…");
loadArticles()
  .then(() => setStatus(""))
  .catch((error) => setStatus(error.message));
