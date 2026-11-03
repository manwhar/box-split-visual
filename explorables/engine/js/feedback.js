// Slide feedback: the bottom-right reaction picker and its short conversation,
// and the store that saves replies. It is independent of usage analytics
// (analytics.js): deck.js starts both and may connect them through two
// optional hooks, `identity` (attach the reader's analytics IDs) and
// `onEvent` (report widget use as analytics interactions).
//
// Saving follows the same create-only rule as the logs (firebase/firestore.rules):
// every save, including an edit, creates a new `feedback` document. Entries
// for one response share a `responseId`; the one with the highest `revision`
// (then the latest `_createdAt`) is the current text. The thank-you animation
// runs only after Firestore confirms a save; errors leave the reply editable.
import { uuid, isId, destination, openWriter, safeStorage, readStored, writeStored } from "./collection.js";

export const REACTIONS = {
  confused: { emoji: "😕", name: "I'm confused", question: "Thanks for letting us know. What felt confusing?" },
  positive: { emoji: "🤩", name: "This is amazing!", question: "That's great to hear! Can you share more about what was most helpful or what you found delightful?" },
  broken: { emoji: "🐛", name: "Something broke", question: "Sorry about that. What happened when you tried it?" },
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
}[name]}</svg>`;

/**
 * The widget alone. `currentContext()` names the showing slide, `getSaved` and
 * `submit` reach the store, and `onEvent(action)` reports "open", "edit",
 * "submit" and "dismiss".
 */
export function initFeedbackWidget({ currentContext, getSaved, submit, onEvent = () => {} }) {
  const root = document.createElement("div"); root.id = "explorable-feedback";
  root.innerHTML = `<div class="fm-surface" data-state="idle" aria-label="Slide feedback">
    <button class="fm-launcher" type="button" aria-label="Leave feedback" aria-expanded="false" aria-controls="feedback-reactions">${icon("chat")}</button>
    <div class="fm-picker" id="feedback-reactions" role="group" aria-label="How did this slide feel?" aria-hidden="true" inert></div>
    <div class="fm-chat" role="dialog" aria-modal="false" aria-hidden="true" inert>
      <button class="fm-close" type="button" aria-label="Dismiss feedback">${icon("close")}</button>
      <div class="fm-messages" role="log" aria-live="polite" aria-label="Feedback conversation"></div>
      <div class="fm-compose" hidden><textarea aria-label="Optional reply" rows="1" maxlength="500" placeholder="Reply… (optional)"></textarea>
      <button class="fm-send" type="button" aria-label="Send feedback">${icon("check")}</button></div>
      <p class="fm-error" role="alert" hidden></p>
    </div></div><div class="fm-tooltip" id="feedback-tooltip" role="tooltip" hidden></div>`;
  document.body.append(root);
  const surface = root.querySelector(".fm-surface"), launcher = root.querySelector(".fm-launcher");
  const picker = root.querySelector(".fm-picker"), chat = root.querySelector(".fm-chat");
  const messages = root.querySelector(".fm-messages"), composer = root.querySelector(".fm-compose");
  const input = root.querySelector("textarea"), sendButton = root.querySelector(".fm-send");
  const closeButton = root.querySelector(".fm-close"), error = root.querySelector(".fm-error"), tooltip = root.querySelector(".fm-tooltip");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let mode = "idle", target = null, reaction = null, busy = false, pinned = false;
  let epoch = 0, openTimer, leaveTimer;
  const timers = new Set(), animations = new Set();
  function later(fn, delay) {
    const stamp = epoch;
    const timer = setTimeout(() => { timers.delete(timer); if (stamp === epoch) fn(); }, reduced.matches ? 0 : delay);
    timers.add(timer);
  }
  function cancel() { epoch++; timers.forEach(clearTimeout); timers.clear(); animations.forEach(a => a.cancel()); animations.clear(); }
  function animate(el, frames, duration = 360, delay = 0) {
    if (reduced.matches) return;
    const animation = el.animate(frames, {duration, delay, easing:"cubic-bezier(.22,1,.36,1)", fill:"both"});
    animations.add(animation);
    animation.finished.then(() => { animations.delete(animation); animation.cancel(); }, () => animations.delete(animation));
  }
  function measure() {
    const view = window.visualViewport;
    const width = Math.min(300, (view?.width ?? innerWidth) - 32);
    root.style.bottom = `${Math.max(16, innerHeight - (view?.height ?? innerHeight) - (view?.offsetTop ?? 0) + 16)}px`;
    chat.style.width = `${width - 2}px`;
    chat.style.maxHeight = `${Math.max(120, (view?.height ?? innerHeight) - 40)}px`;
    if (!composer.hidden) { input.style.height = "32px"; input.style.height = `${Math.min(100, Math.max(32, input.scrollHeight))}px`; }
    // The picker is the launcher (44px) plus the reactions to its left (144px), inside a 1px border.
    surface.style.width = `${mode === "idle" ? 46 : mode === "picker" ? 190 : width}px`;
    surface.style.height = `${mode === "chat" ? Math.min(chat.scrollHeight, parseFloat(chat.style.maxHeight)) + 2 : 46}px`;
  }
  function activate(next) {
    mode = next; surface.dataset.state = next; tooltip.hidden = true;
    // The launcher stays usable beside the picker; only the chat takes its place.
    for (const [el, shown] of [[launcher, next !== "chat"],[picker, next === "picker"],[chat, next === "chat"]]) {
      el.inert = !shown; el.setAttribute("aria-hidden", String(!shown));
    }
    launcher.setAttribute("aria-expanded", String(next !== "idle")); measure();
  }
  function reflow(change) {
    const before = new Map([...messages.children].map(el => [el, el.getBoundingClientRect().top]));
    change(); measure();
    for (const [el, top] of before) {
      const shift = top - el.getBoundingClientRect().top;
      if (shift) animate(el, [{transform:`translateY(${shift}px)`},{transform:"translateY(0)"}]);
    }
  }
  function bubble(text, outgoing = false) {
    const p = document.createElement("p"); p.className = `fm-message${outgoing ? " fm-outgoing" : ""}`; p.textContent = text;
    reflow(() => messages.append(p));
    animate(p, [{opacity:0,transform:"translateY(12px) scale(.94)"},{opacity:1,transform:"translateY(0) scale(1)"}]);
    return p;
  }
  function dismiss({ focus = true } = {}) {
    clearTimeout(openTimer); clearTimeout(leaveTimer); cancel(); pinned = false;
    const wasChat = mode === "chat";
    activate("idle"); target = null; reaction = null;
    if (wasChat) onEvent("dismiss");
    refresh(); if (focus && !root.hidden) launcher.focus({preventScroll:true});
  }
  function refresh() {
    const current = currentContext();
    for (const button of picker.children) {
      const saved = current && getSaved(current, button.dataset.kind);
      button.dataset.submitted = String(Boolean(saved));
      button.setAttribute("aria-description", saved ? "Feedback saved. Select to edit your reply." : "");
    }
  }
  function refreshSend() {
    const previous = target && getSaved(target, reaction);
    sendButton.setAttribute("aria-label", previous ? (input.value.trim() === previous.text ? "Done" : "Save changes") : "Send feedback");
  }
  function reveal(keyboard = false) {
    if (mode !== "idle" || !currentContext()) return;
    clearTimeout(openTimer); clearTimeout(leaveTimer); refresh(); activate("picker");
    if (keyboard) picker.firstElementChild.focus({preventScroll:true});
  }
  function open(kind) {
    if (busy || !currentContext()) return;
    cancel(); clearTimeout(openTimer); clearTimeout(leaveTimer);
    target = { ...currentContext() }; reaction = kind; pinned = true;
    const choice = REACTIONS[kind], previous = getSaved(target, kind);
    input.disabled = false; sendButton.disabled = false; input.value = previous?.text ?? "";
    messages.replaceChildren(); composer.hidden = true; error.hidden = true;
    chat.setAttribute("aria-label", `Feedback about slide ${target.slideNumber}: ${target.slideId}`);
    activate("chat"); onEvent(previous ? "edit" : "open");
    bubble(`${choice.emoji} ${choice.name}`, true); closeButton.focus({preventScroll:true}); refreshSend();
    later(() => {
      bubble(previous ? "Your feedback is saved. Want to add or change anything?" : choice.question);
      reflow(() => { composer.hidden = false; });
      animate(composer, [{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"translateY(0)"}], 320, 100);
      input.focus({preventScroll:true}); input.setSelectionRange(input.value.length, input.value.length);
    }, 320);
  }
  for (const [kind, choice] of Object.entries(REACTIONS)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "fm-emoji";
    button.dataset.kind = kind; button.setAttribute("aria-label", choice.name);
    button.innerHTML = `<span aria-hidden="true">${choice.emoji}</span><span class="fm-saved" aria-hidden="true">${icon("check")}</span>`;
    picker.append(button); button.addEventListener("click", () => open(kind));
    const showTooltip = () => {
      if (mode !== "picker") return;
      tooltip.textContent = choice.name; tooltip.hidden = false;
      const r = button.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(innerWidth - tooltip.offsetWidth - 8, r.left + r.width/2 - tooltip.offsetWidth/2))}px`;
      tooltip.style.top = `${r.top - tooltip.offsetHeight - 8}px`;
      button.setAttribute("aria-describedby", tooltip.id);
    };
    button.addEventListener("pointerenter", showTooltip); button.addEventListener("focus", showTooltip);
    for (const event of ["pointerleave", "blur"]) button.addEventListener(event, () => { tooltip.hidden = true; button.removeAttribute("aria-describedby"); });
  }
  async function save() {
    if (busy || mode !== "chat" || composer.hidden || !target) return;
    const text = input.value.trim(), previous = getSaved(target, reaction);
    if (previous?.text === text) { dismiss(); return; }
    const stamp = epoch;
    busy = true; input.disabled = true; sendButton.disabled = true; error.hidden = true;
    try {
      await submit(target, reaction, text);
      onEvent("submit");
      if (stamp !== epoch) return;
      refresh(); reflow(() => { composer.hidden = true; });
      if (text) bubble(text, true);
      closeButton.focus({preventScroll:true});
      later(() => {
        bubble(previous ? "Updated. Thanks for sharing!" : "Thanks, that helps.");
        // Reduced motion removes movement, not the time to read confirmation.
        const timer = setTimeout(() => { timers.delete(timer); if (stamp === epoch) dismiss(); }, 1450); timers.add(timer);
      }, 380);
    } catch (e) {
      if (stamp !== epoch) return;
      error.textContent = e.message || "Couldn’t save. Please try again."; error.hidden = false; measure();
    } finally { busy = false; input.disabled = false; sendButton.disabled = false; }
  }
  surface.addEventListener("pointerenter", e => { clearTimeout(leaveTimer); if (e.pointerType === "mouse" && mode === "idle") openTimer = setTimeout(() => reveal(),90); });
  surface.addEventListener("pointerleave", () => {
    clearTimeout(openTimer); leaveTimer = setTimeout(() => {
      if (mode === "picker" && !pinned && !picker.contains(document.activeElement)) activate("idle");
    },220);
  });
  // A click pins the picker open, whether or not hovering already opened it; a
  // click on a pinned picker's launcher closes it. A keyboard click (detail 0)
  // also moves focus to the first reaction.
  launcher.addEventListener("click", e => {
    if (mode === "picker" && pinned) { dismiss(); return; }
    pinned = true; reveal(e.detail === 0);
  });
  closeButton.addEventListener("click", () => dismiss()); sendButton.addEventListener("click", save);
  input.addEventListener("input", () => { refreshSend(); reflow(() => {}); });
  root.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); dismiss(); }
    else if (e.key === "Enter" && e.target === input && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    else if (mode === "picker" && ["ArrowLeft","ArrowRight"].includes(e.key)) {
      e.preventDefault(); const buttons = [...picker.children], i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3].focus();
    }
  });
  surface.addEventListener("focusout", e => { if (mode === "picker" && !surface.contains(e.relatedTarget)) { pinned = false; activate("idle"); } });
  document.addEventListener("pointerdown", e => { if (mode === "picker" && !root.contains(e.target)) { pinned = false; activate("idle"); } });
  window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("scroll", measure);
  return { refresh, setHidden(hidden) { if (hidden) dismiss({focus:false}); root.hidden = hidden; } };
}

