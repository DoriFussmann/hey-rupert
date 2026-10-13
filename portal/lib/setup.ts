// Setup phase Turn Engine: step definitions, payload shapes and the rules that
// decide whose turn each step is. Pure module: safe on the server and in the
// browser. Every screen, email and reminder reads from here.

export type SetupStepId =
  | "materials"
  | "deck_review"
  | "framing"
  | "investor_list"
  | "email_copy";

/**
 * Stored status of a step row.
 * - materials:   "draft" (client filling in) → "submitted"
 * - deck_review: "draft" (Rupert writing)   → "published"
 * - framing / investor_list / email_copy:
 *   "draft" → "with_client" → "confirmed" | "changes_requested" → (republish)
 */
export type SetupRowStatus =
  | "draft"
  | "submitted"
  | "published"
  | "with_client"
  | "changes_requested"
  | "confirmed";

export type SetupDecision = "confirmed" | "changes_requested";

export type SetupResponse = {
  decision: SetupDecision;
  note: string;
  /** Per-item notes: investor row id → note, or "tier_1".."tier_3" for copy. */
  item_notes: Record<string, string>;
  /** Readable names for item_notes keys (fund names, tier names). */
  item_labels: Record<string, string>;
  version: number;
  at: string;
};

export type SetupHistoryEntry = {
  version: number;
  published_at: string;
  response: SetupResponse | null;
};

