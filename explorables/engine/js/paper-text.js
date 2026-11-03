// Checked source excerpts and the paper structure exercise's argumentative roles.
// The reader deliberately has no PDF extraction or slide-matching fallback.
//
// The seven roles are the moves almost any paper makes, whatever its method:
// where we are, what's missing, the angle on it, the thing made to act on that
// angle, how evidence was gathered, what was learned, and what it means.
// Instantiation is the one role a paper may leave empty: a qualitative or
// descriptive study observes the world rather than testing something it made.
export const ROLE_LABELS = Object.freeze({
  context: "Context", gap: "Gap", idea: "Idea", instantiation: "Instantiation",
  method: "Method", findings: "Findings", implications: "Implications",
});

/** The question each role answers, shown in the role detail bar and when hovering over the legend. */
export const ROLE_QUESTIONS = Object.freeze({
  context: "What setting or phenomenon are we in, and why does it matter?",
  gap: "What's missing: a problem, an open question, or a tension?",
  idea: "What angle makes the gap addressable: an insight, lens, hypothesis or assumption?",
  instantiation: "What did the authors make that is put to the test? (Empty when the paper only observes.)",
  method: "How was the evidence gathered and judged?",
  findings: "What was learned?",
  implications: "What does it mean beyond this paper, and where does it stop applying?",
});

/**
 * Optional refinements of a role, so the same seven colors fit engineering,
 * social-science and theory papers alike (e.g. "Gap · question" for a study,
 * "Instantiation · model" for a theory paper). Roles not listed take none.
 */
export const ROLE_SUBTYPES = Object.freeze({
  gap: ["problem", "question", "tension"],
  idea: ["insight", "lens", "hypothesis", "assumption"],
  instantiation: ["system", "model", "intervention", "dataset"],
  implications: ["design", "theory", "policy", "practice", "limits"],
});

/** "Gap · question" for a block with a subtype; the bare role label otherwise. */
export const roleLabel = (role, subtype) => subtype ? `${ROLE_LABELS[role]} · ${subtype}` : ROLE_LABELS[role];

/**
 * Distinct subtypes used by `role` across `paper`'s sections, ordered by
 * `ROLE_SUBTYPES[role]` so subtype filters appear in a consistent sequence.
 */
export function roleSubtypesInPaper(paper, role) {
  const allowed = ROLE_SUBTYPES[role] ?? [];
  if (!allowed.length || !paper?.sections) return [];
  const used = new Set();
  for (const section of paper.sections) {
    for (const paragraph of section.paragraphs ?? []) {
      for (const block of paragraph.blocks ?? []) {
        if (block.role === role && block.subtype) used.add(block.subtype);
      }
    }
  }
  return allowed.filter((subtype) => used.has(subtype));
}

const SECTION_TITLES = { abstract: "Abstract", introduction: "Introduction" };
const has = (object, key) => Object.hasOwn(object, key);
const text = (value) => typeof value === "string" && value.trim().length > 0;

/** Validate before rendering; unexpected sections must never become a full-paper fallback. */
export function readingDocument(data) {
  const fields = ["source", "metadata", "annotationSource", "sections"];
  if (!text(data?.metadata?.title) || Object.keys(data).some(key => !fields.includes(key)) || !Array.isArray(data.sections) || !data.sections.length) {
    throw new Error("The annotated abstract and introduction are unavailable.");
  }
  const sections = new Set(), ids = new Set();
  const result = data.sections.map((section) => {
    if (!has(SECTION_TITLES, section?.id) || sections.has(section.id) || !section.paragraphs?.length) {
      throw new Error("The reader supports only an abstract and introduction.");
    }
    sections.add(section.id);
    const paragraphs = section.paragraphs.map((paragraph) => {
      const heading = paragraph.kind === "heading";
      if (!Array.isArray(paragraph.blocks) || !paragraph.blocks.length) throw new Error("An annotated paragraph is missing.");
      const blocks = paragraph.blocks.map((block) => {
        if (!text(block.id) || ids.has(block.id) || !text(block.text) || (!heading && !has(ROLE_LABELS, block.role))) {
          throw new Error("A sentence is missing its text, unique ID, or exercise role.");
        }
        // A subtype is optional, but must be one its role allows (headings take none).
        if (block.subtype !== undefined && (heading || !(ROLE_SUBTYPES[block.role] ?? []).includes(block.subtype))) {
          throw new Error(`"${block.subtype}" is not a subtype of the ${block.role ?? "heading"} role.`);
        }
        ids.add(block.id);
        return { id: block.id, text: block.text, role: heading ? null : block.role, subtype: heading ? null : block.subtype ?? null };
      });
      return { heading, blocks };
    });
    return { id: section.id, title: SECTION_TITLES[section.id], paragraphs };
  });
  if (!sections.has("introduction")) throw new Error("The introduction is unavailable.");
  return {
    title: data.metadata.title,
    authors: (data.metadata.authors ?? []).map((author) => author.name).filter(text),
    publication: text(data.metadata.publication) ? data.metadata.publication : "",
    sections: result.sort((a, b) => a.id === b.id ? 0 : a.id === "abstract" ? -1 : 1),
  };
}