/**
 * Saved replies for one browser tab. A tab has a random feedbackSessionId in
 * sessionStorage: closing the tab ends its editing session, and a later tab
 * starts new responses. Each save creates a new document:
 *   { schemaVersion, responseId, revision, deckId, contentVersion, slideId,
 *     slideNumber, reaction, text, feedbackSessionId, __deviceId, __sessionId,
 *     _createdAt }
 * The analytics IDs are null if analytics isn't running. A failed save keeps its
 * document ID, so retrying the same text can't create a second copy.
 */
export class FeedbackStore {
  constructor({ storage, write, id = uuid, now = Date.now }) {
    Object.assign(this, { storage, write, id, now });
    const saved = readStored(storage, "explorables:feedback", {});
    this.saved = saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).filter(([, r]) =>
      r && isId(r.responseId) && Number.isSafeInteger(r.revision) && r.revision > 0 && typeof r.text === "string")) : {};
    this.pending = new Map();   // key → { entryId, record } awaiting confirmation
  }
  /** The tab's feedback session, created on the first save so that reading creates nothing. */
  sessionId() {
    let session = readStored(this.storage, "explorables:feedback-session");
    if (!isId(session)) { session = this.id(); writeStored(this.storage, "explorables:feedback-session", session); }
    return (this.session ??= session);
  }
  key(context, reaction) { return [context.deckId, context.contentVersion, context.slideId, reaction].join(":"); }
  get(context, reaction) { return this.saved[this.key(context, reaction)]; }
  async submit(context, reaction, text, identity = null) {
    const key = this.key(context, reaction), previous = this.saved[key];
    if (previous?.text === text) return previous;
    let attempt = this.pending.get(key);
    if (!attempt || attempt.record.text !== text) {
      const { deckId, contentVersion, slideId, slideNumber } = context;
      attempt = { entryId: this.id(), record: { schemaVersion: 1,
        responseId: previous?.responseId ?? attempt?.record.responseId ?? this.id(),
        revision: (previous?.revision ?? 0) + 1, deckId, contentVersion, slideId, slideNumber, reaction, text,
        feedbackSessionId: this.sessionId(),
        __deviceId: identity?.__deviceId ?? null, __sessionId: identity?.__sessionId ?? null } };
      this.pending.set(key, attempt);
    }
    let result;
    try {
      result = await this.write("feedback", attempt.entryId,
        { ...attempt.record, _createdAt: this.now() });
    } catch { throw new Error("Couldn’t save your feedback. Please try again."); }
    if (result === "rejected") throw new Error("Couldn’t save your feedback.");
    this.saved[key] = attempt.record; this.pending.delete(key);
    writeStored(this.storage, "explorables:feedback", this.saved);
    return attempt.record;
  }
}

