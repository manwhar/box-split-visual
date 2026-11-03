// A continuous, annotated abstract and introduction. Reading position and colors
// are independent of the presentation; no paragraphs or sections are collapsed.
import { deckKey, readingAddress } from "./paper.js";
import { ROLE_LABELS, ROLE_QUESTIONS, readingDocument, roleLabel, roleSubtypesInPaper } from "./paper-text.js";

const viewer = document.querySelector("#viewer");
const status = document.querySelector("#status");
const post = (message) => parent.postMessage(message, location.origin);
let fontSize = 16;
let currentPaper = null;

function zoom(by) {
  fontSize = Math.max(14, Math.min(28, fontSize + by * 2));
  viewer.style.setProperty("--reading-size", `${fontSize}px`);
}

document.addEventListener("keydown", (e) => {
  const key = deckKey(e);
  if (key) { e.preventDefault(); post({ type: "paper:key", key }); }
  else if (!e.metaKey && !e.ctrlKey && !e.altKey && ["+", "=", "-"].includes(e.key)) {
    e.preventDefault(); zoom(e.key === "-" ? -1 : 1);
  }
});

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

const DEFAULT_PROMPT = "Hover over a sentence or choose a role above.";

function render(paper) {
  currentPaper = paper;
  document.title = paper.title;
  const heading = element("header", null, "paper-heading");
  heading.append(element("h1", paper.title));
  if (paper.authors.length) heading.append(element("p", paper.authors.join(", "), "authors"));
  if (paper.publication) heading.append(element("p", paper.publication, "publication"));
  viewer.append(heading);

  // Each legend entry is also a toggle that shows only that role's sentences in
  // color, for readers who can't tell some of the seven colors apart.
  const bar = element("div", null, "role-bar");
  const legend = element("ul", null, "role-legend");
  legend.setAttribute("aria-label", "Paper structure exercise colors");
  for (const [role, label] of Object.entries(ROLE_LABELS)) {
    const button = element("button", label, "role-highlight");
    button.type = "button";
    button.dataset.role = role;
    button.title = `${ROLE_QUESTIONS[role]} Click to show only these sentences.`;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => focusRole(viewer.dataset.focus === role ? null : role));
    button.addEventListener("pointerenter", () => { if (!viewer.dataset.focus) renderRoleDetail(role, null); });
    button.addEventListener("pointerleave", () => { if (!viewer.dataset.focus) renderRoleDetail(null, null); });
    const item = element("li");
    item.append(button);
    legend.append(item);
  }
  const detail = element("div", null, "role-detail");
  bar.append(legend, detail);
  viewer.append(bar);
  syncRoleDetailHeight();

  for (const section of paper.sections) {
    const content = element("section", null, "paper-section");
    content.dataset.section = section.id;
    content.setAttribute("aria-labelledby", section.id);
    const title = element("h2", section.title);
    title.id = section.id;
    content.append(title);
    const body = element("div", null, "section-text");
    for (const paragraph of section.paragraphs) {
      const p = element(paragraph.heading ? "h3" : "p");
      for (const block of paragraph.blocks) {
        const sentence = element("span", block.text, "sentence");
        sentence.dataset.sentence = block.id;
        if (block.role) {
          sentence.classList.add("role-highlight");
          sentence.dataset.role = block.role;
          // The tooltip names the subtype too, e.g. "Gap · question".
          sentence.title = roleLabel(block.role, block.subtype);
          if (block.subtype) sentence.dataset.subtype = block.subtype;
          sentence.addEventListener("pointerenter", () => previewSentence(sentence));
          sentence.addEventListener("pointerleave", () => clearSentencePreview(sentence));
        }
        p.append(sentence, " ");
      }
      body.append(p);
    }
    content.append(body);
    viewer.append(content);
  }
}

/**
 * Lock `.role-detail`'s min-height to the tallest role/subtype combination at
 * the current panel width, so hovering across 1-, 2-, or 3-line descriptions
 * never jiggles the paper below.
 */