/** One row of `setup_steps`, as the app uses it. */
export type SetupStepState = {
  client_id: string;
  step: SetupStepId;
  status: SetupRowStatus;
  draft: unknown;
  published: unknown;
  version: number;
  published_at: string | null;
  response: SetupResponse | null;
  history: SetupHistoryEntry[];
  /** When the current turn (client's or Rupert's) began. */
  turn_since: string | null;
  completed_at: string | null;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Payloads

export type MaterialFile = {
  path: string;
  name: string;
  size: number;
  type: string;
  uploaded_at: string;
};

export type MaterialsPayload = {
  files: MaterialFile[];
  company_text: string;
  other_inputs: string;
};

export type ReviewPayload = { body: string };

export type FitTier = 1 | 2 | 3;

export type InvestorRow = {
  id: string;
  fund_name: string;
  contact: string;
  details: string;
  tier: FitTier;
  why: string;
  comments: string;
};

export type InvestorListPayload = {
  rows: InvestorRow[];
  source_file: string;
};

export type CopyEmail = { subject: string; body: string };

/** Three emails per tier: the first email and two follow-ups. */
export type EmailCopyPayload = {
  tiers: Record<`${FitTier}`, CopyEmail[]>;
};

export const FIT_TIERS: { tier: FitTier; label: string; detail: string }[] = [
  { tier: 1, label: "Tier 1", detail: "Best fit" },
  { tier: 2, label: "Tier 2", detail: "Strong fit" },
  { tier: 3, label: "Tier 3", detail: "Possible fit" },
];

export const EMAIL_SEQUENCE_LABELS = [
  "First email",
  "Follow-up 1",
  "Follow-up 2",
] as const;

export function tierLabel(tier: FitTier) {
  const entry = FIT_TIERS.find((item) => item.tier === tier);
  return entry ? `${entry.label} · ${entry.detail}` : `Tier ${tier}`;
}

// ---------------------------------------------------------------------------
// Steps

export type SetupStepDefinition = {
  id: SetupStepId;
  title: string;
  /** Short label for "Waiting on client: …" and reminder emails. */
  short: string;
  href: string;
  /** What the client is asked to do when it is their turn. */
  clientTask: string;
  /** What Rupert has to do when it is his turn. */
  adminAction: string;
  /** "client" steps are filled in by the client; "review" steps need the
   * client to confirm; "inform" steps are published for the client to read. */
  kind: "client" | "inform" | "review";
};

export const SETUP_STEPS: SetupStepDefinition[] = [
  {
    id: "materials",
    title: "Company Materials",
    short: "Company Materials",
    href: "/portal/setup/materials",
    clientTask: "share your pitch deck and company materials",
    adminAction: "Review company materials",
    kind: "client",
  },
  {
    id: "deck_review",
    title: "Deck & Materials Review",
    short: "Deck & Materials Review",
    href: "/portal/setup/deck-review",
    clientTask: "read Rupert's comments on your deck",
    adminAction: "Write deck & materials comments",
    kind: "inform",
  },
  {
    id: "framing",
    title: "Message Framing",
    short: "Message Framing",
    href: "/portal/setup/framing",
    clientTask: "review and confirm the message framing",
    adminAction: "Write the message framing",
    kind: "review",
  },
  {
    id: "investor_list",
    title: "Investor Matching",
    short: "Investor List",
    href: "/portal/setup/investor-list",
    clientTask: "review and confirm your matched investor list",
    adminAction: "Upload the matched investor list",
    kind: "review",
  },
  {
    id: "email_copy",
    title: "Email Copy",
    short: "Email Copy",
    href: "/portal/setup/email-copy",
    clientTask: "review and confirm the outreach emails",
    adminAction: "Write the email copy for the 3 tiers",
    kind: "review",
  },
];

export const SETUP_TOTAL = SETUP_STEPS.length;

export function setupStep(id: SetupStepId) {
  return SETUP_STEPS.find((step) => step.id === id)!;
}

export function isSetupStepId(value: unknown): value is SetupStepId {
  return SETUP_STEPS.some((step) => step.id === value);
}

export function isSetupOpen(stage?: string | null) {
  return stage === "setup" || stage === "live";
}

/**
 * Whose turn a step is, from the client's side:
 * - "your_turn": the client's
 * - "waiting":   Rupert's
 * - "done"
 * - "open":      not reachable yet
 */
export type SetupItemStatus = "done" | "your_turn" | "waiting" | "open";

export type SetupItem = SetupStepDefinition & {
  status: SetupItemStatus;
  detail: string;
  /** When the current turn began (for reminders and admin context). */
  since: string | null;
  completedAt: string | null;
  /** True when Rupert has published something the client can open. */
  visible: boolean;
};

export type SetupSource = {
  stage?: string | null;
  intake_completed_at?: string | null;
  setup_steps?: SetupStepState[] | null;
};

function rowFor(rows: SetupStepState[] | null | undefined, id: SetupStepId) {
  return rows?.find((row) => row.step === id) ?? null;
}

function later(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export function getSetupItems(source: SetupSource | null | undefined): SetupItem[] {
  const rows = source?.setup_steps ?? [];
  const open = isSetupOpen(source?.stage) || Boolean(source?.intake_completed_at);

  const materials = rowFor(rows, "materials");
  const deck = rowFor(rows, "deck_review");
  const framing = rowFor(rows, "framing");
  const list = rowFor(rows, "investor_list");
  const copy = rowFor(rows, "email_copy");

  const materialsDone = materials?.status === "submitted";
  const framingDone = framing?.status === "confirmed";
  const listDone = list?.status === "confirmed";

  const items: SetupItem[] = [];

  // 1. Company materials: the client's turn as soon as Setup opens.
  items.push({
    ...setupStep("materials"),
    status: !open ? "open" : materialsDone ? "done" : "your_turn",
    detail: !open
      ? "Opens after your intake"
      : materialsDone
        ? "Submitted"
        : materials?.version
          ? "Rupert asked for a few more things"
          : "Upload your deck and share company details",
    since: materialsDone
      ? null
      : later(materials?.turn_since, source?.intake_completed_at),
    completedAt: materials?.completed_at ?? null,
    visible: open,
  });

  // 2. Deck & materials review: Rupert writes comments, publishes them.
  const deckDone = deck?.status === "published";
  items.push({
    ...setupStep("deck_review"),
    status: !materialsDone ? "open" : deckDone ? "done" : "waiting",
    detail: !materialsDone
      ? "After you share your materials"
      : deckDone
        ? "Comments ready"
        : "Rupert is reviewing your materials",
    since: !materialsDone || deckDone ? null : materials?.completed_at ?? null,
    completedAt: deck?.completed_at ?? null,
    visible: deckDone,
  });

  // 3–5. Review steps: Rupert publishes, the client confirms or asks.
  const reviewItem = (
    id: "framing" | "investor_list" | "email_copy",
    row: SetupStepState | null,
    reachable: boolean,
    blockedDetail: string,
    preparingDetail: string,
    reachableSince: string | null,
  ): SetupItem => {
    const step = setupStep(id);
    if (!reachable) {
      return {
        ...step,
        status: "open",
        detail: blockedDetail,
        since: null,
        completedAt: null,
        visible: false,
      };
    }
    if (row?.status === "confirmed") {
      return {
        ...step,
        status: "done",
        detail: "Confirmed",
        since: null,
        completedAt: row.completed_at,
        visible: true,
      };
    }
    if (row?.status === "with_client") {
      return {
        ...step,
        status: "your_turn",
        detail:
          row.version > 1 ? "Updated — review and confirm" : "Review and confirm",
        since: row.turn_since ?? row.published_at,
        completedAt: null,
        visible: true,
      };
    }
    if (row?.status === "changes_requested") {
      return {
        ...step,
        status: "waiting",
        detail: "Rupert is working on your feedback",
        since: row.turn_since ?? row.response?.at ?? null,
        completedAt: null,
        visible: true,
      };
    }
    return {
      ...step,
      status: "waiting",
      detail: preparingDetail,
      since: reachableSince,
      completedAt: null,
      visible: false,
    };
  };

  items.push(
    reviewItem(
      "framing",
      framing,
      materialsDone,
      "After you share your materials",
      "Rupert is writing your message framing",
      materials?.completed_at ?? null,
    ),
  );
  items.push(
    reviewItem(
      "investor_list",
      list,
      framingDone,
      "After the message framing is confirmed",
      "Rupert is matching investors",
      framing?.completed_at ?? null,
    ),
  );
  items.push(
    reviewItem(
      "email_copy",
      copy,
      listDone,
      "After the investor list is confirmed",
      "Rupert is writing your outreach emails",
      list?.completed_at ?? null,
    ),
  );

  return items;
}

export function setupProgress(source: SetupSource | null | undefined) {
  const complete = getSetupItems(source).filter(
    (item) => item.status === "done",
  ).length;
  return { complete, total: SETUP_TOTAL };
}

export function isSetupComplete(source: SetupSource | null | undefined) {
  return setupProgress(source).complete === SETUP_TOTAL;
}

/** Steps where Rupert may publish now (the step is reachable). */
export function canPublish(
  source: SetupSource | null | undefined,
  id: SetupStepId,
) {
  const item = getSetupItems(source).find((entry) => entry.id === id);
  return Boolean(item && item.status !== "open" && id !== "materials");
}

// ---------------------------------------------------------------------------
// Payload parsing (database jsonb → typed, defensive)

function str(value: unknown, max = 20000) {
  return value != null ? String(value).slice(0, max) : "";
}

export function asMaterials(value: unknown): MaterialsPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item) => ({
          path: str(item.path, 500),
          name: str(item.name, 255),
          size: Number(item.size) || 0,
          type: str(item.type, 120),
          uploaded_at: str(item.uploaded_at, 40),
        }))
        .filter((item) => item.path)
    : [];
  return {
    files,
    company_text: str(raw.company_text),
    other_inputs: str(raw.other_inputs),
  };
}

