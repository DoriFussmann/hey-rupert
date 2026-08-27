export type SowSection = {
  title: string;
  body: string;
};

function panelTitle(raw: string) {
  return raw.replace(/\s*[—–]\s*/g, " | ").trim();
}

function trimSection(body: string) {
  return body
    .replace(/^\s*(---\s*\r?\n)+/, "")
    .replace(/(\r?\n\s*---\s*)+$/, "")
    .trim();
}

export function splitSowSections(markdown: string): SowSection[] {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^# (?!#)(.*)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: panelTitle(heading[1] ?? ""), body: [] };
      continue;
    }

    if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (current) sections.push(current);

  if (sections.length === 0) {
    const body = trimSection(preamble.join("\n"));
    return body ? [{ title: "Statement of Work", body }] : [];
  }

  if (preamble.some((line) => line.trim())) {
    sections[0].body = [...preamble, "", ...sections[0].body];
  }

  return sections.map((section) => ({
    title: section.title || "Statement of Work",
    body: trimSection(section.body.join("\n")),
  }));
}
