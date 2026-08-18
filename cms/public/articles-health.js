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
  maxExternalLinks: 5,
  scanAbort: false,
  externalPhase: "idle",
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
  ext.textContent = `External links: ${article.externalLinks?.length || 0} / ${state.maxExternalLinks}`;
  section.append(ext);
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
  state.maxExternalLinks = Number(payload.maxExternalLinks) || 5;
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

function reviewEls() {
  return {
    panel: document.getElementById("external-review"),
    title: document.getElementById("external-scan-title"),
    status: document.getElementById("external-scan-status"),
    spinner: document.getElementById("external-scan-spinner"),
    summary: document.getElementById("external-scan-summary"),
    approve: document.getElementById("external-scan-approve"),
    cancel: document.getElementById("external-scan-cancel"),
    list: document.getElementById("health-list"),
    findBtn: document.getElementById("scan-add-external"),
  };
}

function setExternalPhase(phase) {
  state.externalPhase = phase;
  const ui = reviewEls();
  const searching = phase === "searching";
  const review = phase === "review";
  const writing = phase === "writing";
  ui.findBtn.disabled = phase !== "idle";
  ui.approve.disabled = phase !== "review";
  ui.cancel.hidden = phase === "idle" || phase === "writing";
  ui.cancel.disabled = phase === "writing" || phase === "idle";
  ui.spinner.hidden = !searching && !writing;
  ui.panel.hidden = !review && !writing;
  ui.list.hidden = review || writing;
}

function closeExternalReview() {
  const ui = reviewEls();
  ui.summary.replaceChildren();
  ui.status.textContent = "";
  ui.title.textContent = "Review external link candidates";
  setExternalPhase("idle");
}

function unavailableReason(article, payload) {
  if (payload?.reason) return payload.reason;
  if ((article.externalLinks?.length || 0) >= state.maxExternalLinks) {
    return `Already has ${state.maxExternalLinks} external links.`;
  }
  if (payload && payload.searchConfigured === false) {
    return "No local candidates. Live search is not configured.";
  }
  return "No on-topic external candidates.";
}

async function proposeForArticle(article) {
  try {
    const payload = await readJson(
      await fetch("/api/health/links/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: article.slug }),
      }),
    );
    const candidates = (payload.candidates || []).slice(0, 3);
    if (payload.available === false || !candidates.length) {
      return {
        slug: article.slug,
        title: article.title,
        available: false,
        reason: unavailableReason(article, payload),
        candidates: [],
      };
    }
    return {
      slug: article.slug,
      title: article.title,
      available: true,
      reason: null,
      candidates,
    };
  } catch (error) {
    return {
      slug: article.slug,
      title: article.title,
      available: false,
      reason: error.message,
      candidates: [],
    };
  }
}

function syncSkippedState(articleEl) {
  const boxes = [...articleEl.querySelectorAll("input[type=checkbox]")];
  articleEl.classList.toggle(
    "is-skipped",
    boxes.length > 0 && boxes.every((box) => !box.checked),
  );
}

function renderExternalSummary(results) {
  const ui = reviewEls();
  ui.summary.replaceChildren();
  for (const row of results) {
    const articleEl = document.createElement("article");
    articleEl.className = "external-summary__article";
    articleEl.dataset.slug = row.slug;

    const head = document.createElement("div");
    head.className = "external-summary__head";
    const identity = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "external-summary__title";
    title.textContent = row.title;
    const slug = document.createElement("p");
    slug.className = "external-summary__slug";
    slug.textContent = row.slug;
    identity.append(title, slug);
    head.append(identity);

    if (row.available && row.candidates.length) {
      const skip = document.createElement("button");
      skip.type = "button";
      skip.textContent = "Skip";
      skip.addEventListener("click", () => {
        articleEl.querySelectorAll("input[type=checkbox]").forEach((box) => {
          box.checked = false;
        });
        syncSkippedState(articleEl);
      });
      head.append(skip);
      articleEl.append(head);

      const list = document.createElement("ul");
      list.className = "external-summary__list";
      for (const candidate of row.candidates) {
        const item = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.slug = row.slug;
        box.dataset.url = candidate.url;
        box.dataset.label = candidate.label;
        box.addEventListener("change", () => syncSkippedState(articleEl));
        const name = document.createElement("strong");
        name.textContent = candidate.label;
        label.append(box, " ", name);
        const link = document.createElement("a");
        link.href = candidate.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = candidate.url;
        item.append(label, link);
        list.append(item);
      }
      articleEl.append(list);
    } else {
      articleEl.append(head);
      const reason = document.createElement("p");
      reason.className = "external-summary__reason";
      reason.textContent = row.reason || "No candidates available.";
      articleEl.append(reason);
    }

    ui.summary.append(articleEl);
  }
}