function syncRoleDetailHeight() {
  const detail = viewer.querySelector(".role-detail");
  if (!detail || !currentPaper) return;
  const savedRole = detail.dataset.role || null;
  const savedSubtype = detail.dataset.subtype || null;
  detail.style.minHeight = "0px";
  let maxHeight = 0;
  for (const role of [null, ...Object.keys(ROLE_LABELS)]) {
    const subtypes = role ? [null, ...roleSubtypesInPaper(currentPaper, role)] : [null];
    for (const subtype of subtypes) {
      renderRoleDetail(role, subtype);
      maxHeight = Math.max(maxHeight, Math.ceil(detail.getBoundingClientRect().height));
    }
  }
  detail.style.minHeight = `${maxHeight}px`;
  renderRoleDetail(savedRole, savedSubtype);
}

window.addEventListener("resize", syncRoleDetailHeight);

/** Show a hovered sentence's role question and subtype in the sticky bar. */
function previewSentence(sentence) {
  if (sentence.classList.contains("muted")) return;
  const focusedRole = viewer.dataset.focus || null;
  if (!focusedRole) {
    for (const button of viewer.querySelectorAll(".role-legend button")) {
      button.toggleAttribute("data-preview", button.dataset.role === sentence.dataset.role);
    }
    renderRoleDetail(sentence.dataset.role, sentence.dataset.subtype || null);
  } else if (focusedRole === sentence.dataset.role) {
    renderRoleDetail(focusedRole, sentence.dataset.subtype || null);
  }
}

/** Restore the sticky role detail bar to the locked role (or default prompt if no role is selected). */
function clearSentencePreview(sentence) {
  if (sentence.classList.contains("muted")) return;
  for (const button of viewer.querySelectorAll(".role-legend button[data-preview]")) {
    button.removeAttribute("data-preview");
  }
  renderRoleDetail(viewer.dataset.focus || null, null);
}

/** Update the role explanation and the hovered sentence's subtype pill under the legend. */
function renderRoleDetail(role, subtype = null) {
  const detail = viewer.querySelector(".role-detail");
  if (!detail) return;
  const nextRole = role ?? "";
  const nextSubtype = subtype ?? "";
  if (detail.dataset.role === nextRole && detail.dataset.subtype === nextSubtype) return;
  detail.dataset.role = nextRole;
  detail.dataset.subtype = nextSubtype;
  detail.replaceChildren();
  if (!role) {
    detail.append(element("p", DEFAULT_PROMPT, "role-question empty"));
    return;
  }
  if (subtype) {
    const badge = element("span", subtype, "subtype-chip");
    badge.dataset.subtype = subtype;
    detail.append(badge);
  }
  detail.append(element("p", ROLE_QUESTIONS[role], "role-question"));
}

/** Show only `role`'s sentences in color (null shows every role again). */
function focusRole(role) {
  for (const button of viewer.querySelectorAll(".role-legend button[data-preview]")) {
    button.removeAttribute("data-preview");
  }
  if (role) viewer.dataset.focus = role;
  else delete viewer.dataset.focus;
  for (const sentence of viewer.querySelectorAll(".sentence[data-role]")) {
    sentence.classList.toggle("muted", Boolean(role) && sentence.dataset.role !== role);
  }
  for (const button of viewer.querySelectorAll(".role-legend button")) {
    button.setAttribute("aria-pressed", String(button.dataset.role === role));
  }
  renderRoleDetail(role, null);
}

async function open() {
  const address = readingAddress(location.search, location.href);
  if (!address) throw new Error("No annotated abstract and introduction were provided.");
  const response = await fetch(address);
  if (!response.ok) throw new Error(`The annotated text could not be loaded (HTTP ${response.status}).`);
  render(readingDocument(await response.json()));
  status.textContent = "";
  post({ type: "paper:ready" });
}
open().catch((error) => {
  status.textContent = `${error.message} Use Original to read the paper.`;
  post({ type: "paper:error", message: status.textContent });
});

window.addEventListener("message", (e) => {
  if (e.source !== parent || e.origin !== location.origin) return;
  if (e.data?.type === "paper:zoom") zoom(Math.sign(Number(e.data.by)) || 1);
});