export function asReview(value: unknown): ReviewPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return { body: str(raw.body, 50000) };
}

function asTier(value: unknown): FitTier | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

export function asInvestorList(value: unknown): InvestorListPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item, index) => ({
          id: str(item.id, 40) || `r${index + 1}`,
          fund_name: str(item.fund_name, CSV_FIELD_MAX),
          contact: str(item.contact, CSV_FIELD_MAX),
          details: str(item.details, CSV_FIELD_MAX),
          tier: asTier(item.tier) ?? 3,
          why: str(item.why, CSV_FIELD_MAX),
          comments: str(item.comments, CSV_FIELD_MAX),
        }))
    : [];
  return { rows, source_file: str(raw.source_file, 255) };
}

export function emptyEmailCopy(): EmailCopyPayload {
  const sequence = () =>
    EMAIL_SEQUENCE_LABELS.map(() => ({ subject: "", body: "" }));
  return { tiers: { "1": sequence(), "2": sequence(), "3": sequence() } };
}

export function asEmailCopy(value: unknown): EmailCopyPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const tiers = (raw.tiers && typeof raw.tiers === "object"
    ? raw.tiers
    : {}) as Record<string, unknown>;
  const result = emptyEmailCopy();
  for (const { tier } of FIT_TIERS) {
    const list = Array.isArray(tiers[String(tier)]) ? (tiers[String(tier)] as unknown[]) : [];
    result.tiers[`${tier}`] = EMAIL_SEQUENCE_LABELS.map((_, index) => {
      const item = (list[index] && typeof list[index] === "object"
        ? list[index]
        : {}) as Record<string, unknown>;
      return { subject: str(item.subject, 300), body: str(item.body, 10000) };
    });
  }
  return result;
}