function selectedExternalLinks() {
  const bySlug = new Map();
  for (const box of document.querySelectorAll(
    "#external-scan-summary input[type=checkbox]:checked",
  )) {
    const slug = box.dataset.slug;
    const label = box.dataset.label;
    const url = box.dataset.url;
    if (!slug || !label || !url) continue;
    const list = bySlug.get(slug) || [];
    list.push({ label, url });
    bySlug.set(slug, list);
  }
  return bySlug;
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
}

async function findApproveConnectExternal() {
  if (state.busy || state.externalPhase !== "idle") return;
  const queue = state.articles;
  if (!queue.length) {
    setStatus("No published articles to search.");
    return;
  }

  state.busy = true;
  state.scanAbort = false;
  const ui = reviewEls();
  ui.summary.replaceChildren();
  setExternalPhase("searching");

  const results = [];
  try {
    for (let i = 0; i < queue.length; i += 1) {
      if (state.scanAbort) break;
      const article = queue[i];
      setProgress(`Searching ${i + 1} of ${queue.length}: ${article.slug}`);
      results.push(await proposeForArticle(article));
    }

    if (state.scanAbort) {
      closeExternalReview();
      setProgress("External link search cancelled.");
      setStatus("");
      return;
    }

    const ready = results.filter((row) => row.available).length;
    ui.title.textContent = "Review external link candidates";
    ui.status.textContent = ready
      ? `${ready} article${ready === 1 ? "" : "s"} with candidates. Uncheck any you do not want, or skip an article, then approve.`
      : "No articles returned external candidates. You can cancel.";
    renderExternalSummary(results);
    setExternalPhase("review");
    setProgress("Review external link candidates, then approve to write.");
  } catch (error) {
    closeExternalReview();
    setStatus(error.message);
  } finally {
    state.busy = false;
  }
}

async function approveExternalLinks() {
  if (state.busy || state.externalPhase !== "review") return;
  const selected = selectedExternalLinks();
  const queue = [...selected.entries()].filter(([, links]) => links.length);
  const ui = reviewEls();

  if (!queue.length) {
    closeExternalReview();
    setProgress("No external links selected.");
    setStatus("External link review finished — nothing written.");
    return;
  }

  state.busy = true;
  state.scanAbort = false;
  setExternalPhase("writing");
  ui.title.textContent = "Connecting external links";
  ui.status.textContent = "Writing checked links…";
  let written = 0;
  let articles = 0;

  try {
    for (let i = 0; i < queue.length; i += 1) {
      if (state.scanAbort) break;
      const [slug, links] = queue[i];
      setProgress(`Connecting ${i + 1} of ${queue.length}: ${slug}`);
      await addLinks(slug, links);
      written += links.length;
      articles += 1;
    }
  } finally {
    state.busy = false;
    closeExternalReview();
    await loadArticles();
  }

  setProgress(
    `Connected ${written} external link(s) across ${articles} article${articles === 1 ? "" : "s"}.`,
  );
  setStatus("External link review finished.");
}

function cancelExternalFlow() {
  if (state.externalPhase === "writing" || state.externalPhase === "idle") return;
  if (state.externalPhase === "searching") {
    state.scanAbort = true;
    reviewEls().cancel.disabled = true;
    setProgress("Cancelling…");
    return;
  }
  closeExternalReview();
  setProgress("External link review cancelled.");
  setStatus("");
}

document.getElementById("connect-all-internal").addEventListener("click", () => {
  connectAllInternal().catch((error) => setStatus(error.message));
});
document.getElementById("scan-add-external").addEventListener("click", () => {
  findApproveConnectExternal().catch((error) => setStatus(error.message));
});
document.getElementById("scan-all-diagnostics").addEventListener("click", () => {
  scanDiagnostics().catch((error) => setStatus(error.message));
});
document.getElementById("external-scan-approve").addEventListener("click", () => {
  approveExternalLinks().catch((error) => setStatus(error.message));
});
document.getElementById("external-scan-cancel").addEventListener("click", () => {
  cancelExternalFlow();
});
document.getElementById("external-review-cancel").addEventListener("click", () => {
  cancelExternalFlow();
});

setStatus("Loading…");
loadArticles()
  .then(() => setStatus(""))
  .catch((error) => setStatus(error.message));
