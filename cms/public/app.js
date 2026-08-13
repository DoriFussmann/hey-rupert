/* global document, fetch, File */
const page = document.body?.dataset.page;

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function dateInputValue(value) {
  const raw = asString(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return raw.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function countClass(length, min, max) {
  return length >= min && length <= max ? "count-ok" : "count-bad";
}

if (page === "articles") initArticles();
if (page === "team") initTeam();
if (page === "dashboard") initDashboard();

function initArticles() {
  const state = {
    data: {},
    body: "",
    editingSlug: null,
    overwrite: false,
    opened: false,
    team: [],
    articles: [],
    routes: [],
    missing: [],
    invalid: [],
    warnings: [],
    canGenerate: false,
    collision: false,
    busy: false,
    images: {
      image: { id: null, name: "", alt: "" },
      image2: { id: null, name: "", alt: "" },
      image3: { id: null, name: "", alt: "" },
    },
    editingField: null,
    siteUrl: "",
  };

  const batch = {
    rows: [],
    busy: false,
    imageName: "",
  };

  const checklistFields = [
    "title",
    "description",
    "slug",
    "date",
    "author",
    "category",
    "tags",
    "image",
    "imageAlt",
    "robots",
    "schemaType",
    "locale",
    "twitterCard",
    "draft",
    "h1",
    "updatedDate",
    "keywords",
    "canonical",
    "image2",
    "image2Alt",
    "image3",
    "image3Alt",
    "ogTitle",
    "ogDescription",
    "ogImage",
    "internalLinks",
    "externalLinks",
    "faqs",
    "pillarKeyword",
    "supportingKeyword",
    "articleType",
    "targetKeyword",
  ];

  const defaults = {
    robots: "index, follow",
    schemaType: "BlogPosting",
    locale: "en-US",
    twitterCard: "summary_large_image",
    draft: false,
  };

  const mdDrop = document.getElementById("md-drop");
  const mdFile = document.getElementById("md-file");
  const imageDrop = document.getElementById("image-drop");
  const imageFile = document.getElementById("image-file");
  const batchImageDrop = document.getElementById("batch-image-drop");
  const batchImageFile = document.getElementById("batch-image-file");

  bindDrop(mdDrop, (files) => parseMarkdownFiles(files), mdFile);
  mdFile.addEventListener("change", () => {
    if (mdFile.files?.length) parseMarkdownFiles(mdFile.files);
    mdFile.value = "";
  });
  bindDrop(imageDrop, (files) => addImages(files), imageFile);
  imageFile.addEventListener("change", () => {
    if (imageFile.files?.length) addImages(imageFile.files);
    imageFile.value = "";
  });
  bindDrop(batchImageDrop, (files) => applyBatchHero(files[0]), batchImageFile);
  batchImageFile.addEventListener("change", () => {
    if (batchImageFile.files?.[0]) applyBatchHero(batchImageFile.files[0]);
    batchImageFile.value = "";
  });
  document.getElementById("batch-author").addEventListener("change", (event) => {
    applyBatchAuthor(event.target.value);
  });
  document.getElementById("generate-all").addEventListener("click", generateAll);

  document.getElementById("field-h1").addEventListener("input", (event) => {
    state.data.h1 = event.target.value;
    validate();
  });
  document.getElementById("field-author").addEventListener("change", (event) => {
    state.data.author = event.target.value;
    validate();
  });
  document.getElementById("add-internal").addEventListener("click", () => {
    state.data.internalLinks = asArray(state.data.internalLinks);
    state.data.internalLinks.push({ label: "", url: "" });
    renderRepeatables();
    validate();
  });
  document.getElementById("add-external").addEventListener("click", () => {
    state.data.externalLinks = asArray(state.data.externalLinks);
    state.data.externalLinks.push({ label: "", url: "" });
    renderRepeatables();
    validate();
  });
  document.getElementById("add-faq").addEventListener("click", () => {
    state.data.faqs = asArray(state.data.faqs);
    state.data.faqs.push({ question: "", answer: "" });
    renderRepeatables();
    validate();
  });
  document.getElementById("overwrite").addEventListener("change", (event) => {
    state.overwrite = event.target.checked;
    validate();
  });
  document.getElementById("generate").addEventListener("click", generate);

  loadLists().then(renderArticleList).catch((error) => setStatus(error.message));
  syncView();
  window.addEventListener("hashchange", syncView);

  function currentView() {
    return window.location.hash === "#add" ? "add" : "articles";
  }

  function syncView() {
    const view = currentView();
    const articlesView = document.getElementById("view-articles");
    const addView = document.getElementById("view-add");
    if (articlesView) articlesView.hidden = view !== "articles";
    if (addView) addView.hidden = view !== "add";
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.nav === view);
    });
  }

  function showAddView() {
    if (window.location.hash !== "#add") window.location.hash = "add";
    else syncView();
  }

  function showArticlesView() {
    if (window.location.hash !== "#articles" && window.location.hash !== "") {
      window.location.hash = "articles";
    } else {
      syncView();
    }
  }

  function bindDrop(element, onFiles, fileInput) {
    if (!element) return;
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.classList.add("is-dragover");
    });
    element.addEventListener("dragleave", () => {
      element.classList.remove("is-dragover");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("is-dragover");
      const files = event.dataTransfer?.files;
      if (files?.length) onFiles(files);
    });
    if (fileInput) {
      element.addEventListener("click", () => fileInput.click());
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fileInput.click();
        }
      });
    }
  }

  async function loadLists() {
    const [articles, team, routes, config] = await Promise.all([
      readJson(await fetch("/articles")),
      readJson(await fetch("/api/team")),
      readJson(await fetch("/api/routes")),
      readJson(await fetch("/api/config")),
    ]);
    state.articles = articles.articles || [];
    state.team = team.team || [];
    state.routes = routes.routes || [];
    state.siteUrl = String(config.siteUrl || "").replace(/\/+$/, "");
    fillAuthorSelect(document.getElementById("field-author"));
    fillAuthorSelect(document.getElementById("batch-author"));
  }

  function fillAuthorSelect(select) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Select a team member</option>';
    for (const member of state.team) {
      const option = document.createElement("option");
      option.value = member.slug;
      option.textContent = `${member.name} (${member.slug})`;
      select.append(option);
    }
    if (current) select.value = current;
  }

  function emptyImages(data) {
    return {
      image: { id: null, name: "", alt: asString(data?.imageAlt) },
      image2: { id: null, name: "", alt: asString(data?.image2Alt) },
      image3: { id: null, name: "", alt: asString(data?.image3Alt) },
    };
  }

  function normalizeArticleData(data) {
    const next = { ...defaults, ...data };
    if (!next.updatedDate) next.updatedDate = next.date;
    if (!asString(next.h1)) next.h1 = asString(next.title);
    next.internalLinks = asArray(next.internalLinks);
    next.externalLinks = asArray(next.externalLinks);
    next.faqs = asArray(next.faqs);
    return next;
  }

  function articlePayload(target, extra) {
    return {
      data: {
        ...target.data,
        imageAlt: target.images.image.alt,
        image2Alt: target.images.image2.alt || undefined,
        image3Alt: target.images.image3.alt || undefined,
      },
      body: target.body,
      imageId: target.images.image.id,
      image2Id: target.images.image2.id,
      image3Id: target.images.image3.id,
      editingSlug: target.editingSlug,
      overwrite: target.overwrite,
      ...(extra || {}),
    };
  }

  function renderArticleList() {
    const list = document.getElementById("article-list");
    list.replaceChildren();
    if (!state.articles.length) {
      const empty = document.createElement("li");
      empty.textContent = "No articles yet.";
      list.append(empty);
      return;
    }
    for (const article of state.articles) {
      const item = document.createElement("li");
      const card = document.createElement("article");
      card.className = "cms-card";
      const title = document.createElement("a");
      title.className = "cms-card-title";
      title.href = `${state.siteUrl}/articles/${article.slug}/`;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = article.title || article.slug;
      const meta = document.createElement("p");
      meta.className = "cms-card-meta";
      meta.textContent = `${article.slug}${article.draft ? " · draft" : ""}`;
      const actions = document.createElement("div");
      actions.className = "cms-card-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => loadArticle(article.slug));
      const unpublish = document.createElement("button");
      unpublish.type = "button";
      unpublish.textContent = article.draft ? "Publish" : "Unpublish";
      unpublish.addEventListener("click", () => toggleDraft(article.slug, !article.draft));
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => removeArticle(article.slug));
      actions.append(edit, unpublish, del);
      card.append(title, meta, actions);
      item.append(card);
      list.append(item);
    }
  }

  async function parseMarkdownFiles(fileList) {
    showAddView();
    const files = Array.from(fileList || []).filter((file) => file.name.endsWith(".md"));
    if (!files.length) {
      setStatus("Please drop .md files.");
      return;
    }
    if (files.length === 1) {
      hideBatch();
      await parseMarkdown(files[0]);
      return;
    }
    await enterBatch(files);
  }

  async function parseOneMarkdown(file) {
    const form = new FormData();
    form.append("markdown", file);
    return readJson(await fetch("/parse", { method: "POST", body: form }));
  }

  async function parseMarkdown(file) {
    if (!file) return;
    if (!file.name.endsWith(".md")) {
      setStatus("Please drop a .md file.");
      return;
    }
    await runBusy("Parsing markdown…", async () => {
      const parsed = await parseOneMarkdown(file);
      hideBatch();
      openEditor(parsed.data || {}, parsed.body || "", null);
      resetImagesFromFrontmatter();
      await validate();
      setStatus("Markdown parsed. Fill missing fields and drop real images.");
    });
  }

  function resetImagesFromFrontmatter() {
    state.images = emptyImages(state.data);
  }

  function hideBatch() {
    batch.rows = [];
    batch.imageName = "";
    document.getElementById("batch").hidden = true;
    document.getElementById("batch-progress").textContent = "";
    document.getElementById("batch-image-name").textContent = "";
    document.getElementById("batch-author").value = "";
    renderBatchGenerate();
  }

  function hideEditor() {
    state.opened = false;
    document.getElementById("editor").hidden = true;
    renderGenerate();
  }

  function openEditor(data, body, editingSlug) {
    state.data = normalizeArticleData(data);
    state.body = body;
    state.editingSlug = editingSlug;
    state.overwrite = false;
    state.opened = true;
    state.editingField = null;
    document.getElementById("editor").hidden = false;
    document.getElementById("field-h1").value = asString(state.data.h1);
    document.getElementById("field-author").value = asString(state.data.author);
    document.getElementById("overwrite").checked = false;
    renderRepeatables();
    renderImages();
  }

  async function loadArticle(slug) {
    showAddView();
    await runBusy("Loading article…", async () => {
      const payload = await readJson(await fetch(`/api/articles/${encodeURIComponent(slug)}`));
      hideBatch();
      openEditor(payload.data || {}, payload.body || "", slug);
      state.images.image = {
        id: payload.staged?.image?.id || null,
        name: payload.staged?.image?.originalName || "",
        alt: asString(payload.data.imageAlt),
      };
      state.images.image2 = {
        id: payload.staged?.image2?.id || null,
        name: payload.staged?.image2?.originalName || "",
        alt: asString(payload.data.image2Alt),
      };
      state.images.image3 = {
        id: payload.staged?.image3?.id || null,
        name: payload.staged?.image3?.originalName || "",
        alt: asString(payload.data.image3Alt),
      };
      renderImages();
      await validate();
      setStatus(`Editing ${slug}`);
    });
  }

  async function toggleDraft(slug, draft) {
    await runBusy(draft ? "Unpublishing…" : "Publishing…", async () => {
      await readJson(
        await fetch(`/api/articles/${encodeURIComponent(slug)}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
        }),
      );
      await loadLists();
      renderArticleList();
      setStatus(draft ? `Unpublished ${slug}` : `Published ${slug}`);
    });
  }

  async function removeArticle(slug) {
    if (!window.confirm(`Delete ${slug}?`)) return;
    await runBusy("Deleting…", async () => {
      await readJson(
        await fetch(`/api/articles/${encodeURIComponent(slug)}`, { method: "DELETE" }),
      );
      await loadLists();
      renderArticleList();
      setStatus(`Deleted ${slug}`);
    });
  }

  async function addImages(fileList) {
    const file = Array.from(fileList)[0];
    if (!file) return;
    await runBusy("Uploading image…", async () => {
      const form = new FormData();
      form.append("file", file);
      const staged = await readJson(
        await fetch("/api/stage-image", { method: "POST", body: form }),
      );
      state.images.image.id = staged.id;
      state.images.image.name = staged.originalName;
      state.data.imageAlt = state.images.image.alt;
      renderImages();
      await validate();
      setStatus("Image staged. Add alt text of at least 10 characters.");
    });
  }

  function renderImages() {
    const list = document.getElementById("image-slots");
    list.replaceChildren();
    const current = state.images.image;
    const item = document.createElement("li");
    item.append(`Hero image: ${current.id ? current.name : "not uploaded this session"}`);
    const alt = document.createElement("input");
    alt.id = "image-alt";
    alt.type = "text";
    alt.value = current.alt;
    alt.placeholder = "Alt text (min 10 characters)";
    alt.addEventListener("input", () => {
      current.alt = alt.value;
      state.data.imageAlt = alt.value;
      validate();
    });
    item.append(" ", alt);
    list.append(item);
  }

  function renderRepeatables() {
    renderLinkRows("internal-links", "internalLinks");
    renderLinkRows("external-links", "externalLinks");
    const faqs = document.getElementById("faqs");
    faqs.replaceChildren();
    asArray(state.data.faqs).forEach((faq, index) => {
      const item = document.createElement("li");
      const question = document.createElement("input");
      question.value = faq.question || "";
      question.placeholder = "question";
      question.addEventListener("input", () => {
        state.data.faqs[index].question = question.value;
        validate();
      });
      const answer = document.createElement("input");
      answer.value = faq.answer || "";
      answer.placeholder = "answer";
      answer.addEventListener("input", () => {
        state.data.faqs[index].answer = answer.value;
        validate();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        state.data.faqs.splice(index, 1);
        renderRepeatables();
        validate();
      });
      item.append(question, " ", answer, " ", remove);
      faqs.append(item);
    });
  }

  function renderLinkRows(elementId, key) {
    const list = document.getElementById(elementId);
    list.replaceChildren();
    asArray(state.data[key]).forEach((link, index) => {
      const item = document.createElement("li");
      const label = document.createElement("input");
      label.value = link.label || "";
      label.placeholder = "label";
      label.addEventListener("input", () => {
        state.data[key][index].label = label.value;
        validate();
      });
      const url = document.createElement("input");
      url.value = link.url || "";
      url.placeholder = "url";
      url.addEventListener("input", () => {
        state.data[key][index].url = url.value;
        validate();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        state.data[key].splice(index, 1);
        renderRepeatables();
        validate();
      });
      item.append(label, " ", url, " ", remove);
      list.append(item);
    });
  }

  function issuesFor(field, target = state) {
    return [...target.missing, ...target.invalid].filter((issue) => issue.field === field);
  }

  function fieldValue(field, target = state) {
    const value = target.data[field];
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === "boolean") return String(value);
    return asString(value);
  }

  function hiddenFromChecklist(field) {
    return [
      "h1",
      "author",
      "image",
      "imageAlt",
      "image2",
      "image2Alt",
      "image3",
      "image3Alt",
    ].includes(field);
  }

  function renderChecklist() {
    const list = document.getElementById("checklist");
    list.replaceChildren();
    for (const field of checklistFields) {
      if (hiddenFromChecklist(field)) continue;
      const item = document.createElement("li");
      const issues = issuesFor(field);
      const optionalEmpty =
        ["keywords", "canonical", "ogTitle", "ogDescription", "ogImage", "pillarKeyword", "supportingKeyword", "articleType", "targetKeyword", "internalLinks", "externalLinks", "faqs", "updatedDate"].includes(field) &&
        !fieldValue(field, state) &&
        issues.length === 0;
      if (issues.length) {
        item.append(`✗ ${field} — ${issues.map((issue) => issue.message).join("; ")} `);
        item.append(inputFor(field));
      } else if (optionalEmpty) {
        item.append(`${field} (optional)`);
      } else {
        const show = document.createElement("button");
        show.type = "button";
        show.textContent = "Edit";
        show.addEventListener("click", () => {
          state.editingField = field;
          renderChecklist();
        });
        if (state.editingField === field) {
          item.append(`✓ ${field} `);
          item.append(inputFor(field));
        } else {
          item.append(`✓ ${field}: ${displayValue(field)} `);
          item.append(show);
        }
      }
      list.append(item);
    }
    renderPanelBadges();
  }

  function displayValue(field) {
    if (field === "image") {
      return state.images.image.id
        ? state.images.image.name
        : asString(state.data.image) || "(none)";
    }
    if (field === "image2") {
      return state.images.image2.id
        ? state.images.image2.name
        : asString(state.data.image2) || "(none)";
    }
    if (field === "image3") {
      return state.images.image3.id
        ? state.images.image3.name
        : asString(state.data.image3) || "(none)";
    }
    if (field === "draft") return String(Boolean(state.data.draft));
    return fieldValue(field) || "(empty)";
  }

  function inputFor(field, target = state, afterChange = validate) {
    if (field === "draft") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(target.data.draft);
      input.addEventListener("change", () => {
        target.data.draft = input.checked;
        afterChange();
      });
      return input;
    }
    if (field === "date" || field === "updatedDate") {
      const input = document.createElement("input");
      input.type = "date";
      input.value = dateInputValue(target.data[field]);
      input.addEventListener("change", () => {
        target.data[field] = input.value;
        if (field === "date" && !target.data.updatedDate) target.data.updatedDate = input.value;
        afterChange();
      });
      return input;
    }
    if (field === "description") {
      const wrap = document.createElement("span");
      const input = document.createElement("textarea");
      input.value = asString(target.data.description);
      const counter = document.createElement("span");
      const update = () => {
        target.data.description = input.value;
        counter.textContent = ` ${input.value.length}/140–160`;
        counter.className = countClass(input.value.length, 140, 160);
        afterChange();
      };
      input.addEventListener("input", update);
      counter.textContent = ` ${input.value.length}/140–160`;
      counter.className = countClass(input.value.length, 140, 160);
      wrap.append(input, counter);
      return wrap;
    }
    if (field === "title") {
      const wrap = document.createElement("span");
      const input = document.createElement("input");
      input.type = "text";
      input.value = asString(target.data.title);
      const counter = document.createElement("span");
      input.addEventListener("input", () => {
        target.data.title = input.value;
        counter.textContent = ` ${input.value.length}/55–60`;
        counter.className = countClass(input.value.length, 55, 60);
        afterChange();
      });
      counter.textContent = ` ${input.value.length}/55–60`;
      counter.className = countClass(input.value.length, 55, 60);
      wrap.append(input, counter);
      return wrap;
    }
    if (field === "tags" || field === "keywords") {
      const input = document.createElement("input");
      input.type = "text";
      input.value = asArray(target.data[field]).join(", ");
      input.addEventListener("input", () => {
        target.data[field] = input.value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        afterChange();
      });
      return input;
    }
    if (field === "image" || field === "image2" || field === "image3") {
      const note = document.createElement("span");
      note.textContent =
        target === state
          ? " Use the image drop zone above."
          : " Use this row's image drop or the batch hero drop.";
      return note;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = asString(target.data[field]);
    input.addEventListener("input", () => {
      target.data[field] = input.value;
      if (field === "imageAlt") target.images.image.alt = input.value;
      if (field === "image2Alt") target.images.image2.alt = input.value;
      if (field === "image3Alt") target.images.image3.alt = input.value;
      afterChange();
    });
    return input;
  }

  function renderSummary() {
    const summary = document.getElementById("missing-summary");
    const missingNames = state.missing.map((issue) => issue.field);
    const invalidParts = state.invalid.map((issue) => issue.message);
    if (!state.missing.length && !state.invalid.length) {
      summary.textContent = "All required fields present.";
    } else {
      const parts = [];
      if (missingNames.length) parts.push(`Missing: ${[...new Set(missingNames)].join(", ")}`);
      if (invalidParts.length) parts.push(`Invalid: ${invalidParts.join(", ")}`);
      summary.textContent = parts.join(" · ");
    }
    const warnings = document.getElementById("warnings-summary");
    warnings.textContent = state.warnings.length
      ? `Warnings: ${state.warnings.map((issue) => issue.message).join("; ")}`
      : "";
    const collision = document.getElementById("collision");
    collision.hidden = !state.collision && !state.warnings.some((issue) => issue.field === "slug" && issue.message.includes("already exists"));
    document.getElementById("collision-message").textContent = state.collision
      ? `Slug "${asString(state.data.slug)}" already exists. Overwrite or rename.`
      : "";
    renderPanelBadges();
  }

  function renderPanelBadges() {
    const missingFields = [...new Set(state.missing.map((issue) => issue.field))];
    const missingBadge = document.getElementById("missing-badge");
    if (missingBadge) {
      missingBadge.textContent = missingFields.length ? `(${missingFields.length})` : "";
    }
    const incomplete = checklistFields.filter(
      (field) => !hiddenFromChecklist(field) && issuesFor(field).length > 0,
    ).length;
    const checklistBadge = document.getElementById("checklist-badge");
    if (checklistBadge) {
      checklistBadge.textContent = incomplete ? `(${incomplete} incomplete)` : "";
    }
  }

  function generateBlockReason(target = state, { requireOpen } = { requireOpen: true }) {
    if (requireOpen && !target.opened) return "Parse a markdown file or edit an existing article first.";
    if (target.parseError) return `Generate is disabled: ${target.parseError}`;
    if (!target.images.image.id) {
      return "Generate is disabled: hero image path in the file does not count — drop a real image file this session (max 10MB).";
    }
    if (asString(target.images.image.alt).length < 10) {
      return "Generate is disabled: hero image alt text must be at least 10 characters.";
    }
    if (target.missing.length || target.invalid.length) {
      return `Generate is disabled: ${[...target.missing, ...target.invalid].map((issue) => issue.message).join("; ")}`;
    }
    if (target.collision) {
      return `Generate is disabled: slug "${asString(target.data.slug)}" already exists. Check overwrite or rename.`;
    }
    return "";
  }

  function renderGenerate() {
    const reason = generateBlockReason();
    const button = document.getElementById("generate");
    button.disabled = Boolean(reason) || state.busy;
    document.getElementById("generate-reason").textContent = reason;
  }

  async function requestValidation(target) {
    return readJson(
      await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articlePayload(target)),
      }),
    );
  }

  function applyValidation(target, payload) {
    target.missing = payload.missing || [];
    target.invalid = payload.invalid || [];
    target.warnings = payload.warnings || [];
    target.canGenerate = Boolean(payload.canGenerate);
    target.collision = Boolean(payload.collision);
  }

  async function validate() {
    if (!state.opened) return;
    try {
      applyValidation(state, await requestValidation(state));
      renderSummary();
      renderChecklist();
      renderGenerate();
    } catch (error) {
      setStatus(error.message);
      document.getElementById("generate").disabled = true;
      document.getElementById("generate-reason").textContent =
        `Generate is disabled: validation failed (${error.message})`;
    }
  }

  async function generate() {
    const reason = generateBlockReason();
    if (reason) {
      setStatus(reason);
      return;
    }
    await runBusy("Generating article…", async () => {
      const payload = await readJson(
        await fetch("/api/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(articlePayload(state)),
        }),
      );
      await loadLists();
      renderArticleList();
      showArticlesView();
      setStatus(`Generated ${payload.slug}. llms.txt rebuilt.`);
    });
  }

  async function runBusy(pendingMessage, fn) {
    if (state.busy) return;
    state.busy = true;
    renderGenerate();
    renderBatchGenerate();
    setStatus(pendingMessage);
    try {
      await fn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      state.busy = false;
      renderGenerate();
      renderBatchGenerate();
    }
  }

  function compactStatus(row) {
    if (row.parseError) return `Parse failed: ${row.parseError}`;
    const block = generateBlockReason(row, { requireOpen: false });
    if (block) return block.replace("Generate is disabled: ", "");
    const missingNames = row.missing.map((issue) => issue.field);
    const invalidParts = row.invalid.map((issue) => issue.message);
    if (!row.missing.length && !row.invalid.length && !row.collision) {
      return "All required fields present.";
    }
    const parts = [];
    if (missingNames.length) parts.push(`Missing: ${[...new Set(missingNames)].join(", ")}`);
    if (invalidParts.length) parts.push(`Invalid: ${invalidParts.join(", ")}`);
    if (row.collision) parts.push(`Slug "${asString(row.data.slug)}" already exists`);
    return parts.join(" · ");
  }

  function generateStatusLabel(row) {
    if (row.generateStatus === "done") return "✓ done";
    if (row.generateStatus === "failed") return `✗ failed: ${row.generateError || "unknown error"}`;
    if (row.generateStatus === "generating") return "generating…";
    if (row.generateStatus === "pending") return "pending";
    return "";
  }

  function createBatchRow(filename, data, body, parseError) {
    return {
      id: `${filename}-${Math.random().toString(16).slice(2)}`,
      filename,
      data: normalizeArticleData(data || {}),
      body: body || "",
      images: emptyImages(data || {}),
      editingSlug: null,
      overwrite: false,
      opened: true,
      missing: [],
      invalid: [],
      warnings: [],
      canGenerate: false,
      collision: false,
      parseError: parseError || "",
      generateStatus: null,
      generateError: "",
      panelOpen: false,
    };
  }

  async function enterBatch(files) {
    hideEditor();
    document.getElementById("batch").hidden = false;
    batch.rows = [];
    batch.imageName = "";
    document.getElementById("batch-image-name").textContent = "";
    document.getElementById("batch-author").value = "";
    await runBusy(`Parsing ${files.length} markdown files…`, async () => {
      for (const file of files) {
        try {
          const parsed = await parseOneMarkdown(file);
          batch.rows.push(createBatchRow(file.name, parsed.data || {}, parsed.body || ""));
        } catch (error) {
          batch.rows.push(
            createBatchRow(file.name, {}, "", error instanceof Error ? error.message : String(error)),
          );
        }
      }
      await validateAllBatchRows();
      const failed = batch.rows.filter((row) => row.parseError).length;
      setStatus(
        failed
          ? `Batch: parsed ${files.length - failed} of ${files.length} files (${failed} failed).`
          : `Batch: parsed ${files.length} files. Set author and hero image, then generate.`,
      );
    });
  }

  async function validateBatchRow(row, { skipRender } = {}) {
    if (row.parseError) {
      row.canGenerate = false;
      if (!skipRender) renderBatch();
      return;
    }
    try {
      applyValidation(row, await requestValidation(row));
    } catch (error) {
      row.missing = [];
      row.invalid = [
        {
          field: "slug",
          message: error instanceof Error ? error.message : String(error),
        },
      ];
      row.canGenerate = false;
    }
    if (!skipRender) renderBatch();
  }

  async function validateAllBatchRows() {
    for (const row of batch.rows) {
      await validateBatchRow(row, { skipRender: true });
    }
    renderBatch();
  }

  async function applyBatchAuthor(author) {
    for (const row of batch.rows) {
      if (row.parseError) continue;
      row.data.author = author;
    }
    await validateAllBatchRows();
  }

  async function stageImageFile(file) {
    const form = new FormData();
    form.append("file", file);
    return readJson(await fetch("/api/stage-image", { method: "POST", body: form }));
  }

  async function applyBatchHero(file) {
    if (!file || !batch.rows.length) return;
    await runBusy("Uploading batch hero image…", async () => {
      const staged = await stageImageFile(file);
      batch.imageName = staged.originalName;
      document.getElementById("batch-image-name").textContent = `Batch hero: ${staged.originalName}`;
      for (const row of batch.rows) {
        if (row.parseError) continue;
        row.images.image.id = staged.id;
        row.images.image.name = staged.originalName;
      }
      await validateAllBatchRows();
      setStatus("Batch hero image applied to every row. A row can still override with its own image.");
    });
  }

  async function applyRowHero(row, file) {
    if (!file) return;
    await runBusy("Uploading row hero image…", async () => {
      const staged = await stageImageFile(file);
      row.images.image.id = staged.id;
      row.images.image.name = staged.originalName;
      await validateBatchRow(row);
      setStatus(`Hero override applied to ${row.filename}.`);
    });
  }

  function renderBatch() {
    const list = document.getElementById("batch-rows");
    list.replaceChildren();
    for (const row of batch.rows) {
      const item = document.createElement("li");
      const heading = document.createElement("p");
      const slug = asString(row.data.slug) || "(no slug)";
      const status = generateStatusLabel(row);
      heading.textContent = `${row.filename} · ${slug}${status ? ` · ${status}` : ""}`;
      item.append(heading);

      const details = document.createElement("details");
      details.open = Boolean(row.panelOpen) || Boolean(row.parseError);
      details.addEventListener("toggle", () => {
        row.panelOpen = details.open;
      });
      const summary = document.createElement("summary");
      summary.textContent = compactStatus(row);
      details.append(summary);

      if (row.parseError) {
        const note = document.createElement("p");
        note.textContent = row.parseError;
        details.append(note);
      } else {
        const authorLabel = document.createElement("p");
        const authorSelect = document.createElement("select");
        fillAuthorSelect(authorSelect);
        authorSelect.value = asString(row.data.author);
        authorSelect.addEventListener("change", () => {
          row.data.author = authorSelect.value;
          validateBatchRow(row);
        });
        authorLabel.append("author ", authorSelect);
        details.append(authorLabel);

        const imageDrop = document.createElement("p");
        imageDrop.tabIndex = 0;
        imageDrop.className = "cms-drop";
        imageDrop.setAttribute("role", "button");
        imageDrop.textContent = row.images.image.id
          ? `Row hero: ${row.images.image.name} — click or drop another image to override`
          : "Click or drop a hero image to override this row";
        const imageInput = document.createElement("input");
        imageInput.type = "file";
        imageInput.className = "cms-sr-only";
        imageInput.accept = "image/jpeg,image/png,image/webp,image/gif,image/avif";
        imageInput.addEventListener("change", () => {
          if (imageInput.files?.[0]) applyRowHero(row, imageInput.files[0]);
          imageInput.value = "";
        });
        bindDrop(imageDrop, (files) => applyRowHero(row, files[0]), imageInput);
        details.append(imageDrop, imageInput);

        const missingList = document.createElement("ul");
        for (const field of checklistFields) {
          const issues = issuesFor(field, row);
          if (!issues.length) continue;
          const line = document.createElement("li");
          line.append(`✗ ${field} — ${issues.map((issue) => issue.message).join("; ")} `);
          if (field !== "author" && field !== "image") {
            line.append(inputFor(field, row, () => validateBatchRow(row)));
          }
          missingList.append(line);
        }
        details.append(missingList);

        if (row.collision) {
          const collision = document.createElement("p");
          const overwrite = document.createElement("input");
          overwrite.type = "checkbox";
          overwrite.checked = row.overwrite;
          overwrite.addEventListener("change", () => {
            row.overwrite = overwrite.checked;
            validateBatchRow(row);
          });
          collision.append(
            `Slug "${asString(row.data.slug)}" already exists. `,
            overwrite,
            " Overwrite existing file",
          );
          details.append(collision);
        }
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        batch.rows = batch.rows.filter((itemRow) => itemRow.id !== row.id);
        renderBatch();
      });
      item.append(details, remove);
      list.append(item);
    }
    renderBatchGenerate();
  }

  function batchBlockReason() {
    if (!batch.rows.length) return "Drop two or more .md files to use batch upload.";
    if (batch.rows.some((row) => row.parseError)) {
      return "Generate All is disabled: remove or fix files that failed to parse.";
    }
    const blocked = batch.rows
      .map((row) => ({ row, reason: generateBlockReason(row, { requireOpen: false }) }))
      .filter((item) => item.reason);
    if (blocked.length) {
      const first = blocked[0];
      return `Generate All is disabled (${blocked.length} row${blocked.length === 1 ? "" : "s"}): ${asString(first.row.data.slug) || first.row.filename} — ${first.reason.replace("Generate is disabled: ", "")}`;
    }
    return "";
  }

  function renderBatchGenerate() {
    const reason = batchBlockReason();
    const button = document.getElementById("generate-all");
    button.disabled = Boolean(reason) || state.busy || batch.busy;
    document.getElementById("batch-generate-reason").textContent = reason;
  }

  async function generateAll() {
    const reason = batchBlockReason();
    if (reason) {
      setStatus(reason);
      return;
    }
    const total = batch.rows.length;
    batch.busy = true;
    renderBatchGenerate();
    for (const row of batch.rows) {
      row.generateStatus = "pending";
      row.generateError = "";
    }
    renderBatch();
    try {
      for (let index = 0; index < batch.rows.length; index += 1) {
        const row = batch.rows[index];
        const slug = asString(row.data.slug) || row.filename;
        const progress = `Generating ${index + 1} of ${total}: ${slug}`;
        document.getElementById("batch-progress").textContent = progress;
        setStatus(progress);
        row.generateStatus = "generating";
        renderBatch();
        try {
          await readJson(
            await fetch("/api/articles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(articlePayload(row, { skipLlmsTxt: true })),
            }),
          );
          row.generateStatus = "done";
          row.generateError = "";
        } catch (error) {
          row.generateStatus = "failed";
          row.generateError = error instanceof Error ? error.message : String(error);
        }
        renderBatch();
      }
      await readJson(await fetch("/api/llms-txt", { method: "POST" }));
      await loadLists();
      renderArticleList();
      const ok = batch.rows.filter((row) => row.generateStatus === "done").length;
      const fail = batch.rows.filter((row) => row.generateStatus === "failed").length;
      const done = `Batch complete: ${ok} generated, ${fail} failed. llms.txt rebuilt once.`;
      document.getElementById("batch-progress").textContent = done;
      setStatus(done);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      batch.busy = false;
      renderBatchGenerate();
    }
  }
}

function initTeam() {
  const form = document.getElementById("team-form");
  let originalSlug = "";

  loadTeam().catch((error) => setStatus(error.message));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Saving team member…");
    try {
      const body = new FormData();
      body.append("name", document.getElementById("team-name").value);
      body.append("slug", document.getElementById("team-slug").value);
      body.append("role", document.getElementById("team-role").value);
      body.append("bio", document.getElementById("team-bio").value);
      body.append("credentials", document.getElementById("team-credentials").value);
      body.append("sameAs", document.getElementById("team-sameas").value);
      if (originalSlug) body.append("originalSlug", originalSlug);
      const photo = document.getElementById("team-photo").files?.[0];
      if (photo) body.append("photo", photo);
      else if (originalSlug) body.append("keepExistingPhoto", "true");
      const payload = await readJson(await fetch("/api/team", { method: "POST", body }));
      originalSlug = payload.slug;
      form.reset();
      originalSlug = "";
      await loadTeam();
      setStatus(`Saved ${payload.slug}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  async function loadTeam() {
    const payload = await readJson(await fetch("/api/team"));
    const list = document.getElementById("team-list");
    list.replaceChildren();
    for (const member of payload.team || []) {
      const item = document.createElement("li");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        originalSlug = member.slug;
        document.getElementById("team-name").value = member.name || "";
        document.getElementById("team-slug").value = member.slug || "";
        document.getElementById("team-role").value = member.role || "";
        document.getElementById("team-bio").value = member.bio || "";
        document.getElementById("team-credentials").value = member.credentials || "";
        document.getElementById("team-sameas").value = asArray(member.sameAs).join("\n");
        setStatus(`Editing ${member.slug}. Leave photo empty to keep the existing file.`);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        setStatus("Deleting…");
        try {
          await readJson(
            await fetch(`/api/team/${encodeURIComponent(member.slug)}`, { method: "DELETE" }),
          );
          await loadTeam();
          setStatus(`Deleted ${member.slug}`);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      });
      item.append(`${member.name} (${member.slug}) `, edit, " ", del);
      list.append(item);
    }
  }
}

function initDashboard() {
  setStatus("Loading…");
  fetch("/articles")
    .then(readJson)
    .then((payload) => {
      const body = document.getElementById("dashboard-body");
      body.replaceChildren();
      for (const article of payload.articles || []) {
        const row = document.createElement("tr");
        const values = [
          article.title,
          article.slug,
          String(Boolean(article.draft)),
          String(asArray(article.internalLinks).length),
          String(asArray(article.externalLinks).length),
          String(asArray(article.faqs).length),
          dateInputValue(article.updatedDate || article.date),
        ];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        body.append(row);
      }
      setStatus("");
    })
    .catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
}