/** Problems that stop the email copy from being pushed. */
export function emailCopyProblems(copy: EmailCopyPayload) {
  const problems: string[] = [];
  for (const { tier, label } of FIT_TIERS) {
    const emails = copy.tiers[`${tier}`];
    if (!emails[0]?.subject.trim()) {
      problems.push(`${label}: the first email needs a subject.`);
    }
    emails.forEach((email, index) => {
      if (!email.body.trim()) {
        problems.push(`${label}: ${EMAIL_SEQUENCE_LABELS[index]} has no body.`);
      }
    });
  }
  return problems;
}

export function asResponse(value: unknown): SetupResponse | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.decision !== "confirmed" && raw.decision !== "changes_requested") {
    return null;
  }
  const notes =
    raw.item_notes && typeof raw.item_notes === "object"
      ? (raw.item_notes as Record<string, unknown>)
      : {};
  const item_notes: Record<string, string> = {};
  for (const [key, note] of Object.entries(notes)) {
    const text = str(note, NOTE_MAX).trim();
    if (text) item_notes[str(key, 40)] = text;
  }
  const labels =
    raw.item_labels && typeof raw.item_labels === "object"
      ? (raw.item_labels as Record<string, unknown>)
      : {};
  const item_labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(labels)) {
    item_labels[str(key, 40)] = str(label, 300);
  }
  return {
    decision: raw.decision,
    note: str(raw.note, NOTE_MAX),
    item_notes,
    item_labels,
    version: Number(raw.version) || 0,
    at: str(raw.at, 40),
  };
}

export const NOTE_MAX = 4000;

// ---------------------------------------------------------------------------
// Investor list CSV

export const CSV_FIELD_MAX = 4000;
export const CSV_ROWS_MAX = 1000;

/** Expected columns, in template order, with the header names we accept. */
export const INVESTOR_CSV_COLUMNS: {
  key: keyof Omit<InvestorRow, "id">;
  header: string;
  aliases: string[];
  required: boolean;
}[] = [
  {
    key: "fund_name",
    header: "Fund Name",
    aliases: ["fund name", "fund", "firm", "investor", "fund/firm"],
    required: true,
  },
  {
    key: "contact",
    header: "Fund Point of Contact",
    aliases: [
      "fund point of contact",
      "point of contact",
      "contact",
      "poc",
      "partner",
      "contact name",
    ],
    required: false,
  },
  {
    key: "details",
    header: "General Details",
    aliases: ["general details", "details", "description", "about", "info"],
    required: false,
  },
  {
    key: "tier",
    header: "Fit Level",
    aliases: ["fit level", "fit", "tier", "fit tier", "level"],
    required: true,
  },
  {
    key: "why",
    header: "Why It Works",
    aliases: ["why it works", "why", "rationale", "reason", "why fit"],
    required: false,
  },
  {
    key: "comments",
    header: "Comments",
    aliases: ["comments", "comment", "notes", "note"],
    required: false,
  },
];

export const INVESTOR_CSV_TEMPLATE =
  INVESTOR_CSV_COLUMNS.map((column) => column.header).join(",") +
  "\n" +
  [
    "Example Ventures",
    "Jane Smith (Partner)",
    "Seed fund · $500k–$2M checks · NYC",
    "Tier 1",
    "Leads seed rounds in B2B health; portfolio overlap with your buyer",
    "Warm intro possible via portfolio founder",
  ]
    .map(csvCell)
    .join(",") +
  "\n";

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180-style parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : (firstLine.match(/\t/g)?.length ?? 0) >
          (firstLine.match(/,/g)?.length ?? 0)
        ? "\t"
        : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** "Tier 1", "1", "T1", "High", "A", "Best" → 1, and so on. */
