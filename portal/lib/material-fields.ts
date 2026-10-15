// Company Materials fields: what the client is asked in Setup, edited by the
// admin in Forms → Company Materials. Pure module: safe on the server and in
// the browser.

export type MaterialFieldType = "text" | "textarea" | "url";

export type MaterialField = {
  /** Stable key the client's answers are stored under. */
  id: string;
  label: string;
  /** Short guidance shown under the label. */
  help: string;
  /** Light-grey example text inside the empty field. */
  placeholder: string;
  type: MaterialFieldType;
  required: boolean;
};

export const MATERIAL_FIELDS_SLUG = "materials_fields";

export const MATERIAL_FIELD_TYPES: { value: MaterialFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "url", label: "Link" },
];

export const MATERIAL_FIELDS_MAX = 20;
export const MATERIAL_FIELD_VALUE_MAX = 20000;

// The first two ids match the answers stored before fields were editable, so
// existing clients keep what they wrote.
export const DEFAULT_MATERIAL_FIELDS: MaterialField[] = [
  {
    id: "company_text",
    label: "About the company",
    help: "Paste your one-pager, website copy, or describe the company in your own words: what you do, for whom, and why now.",
    placeholder: "",
    type: "textarea",
    required: false,
  },
  {
    id: "other_inputs",
    label: "Anything else",
    help: "Links (data room, product demo, press), recent wins, investors you're already talking to, or anything Rupert should keep in mind.",
    placeholder: "",
    type: "textarea",
    required: false,
  },
];

const FIELD_ID_PATTERN = /^[a-z0-9_]{1,40}$/;

function isFieldType(value: unknown): value is MaterialFieldType {
  return value === "text" || value === "textarea" || value === "url";
}

/** Validates fields from the editor or the database; null when unusable. */
export function parseMaterialFields(value: unknown): MaterialField[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const fields: MaterialField[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    const label = String(item.label ?? "").trim();
    if (!FIELD_ID_PATTERN.test(id) || seen.has(id) || !label) return null;
    seen.add(id);
    fields.push({
      id,
      label: label.slice(0, 80),
      help: String(item.help ?? "").trim().slice(0, 400),
      placeholder: String(item.placeholder ?? "").trim().slice(0, 300),
      type: isFieldType(item.type) ? item.type : "textarea",
      required: item.required === true,
    });
  }

  return fields.length > 0 && fields.length <= MATERIAL_FIELDS_MAX ? fields : null;
}

/** A stable id for a new field, derived from its label. */
export function fieldIdFromLabel(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "field";
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}_${counter}`;
    counter += 1;
  }
  return id;
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** What stops the client from submitting, one line per field. */
export function materialFieldProblems(
  fields: MaterialField[],
  values: Record<string, string>,
) {
  const problems: string[] = [];
  for (const field of fields) {
    const value = (values[field.id] ?? "").trim();
    if (field.required && !value) {
      problems.push(`${field.label} is required.`);
    } else if (field.type === "url" && value && !isHttpUrl(value)) {
      problems.push(`${field.label} must be a link starting with https://`);
    }
  }
  return problems;
}

/**
 * Answers labelled for display: configured fields first, in order, then any
 * answers to fields that were removed since (so nothing the client wrote is
 * hidden from Rupert).
 */
export function labelledAnswers(
  fields: MaterialField[],
  values: Record<string, string>,
) {
  const known = new Set(fields.map((field) => field.id));
  const legacyLabels = new Map(
    DEFAULT_MATERIAL_FIELDS.map((field) => [field.id, field.label]),
  );
  const answers = fields
    .map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      value: (values[field.id] ?? "").trim(),
    }))
    .filter((answer) => answer.value);
  for (const [id, value] of Object.entries(values)) {
    if (known.has(id) || !value.trim()) continue;
    answers.push({
      id,
      label: legacyLabels.get(id) ?? id.replace(/_/g, " "),
      type: "textarea",
      value: value.trim(),
    });
  }
  return answers;
}
