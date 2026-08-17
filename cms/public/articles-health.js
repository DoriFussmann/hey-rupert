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
  maxExternalLinks: 3,
  scanChoice: null,
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
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Scan & Add External Links";
  add.addEventListener("click", () =>
    scanAndAddExternal([article.slug]).catch((error) => setStatus(error.message)),
  );
  section.append(add);
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
  state.maxExternalLinks = Number(payload.maxExternalLinks) || 3;
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

function modalEls() {
  return {
    modal: document.getElementById("external-scan-modal"),
    progress: document.getElementById("external-scan-progress"),
    title: document.getElementById("external-scan-title"),
    status: document.getElementById("external-scan-status"),
    spinner: document.getElementById("external-scan-spinner"),
    list: document.getElementById("external-scan-suggestions"),
    confirm: document.getElementById("external-scan-confirm"),
    skip: document.getElementById("external-scan-skip"),
    stop: document.getElementById("external-scan-stop"),
  };
}

function openScanModal() {
  const ui = modalEls();
  ui.modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeScanModal() {
  const ui = modalEls();
  ui.modal.hidden = true;
  ui.list.replaceChildren();
  ui.confirm.disabled = true;
  ui.skip.disabled = true;
  ui.spinner.hidden = true;
  document.body.style.overflow = "";
  if (state.scanChoice) state.scanChoice("stop");
  state.scanChoice = null;
}

function waitForScanChoice() {
  return new Promise((resolve) => {
    state.scanChoice = resolve;
  });
}

function setScanMode(mode) {
  const ui = modalEls();
  const reviewing = mode === "review";
  ui.spinner.hidden = mode !== "loading";
  ui.confirm.disabled = !reviewing;
  ui.skip.disabled = !reviewing;
}

function renderScanSuggestions(candidates, slotsRemaining) {
  const ui = modalEls();
  ui.list.replaceChildren();
  let checked = 0;
  for (const row of candidates) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.url = row.url;
    box.dataset.label = row.label;
    const take = checked < slotsRemaining && (row.confidence === "high" || checked === 0);
    box.checked = take;
    if (take) checked += 1;
    const title = document.createElement("strong");
    title.textContent = row.label;
    const link = document.createElement("a");
    link.href = row.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = row.url;
    const meta = document.createElement("p");
    meta.className = "cms-modal__meta";
    meta.textContent = [
      row.confidence === "high" ? "High confidence" : "Low confidence",
      row.source,
      row.reason,
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(box, " ", title);
    item.append(label, link, meta);
    ui.list.append(item);
  }
}

function selectedScanLinks() {
  return [...document.querySelectorAll("#external-scan-suggestions input[type=checkbox]:checked")]
    .map((box) => ({ label: box.dataset.label, url: box.dataset.url }))
    .filter((link) => link.label && link.url);
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

async function scanAndAddExternal(onlySlugs) {
  if (state.busy) return;
  const queue = (onlySlugs || state.articles.map((article) => article.slug))
    .map((slug) => state.articles.find((article) => article.slug === slug))
    .filter(Boolean)
    .filter((article) => (article.externalLinks?.length || 0) < state.maxExternalLinks);
  if (!queue.length) {
    setStatus("Every selected article already has 3 external links.");
    return;
  }

  state.busy = true;
  openScanModal();
  const ui = modalEls();
  let confirmed = 0;
  let skipped = 0;
  let stopped = false;

  try {
    for (let i = 0; i < queue.length; i += 1) {
      const article = queue[i];
      const slotsRemaining = Math.max(
        0,
        state.maxExternalLinks - (article.externalLinks?.length || 0),
      );
      ui.progress.textContent = `Article ${i + 1} of ${queue.length}`;
      ui.title.textContent = article.title;
      ui.status.textContent = "Searching external sources…";
      ui.list.replaceChildren();
      setScanMode("loading");
      setProgress(`Scanning ${i + 1} of ${queue.length}: ${article.slug}`);

      let payload;
      try {
        payload = await readJson(
          await fetch("/api/health/links/propose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: article.slug }),
          }),
        );
      } catch (error) {
        ui.status.textContent = error.message;
        setScanMode("review");
        ui.confirm.disabled = true;
        const choice = await waitForScanChoice();
        if (choice === "stop") {
          stopped = true;
          break;
        }
        skipped += 1;
        continue;
      }

      const candidates = (payload.candidates || []).slice(0, state.maxExternalLinks);
      if (!candidates.length) {
        ui.status.textContent = payload.searchConfigured
          ? "No on-topic external candidates. Skip to continue."
          : "No local candidates. Live search is not configured. Skip to continue.";
        setScanMode("review");
        ui.confirm.disabled = true;
        const choice = await waitForScanChoice();
        if (choice === "stop") {
          stopped = true;
          break;
        }
        skipped += 1;
        continue;
      }

      ui.status.textContent = `Suggested ${candidates.length} source(s). Confirm to add the checked links (${slotsRemaining} slot${slotsRemaining === 1 ? "" : "s"} left).`;
      renderScanSuggestions(candidates, slotsRemaining);
      setScanMode("review");
      const choice = await waitForScanChoice();
      if (choice === "stop") {
        stopped = true;
        break;
      }
      if (choice === "skip") {
        skipped += 1;
        continue;
      }

      const links = selectedScanLinks().slice(0, slotsRemaining);
      if (!links.length) {
        skipped += 1;
        continue;
      }
      ui.status.textContent = "Saving confirmed links…";
      setScanMode("loading");
      await addLinks(article.slug, links);
      article.externalLinks = [...(article.externalLinks || []), ...links];
      confirmed += links.length;
    }
  } finally {
    state.busy = false;
    state.scanChoice = null;
    closeScanModal();
    await loadArticles();
  }

  const summary = stopped
    ? `Stopped after confirming ${confirmed} external link(s). ${skipped} skipped.`
    : `Confirmed ${confirmed} external link(s). ${skipped} article(s) skipped.`;
  setProgress(summary);
  setStatus("External link scan finished.");
}

document.getElementById("connect-all-internal").addEventListener("click", () => {
  connectAllInternal().catch((error) => setStatus(error.message));
});
document.getElementById("scan-add-external").addEventListener("click", () => {
  scanAndAddExternal().catch((error) => setStatus(error.message));
});
document.getElementById("scan-all-diagnostics").addEventListener("click", () => {
  scanDiagnostics().catch((error) => setStatus(error.message));
});
document.getElementById("external-scan-confirm").addEventListener("click", () => {
  if (state.scanChoice) state.scanChoice("confirm");
  state.scanChoice = null;
});
document.getElementById("external-scan-skip").addEventListener("click", () => {
  if (state.scanChoice) state.scanChoice("skip");
  state.scanChoice = null;
});
document.getElementById("external-scan-stop").addEventListener("click", () => {
  if (state.scanChoice) state.scanChoice("stop");
  state.scanChoice = null;
});

setStatus("Loading…");
loadArticles()
  .then(() => setStatus(""))
  .catch((error) => setStatus(error.message));
