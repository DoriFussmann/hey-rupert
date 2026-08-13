/* global document, fetch, File */
const state = {
  matched: [],
  unmatched: [],
  updatedSlugs: new Set(),
  confirmed: new Set(),
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

function selectedSources(slug) {
  return [...document.querySelectorAll(`[data-source-slug="${slug}"]:checked`)].map((box) => ({
    label: box.dataset.label,
    url: box.dataset.url,
  }));
}

function renderUnmatched() {
  const panel = document.getElementById("unmatched-panel");
  const list = document.getElementById("unmatched-list");
  list.replaceChildren();
  if (!state.unmatched.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  for (const slug of state.unmatched) {
    const item = document.createElement("li");
    item.className = "unmatched-slug";
    item.textContent = slug;
    list.append(item);
  }
}

function renderMatched() {
  const section = document.getElementById("update-results");
  const list = document.getElementById("update-list");
  list.replaceChildren();
  section.hidden = !state.matched.length;
  for (const row of state.matched) {
    const item = document.createElement("li");
    item.className = "health-item";
    const title = document.createElement("h3");
    title.textContent = `${row.title} (${row.slug})`;
    item.append(title);
    if (row.markerError) {
      const err = document.createElement("p");
      err.className = "unmatched-slug";
      err.textContent = row.markerError;
      item.append(err);
    }
    const compare = document.createElement("div");
    compare.className = "compare";
    const current = document.createElement("section");
    const currentH = document.createElement("h4");
    currentH.textContent = "Current Where Things Stand";
    const currentP = document.createElement("p");
    currentP.textContent = row.currentParagraph || "(not found)";
    current.append(currentH, currentP);
    const proposed = document.createElement("section");
    const proposedH = document.createElement("h4");
    proposedH.textContent = `Proposed (${row.newUpdatedDate || "no date"})`;
    const proposedP = document.createElement("p");
    proposedP.textContent = row.newParagraph || "(empty)";
    proposed.append(proposedH, proposedP);
    compare.append(current, proposed);
    item.append(compare);

    if (row.newSources?.length) {
      const sources = document.createElement("ul");
      for (const source of row.newSources) {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.sourceSlug = row.slug;
        box.dataset.url = source.url;
        box.dataset.label = source.title || source.label || source.url;
        label.append(box, ` ${source.title || source.label || source.url} — ${source.url}`);
        li.append(label);
        sources.append(li);
      }
      item.append(sources);
    }

    const actions = document.createElement("p");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = state.confirmed.has(row.slug) ? "Updated" : "Confirm Update";
    button.disabled = Boolean(row.markerError) || state.confirmed.has(row.slug);
    button.addEventListener("click", () => confirmOne(row.slug));
    actions.append(button);
    item.append(actions);
    list.append(item);
  }
}

async function previewFile(file) {
  const content = await file.text();
  setStatus(`Matching ${file.name}…`);
  const payload = await readJson(
    await fetch("/api/updates/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, content }),
    }),
  );
  state.matched = payload.matched || [];
  state.unmatched = payload.unmatched || [];
  state.confirmed = new Set();
  renderUnmatched();
  renderMatched();
  const unmatchedNote = state.unmatched.length
    ? ` ${state.unmatched.length} unmatched slug(s) flagged.`
    : "";
  setStatus(`Matched ${state.matched.length} article(s).${unmatchedNote}`);
}

async function confirmOne(slug) {
  const row = state.matched.find((item) => item.slug === slug);
  if (!row) return;
  setStatus(`Confirming ${slug}…`);
  await readJson(
    await fetch("/api/updates/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        newParagraph: row.newParagraph,
        newUpdatedDate: row.newUpdatedDate,
        sources: selectedSources(slug),
      }),
    }),
  );
  state.confirmed.add(slug);
  markUpdated(slug);
  renderMatched();
  setStatus(`Updated ${slug}.`);
}

async function confirmAll() {
  const rows = state.matched.filter((row) => !row.markerError && !state.confirmed.has(row.slug));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    setProgress(`Confirming ${i + 1} of ${rows.length}: ${row.slug}`);
    await confirmOne(row.slug);
  }
  setProgress(rows.length ? "Batch confirm finished." : "Nothing left to confirm.");
}

function bindDrop(element, fileInput) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("is-dragover");
  });
  element.addEventListener("dragleave", () => element.classList.remove("is-dragover"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) previewFile(file).catch((error) => setStatus(error.message));
  });
  element.addEventListener("click", () => fileInput.click());
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) previewFile(file).catch((error) => setStatus(error.message));
    fileInput.value = "";
  });
}

bindDrop(document.getElementById("update-drop"), document.getElementById("update-file"));
document.getElementById("confirm-all").addEventListener("click", () => {
  confirmAll().catch((error) => setStatus(error.message));
});
