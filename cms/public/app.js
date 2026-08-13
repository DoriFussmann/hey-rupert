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

  bindDrop(mdDrop, (files) => parseMarkdown(files[0]));
  mdFile.addEventListener("change", () => {
    if (mdFile.files?.[0]) parseMarkdown(mdFile.files[0]);
  });
  bindDrop(imageDrop, (files) => addImages(files));
  imageFile.addEventListener("change", () => {
    if (imageFile.files?.length) addImages(imageFile.files);
    imageFile.value = "";
  });

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
  document.getElementById("preview-jsonld").addEventListener("click", previewJsonLd);
  document.getElementById("generate").addEventListener("click", generate);

  loadLists().then(renderArticleList).catch((error) => setStatus(error.message));

  function bindDrop(element, onFiles) {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      const files = event.dataTransfer?.files;
      if (files?.length) onFiles(files);
    });
  }

  async function loadLists() {
    const [articles, team, routes] = await Promise.all([
      readJson(await fetch("/articles")),
      readJson(await fetch("/api/team")),
      readJson(await fetch("/api/routes")),
    ]);
    state.articles = articles.articles || [];
    state.team = team.team || [];
    state.routes = routes.routes || [];
    const select = document.getElementById("field-author");
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
      item.append(
        `${article.title} (${article.slug})${article.draft ? " [draft]" : ""} `,
        edit,
        " ",
        unpublish,
        " ",
        del,
      );
      list.append(item);
    }
  }

  async function parseMarkdown(file) {
    if (!file) return;
    if (!file.name.endsWith(".md")) {
      setStatus("Please drop a .md file.");
      return;
    }
    await runBusy("Parsing markdown…", async () => {
      const form = new FormData();
      form.append("markdown", file);
      const parsed = await readJson(
        await fetch("/parse", { method: "POST", body: form }),
      );
      openEditor(parsed.data || {}, parsed.body || "", null);
      resetImagesFromFrontmatter();
      await validate();
      setStatus("Markdown parsed. Fill missing fields and drop real images.");
    });
  }

  function resetImagesFromFrontmatter() {
    state.images = {
      image: { id: null, name: "", alt: asString(state.data.imageAlt) },
      image2: { id: null, name: "", alt: asString(state.data.image2Alt) },
      image3: { id: null, name: "", alt: asString(state.data.image3Alt) },
    };
  }

  function openEditor(data, body, editingSlug) {
    state.data = { ...defaults, ...data };
    if (!state.data.updatedDate) state.data.updatedDate = state.data.date;
    if (!asString(state.data.h1)) state.data.h1 = asString(state.data.title);
    state.data.internalLinks = asArray(state.data.internalLinks);
    state.data.externalLinks = asArray(state.data.externalLinks);
    state.data.faqs = asArray(state.data.faqs);
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
    await runBusy("Loading article…", async () => {
      const payload = await readJson(await fetch(`/api/articles/${encodeURIComponent(slug)}`));
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

  function nextImageSlot() {
    if (!state.images.image.id) return "image";
    if (!state.images.image2.id) return "image2";
    if (!state.images.image3.id) return "image3";
    return null;
  }

  async function addImages(fileList) {
    const files = Array.from(fileList);
    await runBusy("Uploading image…", async () => {
      for (const file of files) {
        const slot = nextImageSlot();
        if (!slot) {
          setStatus("Only 3 images can be attached.");
          return;
        }
        const form = new FormData();
        form.append("file", file);
        const staged = await readJson(
          await fetch("/api/stage-image", { method: "POST", body: form }),
        );
        state.images[slot].id = staged.id;
        state.images[slot].name = staged.originalName;
        if (slot === "image") state.data.imageAlt = state.images.image.alt;
        if (slot === "image2") state.data.image2Alt = state.images.image2.alt;
        if (slot === "image3") state.data.image3Alt = state.images.image3.alt;
      }
      renderImages();
      await validate();
      setStatus("Image staged. Add alt text of at least 10 characters.");
    });
  }

  function renderImages() {
    const list = document.getElementById("image-slots");
    list.replaceChildren();
    for (const slot of ["image", "image2", "image3"]) {
      const item = document.createElement("li");
      const label = slot === "image" ? "Hero image" : slot;
      const current = state.images[slot];
      const altId = `${slot}-alt`;
      item.append(`${label}: ${current.id ? current.name : "not uploaded this session"}`);
      const alt = document.createElement("input");
      alt.id = altId;
      alt.type = "text";
      alt.value = current.alt;
      alt.placeholder = "Alt text (min 10 characters)";
      alt.addEventListener("input", () => {
        current.alt = alt.value;
        if (slot === "image") state.data.imageAlt = alt.value;
        if (slot === "image2") state.data.image2Alt = alt.value;
        if (slot === "image3") state.data.image3Alt = alt.value;
        validate();
      });
      item.append(" ", alt);
      list.append(item);
    }
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

  function issuesFor(field) {
    return [...state.missing, ...state.invalid].filter((issue) => issue.field === field);
  }

  function fieldValue(field) {
    const value = state.data[field];
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === "boolean") return String(value);
    return asString(value);
  }

  function renderChecklist() {
    const list = document.getElementById("checklist");
    list.replaceChildren();
    for (const field of checklistFields) {
      if (field === "h1") continue;
      const item = document.createElement("li");
      const issues = issuesFor(field);
      const optionalEmpty =
        ["keywords", "canonical", "ogTitle", "ogDescription", "ogImage", "pillarKeyword", "supportingKeyword", "articleType", "targetKeyword", "image2", "image2Alt", "image3", "image3Alt", "internalLinks", "externalLinks", "faqs", "updatedDate"].includes(field) &&
        !fieldValue(field) &&
        !(field.startsWith("image") && state.images[field]?.id) &&
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

  function inputFor(field) {
    if (field === "draft") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(state.data.draft);
      input.addEventListener("change", () => {
        state.data.draft = input.checked;
        validate();
      });
      return input;
    }
    if (field === "date" || field === "updatedDate") {
      const input = document.createElement("input");
      input.type = "date";
      input.value = dateInputValue(state.data[field]);
      input.addEventListener("change", () => {
        state.data[field] = input.value;
        if (field === "date" && !state.data.updatedDate) state.data.updatedDate = input.value;
        validate();
      });
      return input;
    }
    if (field === "description") {
      const wrap = document.createElement("span");
      const input = document.createElement("textarea");
      input.value = asString(state.data.description);
      const counter = document.createElement("span");
      const update = () => {
        state.data.description = input.value;
        counter.textContent = ` ${input.value.length}/140–160`;
        counter.className = countClass(input.value.length, 140, 160);
        validate();
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
      input.value = asString(state.data.title);
      const counter = document.createElement("span");
      input.addEventListener("input", () => {
        state.data.title = input.value;
        if (!asString(state.data.h1) || state.data.h1 === document.getElementById("field-h1").defaultValue) {
          /* keep h1 independent once the user edits it */
        }
        counter.textContent = ` ${input.value.length}/55–60`;
        counter.className = countClass(input.value.length, 55, 60);
        validate();
      });
      counter.textContent = ` ${input.value.length}/55–60`;
      counter.className = countClass(input.value.length, 55, 60);
      wrap.append(input, counter);
      return wrap;
    }
    if (field === "tags" || field === "keywords") {
      const input = document.createElement("input");
      input.type = "text";
      input.value = asArray(state.data[field]).join(", ");
      input.addEventListener("input", () => {
        state.data[field] = input.value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        validate();
      });
      return input;
    }
    if (field === "image" || field === "image2" || field === "image3") {
      const note = document.createElement("span");
      note.textContent = " Use the image drop zone above.";
      return note;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = asString(state.data[field]);
    input.addEventListener("input", () => {
      state.data[field] = input.value;
      if (field === "imageAlt") state.images.image.alt = input.value;
      if (field === "image2Alt") state.images.image2.alt = input.value;
      if (field === "image3Alt") state.images.image3.alt = input.value;
      validate();
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
  }

  function generateBlockReason() {
    if (!state.opened) return "Parse a markdown file or edit an existing article first.";
    if (!state.images.image.id) {
      return "Generate is disabled: hero image path in the file does not count — drop a real image file this session (max 10MB).";
    }
    if (asString(state.images.image.alt).length < 10) {
      return "Generate is disabled: hero image alt text must be at least 10 characters.";
    }
    if (state.missing.length || state.invalid.length) {
      return `Generate is disabled: ${[...state.missing, ...state.invalid].map((issue) => issue.message).join("; ")}`;
    }
    if (state.collision) {
      return `Generate is disabled: slug "${asString(state.data.slug)}" already exists. Check overwrite or rename.`;
    }
    return "";
  }

  function renderGenerate() {
    const reason = generateBlockReason();
    const button = document.getElementById("generate");
    button.disabled = Boolean(reason) || state.busy;
    document.getElementById("generate-reason").textContent = reason;
  }

  async function validate() {
    if (!state.opened) return;
    try {
      const payload = await readJson(
        await fetch("/api/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: {
              ...state.data,
              imageAlt: state.images.image.alt,
              image2Alt: state.images.image2.alt,
              image3Alt: state.images.image3.alt,
            },
            body: state.body,
            imageId: state.images.image.id,
            image2Id: state.images.image2.id,
            image3Id: state.images.image3.id,
            editingSlug: state.editingSlug,
            overwrite: state.overwrite,
          }),
        }),
      );
      state.missing = payload.missing || [];
      state.invalid = payload.invalid || [];
      state.warnings = payload.warnings || [];
      state.canGenerate = Boolean(payload.canGenerate);
      state.collision = Boolean(payload.collision);
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

  async function previewJsonLd() {
    await runBusy("Building JSON-LD preview…", async () => {
      const payload = await readJson(
        await fetch("/api/preview-jsonld", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: state.data.title,
            description: state.data.description,
            slug: state.data.slug,
            date: state.data.date,
            updatedDate: state.data.updatedDate,
            schemaType: state.data.schemaType,
            locale: state.data.locale,
            faqs: state.data.faqs,
            author: state.data.author,
          }),
        }),
      );
      document.getElementById("jsonld-preview").textContent = JSON.stringify(
        payload.jsonLd,
        null,
        2,
      );
      setStatus("JSON-LD preview updated.");
    });
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
          body: JSON.stringify({
            data: {
              ...state.data,
              imageAlt: state.images.image.alt,
              image2Alt: state.images.image2.alt || undefined,
              image3Alt: state.images.image3.alt || undefined,
            },
            body: state.body,
            imageId: state.images.image.id,
            image2Id: state.images.image2.id,
            image3Id: state.images.image3.id,
            editingSlug: state.editingSlug,
            overwrite: state.overwrite,
          }),
        }),
      );
      await loadLists();
      renderArticleList();
      setStatus(`Generated ${payload.slug}. llms.txt rebuilt.`);
    });
  }

  async function runBusy(pendingMessage, fn) {
    if (state.busy) return;
    state.busy = true;
    renderGenerate();
    setStatus(pendingMessage);
    try {
      await fn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      state.busy = false;
      renderGenerate();
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