export function parseFitLevel(value: string): FitTier | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const digit = text.match(/[123]/);
  if (digit) return Number(digit[0]) as FitTier;
  if (["high", "a", "best", "best fit", "top", "strong"].includes(text)) return 1;
  if (["medium", "med", "mid", "b", "good", "good fit"].includes(text)) return 2;
  if (["low", "c", "possible", "possible fit", "stretch", "weak"].includes(text)) {
    return 3;
  }
  return null;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export type InvestorCsvResult =
  | { ok: true; rows: InvestorRow[]; warnings: string[] }
  | { ok: false; errors: string[] };

export function parseInvestorCsv(input: string): InvestorCsvResult {
  const table = parseCsv(input);
  if (table.length === 0) return { ok: false, errors: ["The file is empty."] };

  const header = table[0].map(normalizeHeader);
  const indexes = new Map<string, number>();
  for (const column of INVESTOR_CSV_COLUMNS) {
    const index = header.findIndex((cell) => column.aliases.includes(cell));
    if (index >= 0) indexes.set(column.key, index);
  }

  const missing = INVESTOR_CSV_COLUMNS.filter(
    (column) => column.required && !indexes.has(column.key),
  ).map((column) => column.header);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected headers: ${INVESTOR_CSV_COLUMNS.map((column) => column.header).join(", ")}.`,
      ],
    };
  }

  const body = table.slice(1);
  if (body.length === 0) {
    return { ok: false, errors: ["The file has headers but no investors."] };
  }
  if (body.length > CSV_ROWS_MAX) {
    return {
      ok: false,
      errors: [`Too many rows (${body.length}). The limit is ${CSV_ROWS_MAX}.`],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: InvestorRow[] = [];
  const cell = (cells: string[], key: string) => {
    const index = indexes.get(key);
    return index == null ? "" : (cells[index] ?? "").trim();
  };

  body.forEach((cells, index) => {
    const line = index + 2;
    const fund = cell(cells, "fund_name");
    const fitRaw = cell(cells, "tier");
    if (!fund) {
      errors.push(`Row ${line}: Fund Name is empty.`);
      return;
    }
    const tier = parseFitLevel(fitRaw);
    if (!tier) {
      errors.push(
        `Row ${line} (${fund}): Fit Level "${fitRaw}" is not Tier 1, Tier 2 or Tier 3.`,
      );
      return;
    }
    const long = INVESTOR_CSV_COLUMNS.some(
      (column) => cell(cells, column.key).length > CSV_FIELD_MAX,
    );
    if (long) {
      warnings.push(`Row ${line} (${fund}): a long field was shortened.`);
    }
    rows.push({
      id: `r${rows.length + 1}`,
      fund_name: fund.slice(0, CSV_FIELD_MAX),
      contact: cell(cells, "contact").slice(0, CSV_FIELD_MAX),
      details: cell(cells, "details").slice(0, CSV_FIELD_MAX),
      tier,
      why: cell(cells, "why").slice(0, CSV_FIELD_MAX),
      comments: cell(cells, "comments").slice(0, CSV_FIELD_MAX),
    });
  });

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.fund_name.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicates.length > 0) {
    warnings.push(
      `Listed more than once: ${duplicates.join(", ")}. Fine if they are different contacts.`,
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows, warnings };
}

export function tierCounts(rows: InvestorRow[]) {
  return FIT_TIERS.map(({ tier }) => ({
    tier,
    count: rows.filter((row) => row.tier === tier).length,
  }));
}

// ---------------------------------------------------------------------------
// Uploads

export const MATERIALS_BUCKET = "client-materials";
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
export const MATERIAL_MAX_FILES = 20;
export const MATERIAL_EXTENSIONS = [
  "pdf",
  "ppt",
  "pptx",
  "key",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
];

export function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