/**
 * Start slide feedback for this page, where collection is allowed (see
 * collection.js). Returns the deck's hooks: slide(slideElement, number) when a
 * slide shows, and setHidden(hidden) for presenter mode. In console mode,
 * saves are printed and kept only in page memory.
 */
export function initSlideFeedback({ published, authoring, audience, identity = () => null, onEvent = () => {}, configuration, kind: forcedKind }) {
  const root = document.documentElement;
  const environment = { published, authoring, audience, hostname: location.hostname, protocol: location.protocol };
  const kind = forcedKind ?? destination(environment, configuration);
  if (kind === "off" || !root.dataset.contentVersion) return { slide() {}, setHidden() {} };
  const store = new FeedbackStore({ storage: kind === "console" ? null : safeStorage("sessionStorage"),
    write: openWriter(kind, configuration ? { configuration } : {}) });
  const deckId = root.dataset.deck, contentVersion = root.dataset.contentVersion;
  let current = null;
  const widget = initFeedbackWidget({
    currentContext: () => current && { deckId, contentVersion, ...current },
    getSaved: (target, reaction) => store.get(target, reaction),
    submit: (target, reaction, text) => store.submit(target, reaction, text, identity()),
    onEvent,
  });
  return {
    slide(slide, slideNumber) { current = { slideId: slide.id, slideNumber }; widget.refresh(); },
    setHidden: hidden => widget.setHidden(hidden),
  };
}
