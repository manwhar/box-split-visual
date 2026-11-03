import { discardEarlierDrafts, fingerprint, History, moveSlide, numberInRange, renderSource, resizeImageSize, slideBlocks } from "./editor-model.js";
import { connectEditorFile } from "./editor-connection.js";

const copy = (value) => structuredClone(value);
const has = (object, key) => Object.hasOwn(object, key);
const signature = (slides) => fingerprint(JSON.stringify(slides.map((s) => [s.id, s.outerHTML])));
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const at = (root, path) => path.reduce((node, i) => node.childNodes[i], root);

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Untouched live DOM keeps its iframes. Edits are applied to original nodes and
 * styles; exports are made from clean clones captured before demos start.
 * Drafts contain those clean slides, never loaded frames or editor chrome.
 */
export function initEditor({ slides, stage, currentSlide, goTo, setOrder, refresh, fit, beforeOpen = () => {} }) {
  const originalDocument = `<!doctype html>\n${document.documentElement.outerHTML}`;
  const diskSignature = signature(slides);
  let savedSignature = diskSignature;
  const directory = new URL("./", location.href);
  // The file that holds the slides: an explorable's slides.html, or a page
  // such as the talk's index.html that holds its own slides. The local server
  // (explorables/serve.py) saves to it; its path is shown as the server's
  // path, which is the file's place in the repository.
  const sourceName = document.documentElement.dataset.deckSource || "index.html";
  const sourceUrl = new URL(sourceName, directory);
  const sourcePath = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ""));
  const backupName = `.${sourceName.split("/").pop()}.bak`;
  // Drafts keep the key the talk always used, so drafts saved before the
  // engine moved to explorables/ are still found. The folder keeps decks apart.
  const storageKey = `talk.editor.v1:${directory.pathname}`;
  let storageError = false, recovered = false, staleDraft = null;
  let lastWrittenDraft = null;
  const earlierDrafts = [];
  try {
    const earlier = localStorage.getItem(`${storageKey}:earlier`);
    if (earlier) { staleDraft = JSON.parse(earlier); earlierDrafts.push(staleDraft); }
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const draft = JSON.parse(raw);
      if (draft.version !== 1 || !Array.isArray(draft.slides)) throw new Error("Invalid draft.");
      if (draft.base === diskSignature) {
        // renderSource checks the complete set of ids before any live node changes.
        renderSource(originalDocument, draft.slides);
        const restored = draft.slides.map((s) => parse(s.html).querySelector(".slide"));
        const old = new Map(slides.map((s) => [s.id, s]));
        for (const slide of restored) old.get(slide.id).replaceWith(slide);
        stage.append(...restored);
        slides.splice(0, slides.length, ...restored);
        recovered = true;
        lastWrittenDraft = raw;
      } else { staleDraft = draft; earlierDrafts.push(draft); }
    }
  } catch { storageError = true; }

  // Originals include any recovered draft. Undo operates on this editing session.
  const originals = new Map(slides.map((slide) => [slide.id, slide.cloneNode(true)]));
  const records = new Map(), keys = new WeakMap();
  function register(node, slide, path = []) {
    if (node.nodeType === 1 && node.matches(".notes")) return;
    const key = `${slide.id}:${path.join(".")}`;
    records.set(key, { node, slide, path, text: node.nodeValue, style: node.nodeType === 1 ? node.getAttribute("style") : null });
    keys.set(node, key);
    [...node.childNodes].forEach((child, i) => register(child, slide, [...path, i]));
  }
  slides.forEach((slide) => register(slide, slide));
  const history = new History({ order: slides.map((s) => s.id), text: {}, styles: {}, notes: {}, removed: [] });
  const removalMarkers = new Map();
  let applied = copy(history.state), editing = false, selected = null, saving = false, draftTimer;
  let message = recovered ? "Restored your browser draft. Save to update the file." : "";
  let messageError = false;
  // Until the server sends the file, the page stands in for it: the whole
  // page when the page is the source, or just its slides when they come from
  // a file of their own (an explorable's slides.html), so a download made
  // without the server still has the source's shape.
  const pageIsSource = sourceUrl.pathname === new URL("index.html", directory).pathname;
  let file = { source: pageIsSource ? originalDocument : `${[...originals.values()].map((s) => s.outerHTML).join("\n\n")}\n`, revision: null, token: null };
  let sourceError = false;
  let checkingConnection = false, connectionReason = "";
  let sourceReady = Promise.resolve();
  function reconnectSaving() {
    if (checkingConnection || sourceError || saving) return sourceReady;
    checkingConnection = true;
    updateStatus();
    sourceReady = connectEditorFile(sourceUrl, {
      expectedSignature: savedSignature,
      signatureOf: (source) => signature([...parse(source).querySelectorAll(".slide")]),
    }).then((result) => {
      sourceError = result.status === "conflict";
      if (result.file) file = result.file;
      else { file.token = null; file.revision = null; }
      connectionReason = result.status === "read-only"
        ? `This is a read-only server. Restart it with python3 explorables/serve.py --port ${location.port || "8790"}, then click Reconnect.`
        : result.reason ?? "";
    }).finally(() => { checkingConnection = false; updateStatus(); });
    return sourceReady;
  }

  const panel = document.createElement("aside");
  panel.className = "editor-panel";
  panel.id = "deck-editor";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Slide editor");
  panel.innerHTML = `
    <div class="editor-row"><h2 class="editor-grow">Edit slides</h2><button type="button" data-done>Done</button></div>
    <div class="editor-row"><button type="button" class="primary" data-save>Save to file</button><button type="button" data-download>Download HTML</button></div>
    <div class="editor-row"><button type="button" data-undo title="Undo (⌘/Ctrl Z outside a text field)">Undo</button><button type="button" data-redo>Redo</button></div>
    <p class="editor-status" data-save-status role="status" aria-live="polite"></p>
    <button type="button" data-reconnect hidden>Reconnect</button>
    <div class="editor-recovery" hidden><p>A browser draft belongs to an earlier version of these slides. It has been kept separately.</p><div class="editor-row"><button type="button" data-old-draft>Download earlier draft</button><button type="button" data-discard-old-draft>Discard earlier draft</button></div></div>
    <section aria-label="Slide order"><details class="editor-order">
      <summary>Slides <span data-slide-summary></span></summary><p class="editor-help">Drag a slide to reorder, or move the current slide below.</p>
      <ol class="editor-slides"></ol>
      <div class="editor-row"><button type="button" data-earlier>↑ Earlier</button><button type="button" data-later>↓ Later</button><label>Position<input data-position type="number" min="1" step="1" aria-label="Slide position"></label><button type="button" data-move>Move</button></div>
    </details></section>
    <section aria-label="Selected element">
      <h3>Element</h3><label>Select on the slide, or choose here<select data-element aria-label="Element to edit"></select></label>
      <div class="editor-empty"><p>Click text, a picture, a card, or a demo area to select it.</p><p class="editor-help">With nothing selected, ← / → change slides.</p></div>
      <div class="editor-properties" hidden>
        <div class="editor-row"><span class="editor-element-name editor-grow"></span><button type="button" data-parent title="Select the containing group">Parent</button></div>
        <div class="editor-row"><label data-font-label>Font size (px)<input data-font type="number" min="6" max="300" step="1"></label><button type="button" data-reset>Reset element</button></div>
        <div class="editor-image-size" hidden>
          <div class="editor-row"><label>Width (px)<input data-width type="number" min="1" max="5000" step="0.1"></label><label>Height (px)<input data-height type="number" min="1" max="5000" step="0.1"></label></div>
          <label class="editor-check"><input type="checkbox" data-keep-ratio checked>Keep proportions</label>
          <p class="editor-help">Drag the image's lower-right handle or enter a size in slide pixels.</p>
        </div>
        <div class="editor-text-size" hidden>
          <div class="editor-row"><label><span data-text-width-label>Text width (px)</span><input data-text-width type="number" min="1" max="5000" step="0.1"></label><button type="button" data-reset-width>Reset width</button></div>
          <p class="editor-help" data-text-width-help></p>
        </div>
        <div class="editor-row"><label>X offset (px)<input data-x type="number" min="-5000" max="5000" step="1"></label><label>Y offset (px)<input data-y type="number" min="-5000" max="5000" step="1"></label></div>
        <div class="editor-row editor-nudge"><button type="button" data-nudge="-1,0" aria-label="Move left one pixel">←</button><button type="button" data-nudge="0,-1" aria-label="Move up one pixel">↑</button><button type="button" data-nudge="0,1" aria-label="Move down one pixel">↓</button><button type="button" data-nudge="1,0" aria-label="Move right one pixel">→</button></div>
        <p class="editor-help">Arrow keys move 1 slide pixel. Shift + arrow moves 10. Esc clears the selection. Offsets are relative to the layout when this page opened.</p>
        <div class="editor-text-fields"></div>
        <div class="editor-row"><button type="button" class="editor-delete" data-delete title="Delete selected element (Delete / Backspace)">Delete element</button><span class="editor-help">Undo restores it.</span></div>
      </div>
    </section>
    <section aria-label="Presenter notes"><h3>Presenter notes</h3><label>Notes for this slide<textarea data-notes-edit rows="7" placeholder="What you want to say or try on this slide…"></textarea></label><p class="editor-help">Notes stay off the slide. Use Notes while presenting to read them.</p></section>
    <section><p class="editor-help" data-save-help></p></section>`;
  document.body.append(panel);
  const $ = (selector) => panel.querySelector(selector);
  const notesDrawer = document.querySelector(".notes-drawer");
  notesDrawer.id = "presenter-notes";
  notesDrawer.removeAttribute("aria-live");
  notesDrawer.setAttribute("role", "region");
  notesDrawer.setAttribute("aria-label", "Presenter notes");
  notesDrawer.innerHTML = `
    <div class="notes-toolbar">
      <label for="presenter-notes-text">Presenter notes</label>
      <span data-save-status role="status" aria-live="polite"></span>
      <button type="button" data-reconnect hidden>Reconnect</button>
      <button type="button" data-download hidden>Download HTML</button>
      <button type="button" class="primary" data-save>Save to file</button>
    </div>
    <textarea id="presenter-notes-text" data-notes-edit placeholder="Click here to add notes for this slide…" title="Edit notes directly. ⌘/Ctrl S saves; Esc returns to slide navigation."></textarea>`;
  const notesInput = notesDrawer.querySelector("[data-notes-edit]");
  const notesButton = document.querySelector("[data-notes]");
  notesButton.setAttribute("aria-controls", notesDrawer.id);
  notesButton.setAttribute("aria-expanded", "false");
  const selection = document.createElement("div");
  selection.className = "editor-selection";
  selection.hidden = true;
  selection.setAttribute("aria-hidden", "true");
  const resizeHandle = document.createElement("span");
  resizeHandle.className = "editor-resize-handle";
  resizeHandle.title = "Drag to resize image";
  resizeHandle.hidden = true;
  selection.append(resizeHandle);
  document.body.append(selection);
  const widthSelection = document.createElement("div");
  widthSelection.className = "editor-width-selection";
  widthSelection.hidden = true;
  widthSelection.setAttribute("aria-hidden", "true");
  widthSelection.innerHTML = `<span class="editor-width-handle" data-edge="left" title="Drag to resize width from the left"></span><span class="editor-width-handle" data-edge="right" title="Drag to resize width from the right"></span>`;
  document.body.append(widthSelection);
  stage.tabIndex = -1;
  if (staleDraft) $(".editor-recovery").hidden = false;

  function selectable(node) {
    return node instanceof HTMLElement && node.isConnected && keys.has(node) && !node.matches(".slide, .notes, .sr-only, br, script, style, .play-set, iframe") && !node.closest(".notes, .offline");
  }
  function label(node) {
    const words = node.matches("img") ? node.alt : node.matches(".slot, .play-room") ? "Live demo area" : node.textContent.trim().replace(/\s+/g, " ");
    return `${node.tagName.toLowerCase()} · ${(words || node.className || "Group").slice(0, 75)}`;
  }
  function editableTexts(node) {
    // Groups can be moved; selecting a text block exposes its individual styled
    // runs so editing words cannot flatten links, emphasis, spans, or line breaks.
    if (node.querySelector("div, p, h1, h2, h3, ul, ol, li, table, figure, iframe, .slot")) return [];
    return [...records.entries()].filter(([, r]) => r.node.nodeType === 3 && node.contains(r.node) && r.text?.trim());
  }
  function currentRecord() { return selected ? records.get(selected) : null; }
  function widthTarget(node) {
    if (!selectable(node) || node.matches("img, .slot, .play-room")) return null;
    // Clicking a bullet (including a bold word inside it) resizes its whole
    // list, so every bullet wraps consistently. Inline text uses its block.
    if (node.matches("ul, ol")) return node;
    const list = node.closest("li")?.parentElement;
    if (list?.matches("ul, ol") && selectable(list)) return list;
    while (selectable(node)) {
      if (!["inline", "contents"].includes(getComputedStyle(node).display)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function positionSelection() {
    const node = currentRecord()?.node;
    selection.hidden = !editing || !node?.isConnected || records.get(selected).slide !== currentSlide();
    resizeHandle.hidden = selection.hidden || !node.matches("img");
    widthSelection.hidden = true;
    if (selection.hidden) return;
    const r = node.getBoundingClientRect();
    Object.assign(selection.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const target = widthTarget(node);
    if (target) {
      const box = target.getBoundingClientRect();
      widthSelection.hidden = false;
      widthSelection.classList.toggle("editor-width-shared", target !== node);
      Object.assign(widthSelection.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    }
  }
  const observer = new ResizeObserver(() => positionSelection());
  window.addEventListener("resize", () => requestAnimationFrame(positionSelection));
  document.fonts?.ready.then(positionSelection);

  function select(key, focus = false) {
    observer.disconnect();
    selected = key && selectable(records.get(key)?.node) ? key : null;
    if (selected) {
      const node = records.get(selected).node;
      observer.observe(node);
      const target = widthTarget(node);
      if (target && target !== node) observer.observe(target);
    }
    renderInspector();
    positionSelection();
    if (focus) stage.focus({ preventScroll: true });
  }
  function renderInspector() {
    const record = currentRecord();
    $(".editor-empty").hidden = Boolean(record);
    $(".editor-properties").hidden = !record;
    const chooser = $("[data-element]");
    chooser.replaceChildren(new Option("Choose an element…", ""));
    for (const [key, r] of records) if (r.slide === currentSlide() && selectable(r.node)) chooser.add(new Option(label(r.node), key));
    chooser.value = selected ?? "";
    if (!record) return;
    $(".editor-image-size").hidden = !record.node.matches("img");
    const target = widthTarget(record.node);
    $(".editor-text-size").hidden = !target;
    $("[data-text-width-label]").textContent = target?.matches("ul, ol") ? "List width (px)" : "Text / group width (px)";
    $("[data-text-width-help]").textContent = `${target?.matches("ul, ol") ? "Applies to the whole list. " : ""}Drag either side handle to change wrapping without changing font size. Drag the left handle to expand leftward.`;
    $("[data-font-label]").hidden = record.node.matches("img");
    $(".editor-element-name").textContent = label(record.node);
    $("[data-parent]").disabled = !selectable(record.node.parentElement);
    const fields = $(".editor-text-fields");
    fields.replaceChildren();
    const texts = editableTexts(record.node);
    $("[data-font]").disabled = !record.node.textContent.trim() || record.node.matches(".slot, .play-room");
    if (texts.length > 1) {
      const hint = document.createElement("p");
      hint.className = "editor-help";
      hint.textContent = "Text is split at formatting and line breaks to keep the existing layout and emphasis.";
      fields.append(hint);
    }
    texts.forEach(([key, r], i) => {
      const field = document.createElement("label");
      field.textContent = texts.length === 1 ? "Text" : `Text ${i + 1} · ${r.node.parentElement.tagName.toLowerCase()}`;
      const input = document.createElement("textarea");
      input.rows = Math.min(5, Math.max(2, Math.ceil(r.node.nodeValue.length / 38)));
      input.value = r.node.nodeValue;
      input.dataset.textKey = key;
      field.append(input);
      fields.append(field);
    });
    updateValues();
  }
  function updateValues() {
    const record = currentRecord();
    if (record) {
      const style = history.state.styles[selected] ?? {};
      const values = { "[data-x]": style.dx ?? 0, "[data-y]": style.dy ?? 0, "[data-font]": style.fontSize ?? Math.round(parseFloat(getComputedStyle(record.node).fontSize) * 10) / 10 };
      if (record.node.matches("img")) {
        const size = imageDimensions(record.node);
        values["[data-width]"] = Math.round(size.width * 10) / 10;
        values["[data-height]"] = Math.round(size.height * 10) / 10;
      }
      const target = widthTarget(record.node);
      if (target) {
        values["[data-text-width]"] = Math.round(parseFloat(getComputedStyle(target).width) * 10) / 10;
        $("[data-reset-width]").disabled = history.state.styles[keys.get(target)]?.width == null;
      }
      for (const [selector, value] of Object.entries(values)) if (document.activeElement !== $(selector)) $(selector).value = value;
    }
    $("[data-undo]").disabled = !history.canUndo;
    $("[data-redo]").disabled = !history.canRedo;
  }
  function renderList() {
    const list = $(".editor-slides"), scroll = list.scrollTop;
    list.replaceChildren();
    slides.forEach((slide, i) => {
      const row = document.createElement("li");
      row.draggable = true;
      row.dataset.slideId = slide.id;
      row.setAttribute("aria-current", String(slide === currentSlide()));
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.slideId = slide.id;
      const number = document.createElement("span");
      number.className = "editor-slide-number";
      number.textContent = `${i + 1}`;
      button.append(number, document.createTextNode(slide.querySelector("h1, h2")?.textContent.trim() ?? slide.id));
      row.append(button);
      list.append(row);
    });
    list.scrollTop = scroll;
    const index = slides.indexOf(currentSlide());
    $("[data-slide-summary]").textContent = `${index + 1} of ${slides.length} · reorder`;
    $("[data-earlier]").disabled = index <= 0;
    $("[data-later]").disabled = index >= slides.length - 1;
    $("[data-position]").max = slides.length;
    if (document.activeElement !== $("[data-position]")) $("[data-position]").value = index + 1;
  }

  function restoreStyle(record) {
    if (record.style === null) record.node.removeAttribute("style");
    else record.node.setAttribute("style", record.style);
  }
  function apply() {
    const state = history.state;
    // Comments retain each removed node's exact position, including when a
    // removed child belongs to a removed group. Undo reuses the original nodes.
    for (const [key, marker] of removalMarkers) if (!state.removed.includes(key)) {
      marker.replaceWith(records.get(key).node);
      removalMarkers.delete(key);
    }
    for (const key of state.removed) if (!removalMarkers.has(key)) {
      const marker = document.createComment("editor: removed element");
      records.get(key).node.replaceWith(marker);
      removalMarkers.set(key, marker);
    }
    if (selected && !selectable(currentRecord()?.node)) select(null);
    const styled = new Set([...Object.keys(applied.styles), ...Object.keys(state.styles)]);
    const textKeys = new Set([...Object.keys(applied.text), ...Object.keys(state.text)]);
    for (const key of textKeys) styled.add(keys.get(records.get(key).node.parentElement));
    for (const key of styled) restoreStyle(records.get(key));
    for (const key of textKeys) records.get(key).node.nodeValue = state.text[key] ?? records.get(key).text;
    for (const [key, values] of Object.entries(state.styles)) {
      const node = records.get(key).node;
      if (!node.isConnected) continue;
      if (values.fontSize != null) node.style.fontSize = `${values.fontSize}px`;
      if (values.width != null) {
        Object.assign(node.style, { width: `${values.width}px`, maxWidth: "none", flexShrink: "0" });
        if (values.height == null) Object.assign(node.style, { minWidth: "0", flexBasis: "auto" });
      }
      if (values.height != null) Object.assign(node.style, { height: `${values.height}px`, maxHeight: "none" });
      const dx = values.dx ?? 0, dy = values.dy ?? 0;
      if (!dx && !dy) continue;
      const base = getComputedStyle(node);
      // Relative positioning also works on inline words, without turning them
      // into inline blocks and changing line wrapping. Other elements use the
      // independent translate property, leaving existing transforms untouched.
      if (base.display === "inline" && ["static", "relative"].includes(base.position)) {
        const left = base.left === "auto" ? "0px" : base.left, top = base.top === "auto" ? "0px" : base.top;
        node.style.position = "relative";
        node.style.left = `calc(${left} + ${dx}px)`;
        node.style.top = `calc(${top} + ${dy}px)`;
      } else {
        const translation = base.translate === "none" ? ["0px", "0px"] : base.translate.split(/\s+/);
        node.style.translate = `calc(${translation[0]} + ${dx}px) calc(${translation[1] ?? "0px"} + ${dy}px)${translation[2] ? ` ${translation[2]}` : ""}`;
      }
    }
    for (const [key, value] of Object.entries(state.text)) if (value.includes("\n")) records.get(key).node.parentElement.style.whiteSpace = "pre-line";
    for (const id of new Set([...Object.keys(applied.notes), ...Object.keys(state.notes)])) {
      const slide = slides.find((s) => s.id === id);
      let notes = slide.querySelector(".notes");
      if (has(state.notes, id)) {
        if (!notes) { notes = document.createElement("aside"); notes.className = "notes"; slide.append(notes); }
        notes.textContent = state.notes[id];
      } else {
        const original = originals.get(id).querySelector(".notes");
        if (original) notes.innerHTML = original.innerHTML;
        else notes?.remove();
      }
    }
    const orderChanged = state.order.join() !== applied.order.join();
    const visualChanged = orderChanged
      || state.removed.join() !== applied.removed.join()
      || [...styled].some((k) => JSON.stringify(state.styles[k]) !== JSON.stringify(applied.styles[k]))
      || [...textKeys].some((k) => state.text[k] !== applied.text[k]);
    const notesOnly = !visualChanged;
    if (orderChanged) setOrder(state.order);
    applied = copy(state);
    refresh({ notesOnly, orderChanged, slide: currentSlide() });
    if (!notesOnly) {
      renderList();
      updateValues();
      positionSelection();
    } else {
      $("[data-undo]").disabled = !history.canUndo;
      $("[data-redo]").disabled = !history.canRedo;
    }
  }
  function change(edit, group = null, now = Date.now()) {
    const state = copy(history.state);
    edit(state);
    if (!history.push(state, group, now)) return;
    message = "";
    messageError = false;
    apply();
    scheduleDraft();
  }
  function nudge(dx, dy, large = false) {
    if (!selected) return;
    change((state) => {
      const style = state.styles[selected] ??= {};
      style.dx = Math.max(-5000, Math.min(5000, (style.dx ?? 0) + dx * (large ? 10 : 1)));
      style.dy = Math.max(-5000, Math.min(5000, (style.dy ?? 0) + dy * (large ? 10 : 1)));
    }, `nudge:${selected}`);
  }
  function imageDimensions(node) {
    const style = getComputedStyle(node);
    return { width: parseFloat(style.width) || node.naturalWidth || 1, height: parseFloat(style.height) || node.naturalHeight || 1 };
  }
  function resizeElement(size, key = selected, group = `resize:${key}`, drag = null) {
    const node = records.get(key)?.node;
    if (!size || !selectable(node)) return;
    change((state) => Object.assign(state.styles[key] ??= {}, size), group, drag?.time);
    if (drag) {
      // Preserve the opposite edge and top as layout reflows around the resize.
      const box = node.getBoundingClientRect(), edge = drag.edge === "left" ? "right" : "left";
      const dx = (drag[edge] - box[edge]) / drag.scale, dy = (drag.top - box.top) / drag.scale;
      if (Math.abs(dx) > .01 || Math.abs(dy) > .01) change((state) => {
        const style = state.styles[key];
        style.dx = (style.dx ?? 0) + dx;
        style.dy = (style.dy ?? 0) + dy;
        if (drag.edge) {
          style.widthDx = (style.widthDx ?? 0) + dx;
          style.widthDy = (style.widthDy ?? 0) + dy;
        }
      }, group, drag.time);
    }
  }
  function deleteSelection() {
    if (!selectable(currentRecord()?.node)) return;
    const key = selected;
    change((state) => { state.removed.push(key); });
    select(null, true);
  }
  function reorder(id, index) { change((state) => { state.order = moveSlide(state.order, id, index); }); }
  function editNotes(value) {
    const id = currentSlide().id;
    change((state) => { state.notes[id] = value; }, `notes:${id}`);
  }
  function refreshNotes() {
    const slide = currentSlide();
    const value = slide?.querySelector(".notes")?.textContent ?? "";
    const changedSlide = notesInput.dataset.slideId !== slide?.id;
    for (const field of [notesInput, $("[data-notes-edit]")]) {
      // Keep the active field's caret, scroll and native undo history while typing.
      if (field.value !== value) field.value = value;
      if (changedSlide) field.scrollTop = 0;
    }
    notesInput.dataset.slideId = slide?.id ?? "";
  }
  function undo(redo = false) {
    if (redo) history.redo(); else history.undo();
    message = "";
    apply();
    renderInspector();
    scheduleDraft();
  }

  let cachedState = null, cachedClean = null;
  function cleanSlides() {
    if (cachedState === history.state && cachedClean) return cachedClean;
    cachedState = history.state;
    cachedClean = history.state.order.map((id) => {
      const slide = originals.get(id).cloneNode(true);
      for (const [key, value] of Object.entries(history.state.text)) {
        const r = records.get(key);
        if (r.slide.id === id) at(slide, r.path).nodeValue = value;
      }
      const styled = new Set(Object.keys(history.state.styles));
      for (const key of Object.keys(history.state.text)) styled.add(keys.get(records.get(key).node.parentElement));
      for (const key of styled) {
        const r = records.get(key);
        if (r.slide.id !== id) continue;
        const style = r.node.getAttribute("style");
        if (style === null) at(slide, r.path).removeAttribute("style");
        else at(slide, r.path).setAttribute("style", style);
      }
      if (has(history.state.notes, id)) {
        let notes = slide.querySelector(".notes");
        if (!notes) { notes = document.createElement("aside"); notes.className = "notes"; slide.append(notes); }
        notes.textContent = history.state.notes[id];
      }
      // Resolve every original path before removing anything so sibling indices
      // and nested removals cannot shift the target of later edits or deletions.
      const removed = history.state.removed.map((key) => records.get(key))
        .filter((r) => r.slide.id === id).map((r) => at(slide, r.path));
      for (const node of removed) node.remove();
      return slide;
    });
    return cachedClean;
  }
  function sourceWith(clean) {
    // Untouched sections keep their original whitespace and character entities.
    const raw = new Map(slideBlocks(file.source).map((b) => [b.id, b.html]));
    return renderSource(file.source, clean.map((s) => ({ id: s.id,
      html: parse(raw.get(s.id)).querySelector(".slide").outerHTML === s.outerHTML ? raw.get(s.id) : s.outerHTML })));
  }
  function writeDraft() {
    clearTimeout(draftTimer);
    const clean = cleanSlides();
    try {
      const latest = localStorage.getItem(storageKey);
      if (signature(clean) === savedSignature) {
        // Undo can return to the saved file while storage still holds our last
        // edit. Clear that snapshot, but preserve a newer draft from another tab.
        const storedSlides = latest ? JSON.parse(latest).slides : null;
        if (latest && (latest === lastWrittenDraft || (storedSlides?.length === clean.length && storedSlides.every((s, i) => s.html === clean[i].outerHTML)))) {
          localStorage.removeItem(storageKey);
          lastWrittenDraft = null;
        }
      } else {
        // Keep an older-source draft accessible even after this version is edited.
        if (staleDraft) localStorage.setItem(`${storageKey}:earlier`, JSON.stringify(staleDraft));
        const draft = JSON.stringify({ version: 1, base: savedSignature,
          source: sourceWith(clean), slides: clean.map((s) => ({ id: s.id, html: s.outerHTML })) });
        localStorage.setItem(storageKey, draft);
        lastWrittenDraft = draft;
      }
      storageError = false;
    } catch { storageError = true; }
    updateStatus();
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 250);
    updateStatus();
  }
  function discardOldDraft() {
    if (!staleDraft) return;
    try {
      discardEarlierDrafts(localStorage, storageKey, earlierDrafts, savedSignature);
      // Clear the in-memory copy too, so a later autosave cannot bring it back.
      staleDraft = null;
      earlierDrafts.length = 0;
      $(".editor-recovery").hidden = true;
      message = "Earlier draft discarded. Current edits are kept.";
      messageError = false;
      ($("[data-save]").disabled ? $("[data-download]") : $("[data-save]")).focus();
    } catch {
      message = "Could not discard the earlier draft in this browser. Try again.";
      messageError = true;
    }
    updateStatus();
  }
  function updateStatus() {
    const direct = Boolean(file.token && file.revision) && !sourceError;
    const dirty = signature(cleanSlides()) !== savedSignature;
    const status = sourceError ? "The slides changed on disk or in another tab. Your draft is kept; reload before saving."
      : checkingConnection ? "Connecting to the local server…"
      : !direct ? connectionReason
      : message || (storageError ? "Browser storage is unavailable. Save or download before leaving." : dirty ? "Draft kept in this browser · file not saved yet" : "No unsaved changes.");
    for (const root of [panel, notesDrawer]) {
      const button = root.querySelector("[data-save]");
      button.disabled = checkingConnection || saving || !direct || !dirty;
      button.textContent = saving ? "Saving…" : checkingConnection ? "Connecting…" : direct && !dirty ? "Saved" : "Save to file";
      button.title = sourceError ? "Reload the newer file before saving." : !direct ? connectionReason : !dirty ? "No unsaved changes." : `Save changes to ${sourcePath}`;
      const reconnect = root.querySelector("[data-reconnect]");
      reconnect.hidden = sourceError || (direct && !checkingConnection);
      reconnect.disabled = checkingConnection || saving;
      const statusText = root.querySelector("[data-save-status]");
      if (statusText.textContent !== status) statusText.textContent = status;
      statusText.classList.toggle("error", sourceError || messageError || storageError || (!direct && !checkingConnection));
    }
    notesDrawer.querySelector("[data-download]").hidden = direct && !messageError && !storageError;
    $("[data-save-help]").textContent = sourceError ? "Download your draft, then reload the page to get the newer file before continuing."
      : direct
      ? `Save updates ${sourcePath} and keeps the previous file as ${backupName}. Drafts also stay in this browser.`
      : `For direct saving, run python3 explorables/serve.py from the repository and open this page on localhost:8790. On a static server, download the HTML and replace ${sourcePath}; keep it beside its CSS, scripts and images.`;
  }
  async function save() {
    await sourceReady;
    if (!sourceError && !saving && (!file.token || !file.revision)) await reconnectSaving();
    if (saving || !file.token || !file.revision || sourceError) return;
    const clean = cleanSlides();
    if (signature(clean) === savedSignature) return;
    saving = true;
    updateStatus();
    try {
      const content = sourceWith(clean);
      const response = await fetch(new URL("__save", directory), { method: "POST",
        headers: { "Content-Type": "application/json", "X-Deck-Token": file.token },
        body: JSON.stringify({ revision: file.revision, source: content }) });
      const result = await response.json();
      if (response.status === 409) sourceError = true;
      if (!response.ok) throw new Error(result.error || "The file could not be saved.");
      file.revision = result.revision;
      savedSignature = signature(clean);
      message = signature(cleanSlides()) === savedSignature ? `Saved to ${sourcePath}.` : "File saved. Your newer edits are still a draft.";
      messageError = false;
      // A save can finish after another edit: retain that newer draft against
      // the newly saved file rather than clearing it.
      try {
        const latest = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (latest?.slides?.every((s, i) => s.html === clean[i]?.outerHTML)) localStorage.removeItem(storageKey);
      } catch { storageError = true; }
      writeDraft();
    } catch (error) {
      message = error.message || "Saving failed. Your browser draft is still available.";
      messageError = true;
    } finally { saving = false; updateStatus(); }
  }

  function toggle(open = !editing) {
    if (open) beforeOpen();
    editing = open;
    document.body.classList.toggle("editing", open);
    panel.hidden = !open;
    document.querySelector("[data-edit]").setAttribute("aria-pressed", String(open));
    if (open) {
      document.querySelectorAll(".settings-pop").forEach((box) => box.classList.remove("open"));
      onSlideChange();
      stage.focus({ preventScroll: true });
      if (!file.token || !file.revision) reconnectSaving();
    } else { writeDraft(); select(null); document.querySelector("[data-edit]").focus(); }
    fit();
    positionSelection();
  }
  function onSlideChange() {
    refreshNotes();
    if (!editing) return;
    if (currentRecord()?.slide !== currentSlide()) select(null);
    renderList();
    renderInspector();
    updateStatus();
  }
  function toggleNotes(open = !document.body.classList.contains("show-notes")) {
    document.body.classList.toggle("show-notes", open);
    notesButton.setAttribute("aria-expanded", String(open));
    if (open) {
      refreshNotes();
      if (!file.token || !file.revision) reconnectSaving();
    } else {
      writeDraft();
      if (notesDrawer.contains(document.activeElement)) stage.focus({ preventScroll: true });
    }
    fit();
  }
  function focusNotes() {
    if (!editing) toggle(true);
    $("[data-notes-edit]").focus();
    $("[data-notes-edit]").scrollIntoView({ block: "nearest" });
  }

  notesInput.addEventListener("input", () => editNotes(notesInput.value));
  notesDrawer.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (button?.matches("[data-save]")) save();
    else if (button?.matches("[data-reconnect]")) reconnectSaving();
    else if (button?.matches("[data-download]")) { await sourceReady; download(sourceWith(cleanSlides()), sourceName.split("/").pop()); } // the slides' own file, as the panel's Download names it
  });

  let resizeDrag = null, resizeSerial = 0;
  function startResize(event) {
    if (event.button !== 0 || !editing) return;
    const edge = event.target.dataset.edge;
    const node = edge ? widthTarget(currentRecord()?.node) : currentRecord()?.node;
    if (!node || (!edge && !node.matches("img"))) return;
    event.preventDefault();
    const box = node.getBoundingClientRect();
    resizeDrag = { key: keys.get(node), selectionKey: selected, handle: event.currentTarget, edge,
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: box.left, right: box.right, top: box.top, size: imageDimensions(node), scale: stage.getBoundingClientRect().width / stage.offsetWidth,
      keepRatio: $("[data-keep-ratio]").checked, group: `resize-drag:${++resizeSerial}`, time: Date.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveResize(event) {
    const drag = resizeDrag;
    if (!drag || drag.pointerId !== event.pointerId || drag.selectionKey !== selected || !editing) return;
    event.preventDefault();
    const delta = (event.clientX - drag.x) / drag.scale;
    const size = drag.edge ? { width: Math.max(1, Math.min(5000, drag.size.width + (drag.edge === "left" ? -delta : delta))) }
      : resizeImageSize(drag.size, {
      width: drag.size.width + delta,
      height: drag.size.height + (event.clientY - drag.y) / drag.scale,
    }, drag.keepRatio);
    resizeElement(size, drag.key, drag.group, drag);
  }
  function endResize(event) {
    if (resizeDrag?.pointerId !== event.pointerId) return;
    const handle = resizeDrag.handle;
    resizeDrag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    stage.focus({ preventScroll: true });
  }
  for (const handle of [resizeHandle, widthSelection]) {
    handle.addEventListener("pointerdown", startResize);
    handle.addEventListener("pointermove", moveResize);
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
    handle.addEventListener("lostpointercapture", endResize);
  }

  stage.addEventListener("click", (event) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    let node = event.target.closest(".slot, .play-room") ?? event.target;
    while (node && node !== stage && !selectable(node)) node = node.parentElement;
    select(keys.get(node), true);
  }, true);
  panel.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches("[data-notes-edit]")) editNotes(input.value);
    else if (input.matches("[data-text-key]")) change((state) => { state.text[input.dataset.textKey] = input.value; }, `text:${input.dataset.textKey}`);
    else if (input.matches("[data-width], [data-height]") && currentRecord()?.node.matches("img")) {
      const value = numberInRange(input.value, 1, 5000);
      input.setCustomValidity(value === null ? "Enter a size from 1 to 5000 pixels." : "");
      if (value === null) return;
      const axis = input.matches("[data-width]") ? "width" : "height";
      const size = resizeImageSize(imageDimensions(currentRecord().node), { [axis]: value }, $("[data-keep-ratio]").checked);
      resizeElement(size);
      if (size && Math.abs(size[axis] - value) > .01) input.value = Math.round(size[axis] * 10) / 10;
    }
    else if (input.matches("[data-text-width]")) {
      const target = widthTarget(currentRecord()?.node);
      const value = numberInRange(input.value, 1, 5000);
      input.setCustomValidity(value === null ? "Enter a width from 1 to 5000 pixels." : "");
      if (target && value !== null) resizeElement({ width: value }, keys.get(target));
    }
    else if (input.matches("[data-font], [data-x], [data-y]") && selected) {
      const value = numberInRange(input.value, Number(input.min), Number(input.max));
      input.setCustomValidity(value === null ? `Enter a number from ${input.min} to ${input.max}.` : "");
      if (value === null) return;
      const property = input.matches("[data-font]") ? "fontSize" : input.matches("[data-x]") ? "dx" : "dy";
      change((state) => { (state.styles[selected] ??= {})[property] = value; }, `${property}:${selected}`);
    }
  });
  panel.addEventListener("change", (event) => { if (event.target.matches("[data-element]")) select(event.target.value); });
  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-done]")) toggle(false);
    else if (button.matches("[data-reconnect]")) reconnectSaving();
    else if (button.matches("[data-save]")) save();
    else if (button.matches("[data-download]")) { await sourceReady; download(sourceWith(cleanSlides()), sourceName.split("/").pop()); }
    else if (button.matches("[data-old-draft]")) {
      if (staleDraft?.source) download(staleDraft.source, `earlier-draft-${sourceName.split("/").pop()}`);
    } else if (button.matches("[data-discard-old-draft]")) {
      discardOldDraft();
    } else if (button.matches("[data-undo], [data-redo]")) undo(button.matches("[data-redo]"));
    else if (button.matches("[data-delete]")) deleteSelection();
    else if (button.matches("[data-slide-id]")) goTo(button.dataset.slideId);
    else if (button.matches("[data-earlier], [data-later]")) reorder(currentSlide().id, slides.indexOf(currentSlide()) + (button.matches("[data-earlier]") ? -1 : 1));
    else if (button.matches("[data-move]")) {
      const index = numberInRange($("[data-position]").value, 1, slides.length);
      if (Number.isInteger(index)) reorder(currentSlide().id, index - 1);
    } else if (button.matches("[data-nudge]")) { const [x, y] = button.dataset.nudge.split(",").map(Number); nudge(x, y, event.shiftKey); }
    else if (button.matches("[data-parent]")) select(keys.get(currentRecord()?.node.parentElement));
    else if (button.matches("[data-reset-width]")) {
      const target = widthTarget(currentRecord()?.node), key = keys.get(target);
      if (target) change((state) => {
        const style = state.styles[key];
        if (!style) return;
        delete style.width;
        if (style.widthDx) { style.dx = (style.dx ?? 0) - style.widthDx; delete style.widthDx; if (Math.abs(style.dx) < 0.01) delete style.dx; }
        if (style.widthDy) { style.dy = (style.dy ?? 0) - style.widthDy; delete style.widthDy; if (Math.abs(style.dy) < 0.01) delete style.dy; }
        if (!Object.keys(style).length) delete state.styles[key];
      });
    }
    else if (button.matches("[data-reset]") && selected) {
      const node = currentRecord().node;
      const target = widthTarget(node), targetKey = target ? keys.get(target) : null;
      change((state) => {
        delete state.styles[selected];
        if (targetKey && targetKey !== selected && state.styles[targetKey]) {
          delete state.styles[targetKey].width;
          if (state.styles[targetKey].widthDx) {
            state.styles[targetKey].dx = (state.styles[targetKey].dx ?? 0) - state.styles[targetKey].widthDx;
            delete state.styles[targetKey].widthDx;
            if (Math.abs(state.styles[targetKey].dx) < 0.01) delete state.styles[targetKey].dx;
          }
          if (state.styles[targetKey].widthDy) {
            state.styles[targetKey].dy = (state.styles[targetKey].dy ?? 0) - state.styles[targetKey].widthDy;
            delete state.styles[targetKey].widthDy;
            if (Math.abs(state.styles[targetKey].dy) < 0.01) delete state.styles[targetKey].dy;
          }
          if (!Object.keys(state.styles[targetKey]).length) delete state.styles[targetKey];
        }
        for (const key of Object.keys(state.text)) if (node.contains(records.get(key).node)) delete state.text[key];
      });
      renderInspector();
    }
  });
  let dragged = null;
  $(".editor-slides").addEventListener("dragstart", (event) => {
    dragged = event.target.closest("li")?.dataset.slideId;
    if (dragged) { event.dataTransfer.setData("text/plain", dragged); event.dataTransfer.effectAllowed = "move"; }
  });
  $(".editor-slides").addEventListener("dragover", (event) => {
    if (!dragged) return;
    event.preventDefault();
    for (const row of panel.querySelectorAll(".drag-over")) row.classList.remove("drag-over");
    event.target.closest("li")?.classList.add("drag-over");
  });
  $(".editor-slides").addEventListener("drop", (event) => {
    event.preventDefault();
    const target = event.target.closest("li")?.dataset.slideId;
    if (dragged && target) reorder(dragged, slides.findIndex((s) => s.id === target));
    dragged = null;
    renderList();
  });
  $(".editor-slides").addEventListener("dragend", () => { dragged = null; renderList(); });
  document.querySelector("[data-edit]").addEventListener("click", () => toggle());
  window.addEventListener("focus", () => {
    if ((editing || document.body.classList.contains("show-notes")) && (!file.token || !file.revision)) reconnectSaving();
  });
  window.addEventListener("pagehide", writeDraft);
  document.addEventListener("visibilitychange", () => { if (document.hidden) writeDraft(); });
  window.addEventListener("beforeunload", (event) => {
    writeDraft();
    if (storageError && signature(cleanSlides()) !== savedSignature) { event.preventDefault(); event.returnValue = ""; }
  });

  function handleKey(event) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? "") || event.target?.isContentEditable;
    const notesOpen = document.body.classList.contains("show-notes");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && (editing || notesOpen)) { event.preventDefault(); save(); return true; }
    if (event.key === "Escape" && notesDrawer.contains(event.target)) { event.preventDefault(); stage.focus({ preventScroll: true }); return true; }
    if (typing) return true;
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "e") { event.preventDefault(); toggle(); return true; }
    if (!editing && !notesOpen) return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey); return true; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); undo(true); return true; }
    if (!editing) return false;
    if (["Delete", "Backspace"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); deleteSelection(); return true;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (direction && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!selected && ["ArrowLeft", "ArrowRight"].includes(event.key)) return false;
      event.preventDefault();
      nudge(...direction, event.shiftKey);
    }
    else if (event.key === "Escape") { event.preventDefault(); if (selected) select(null); else toggle(false); }
    else if (["PageDown", "PageUp", "n", "N"].includes(event.key)) return false;
    return true; // Other presentation shortcuts cannot fire while editing.
  }
  reconnectSaving();
  return { toggle, toggleNotes, refreshNotes, handleKey, onSlideChange, positionSelection, focusNotes, getSlides: cleanSlides, get editing() { return editing; } };
}
