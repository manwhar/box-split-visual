// The presenter owns slide content and navigation. The audience window runs
// the live demos; previews use still images of the demos' initial views.
//
// A deck can index still images of its demos in a module of its own, named
// by data-demo-previews on <html> (the talk's is talk/js/demo-previews.js,
// made by talk/tools/capture-demo-previews.mjs). Without one, the next-slide
// preview marks each demo as unavailable.
import { demoSource, loadDemoPreviews, matchingPreview } from "./preview.js";
const PREFIX = "deck:presentation:";

let demoPreviews = {};
const TYPES = new Set(["ready", "state", "navigate"]);

export function presentationUrl(href, session, slideId, { app = false } = {}) {
  const url = new URL(href);
  url.searchParams.set("view", "presentation");
  url.searchParams.set("presenter", session);
  url.searchParams.delete("display");
  if (app) url.searchParams.set("display", "app");
  url.hash = slideId;
  return url.href;
}

/** Only the paired window on this origin can send presentation messages. */
export function presentationLink({ host, peer, session, onMessage }) {
  const origin = host.location.origin;
  function receive(event) {
    const source = peer();
    if (!source || event.source !== source || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.session !== session || typeof data.type !== "string") return;
    const type = data.type.startsWith(PREFIX) ? data.type.slice(PREFIX.length) : "";
    if (TYPES.has(type)) onMessage(type, data);
  }
  host.addEventListener("message", receive);
  return {
    send(type, data = {}) {
      const target = peer();
      if (!target || target.closed || !TYPES.has(type)) return false;
      target.postMessage({ ...data, type: PREFIX + type, session }, origin);
      return true;
    },
    dispose() { host.removeEventListener("message", receive); },
  };
}

/** A separately opened app has no opener. Pair it by origin and a fresh session. */
export function appPresentationLink({ session, role, onMessage, Channel = globalThis.BroadcastChannel }) {
  const channel = new Channel(`${PREFIX}app:${session}`);
  const incoming = new Set(role === "presenter" ? ["ready", "navigate", "closed"] : ["state", "end"]);
  const outgoing = new Set(role === "presenter" ? ["state", "end"] : ["ready", "navigate", "closed"]);
  let disposed = false;
  channel.onmessage = ({ data }) => {
    if (disposed || !data || data.session !== session || data.role === role || !["presenter", "audience"].includes(data.role)) return;
    const type = typeof data.type === "string" && data.type.startsWith(PREFIX) ? data.type.slice(PREFIX.length) : "";
    if (incoming.has(type)) onMessage(type, data);
  };
  return {
    send(type, data = {}) {
      if (disposed || !outgoing.has(type)) return false;
      channel.postMessage({ ...data, type: PREFIX + type, session, role });
      return true;
    },
    dispose() { disposed = true; channel.close(); },
  };
}

/**
 * What presenter mode does when its presentation window closes. A window that
 * has shown the slides was most likely closed by accident mid-talk, so the
 * presenter keeps its place and is offered the window again. One closed
 * before it ever connected was abandoned, so presenter mode ends.
 */
export function closedWindowResponse({ everConnected }) {
  return everConnected ? "offer-reopen" : "exit";
}

function audienceSlides(slides) {
  return slides.map((slide) => {
    const copy = slide.cloneNode(true);
    copy.querySelectorAll(".notes").forEach((notes) => notes.remove());
    copy.classList.remove("active");
    copy.removeAttribute("aria-hidden");
    return { id: copy.id, html: copy.outerHTML };
  });
}

function previewDocument(slide, embeds) {
  const doc = document.implementation.createHTMLDocument("Next slide preview");
  const base = doc.createElement("base");
  base.href = new URL("./", location.href).href;
  doc.head.append(base);
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) doc.head.append(link.cloneNode(true));
  doc.documentElement.dataset.presentation = "preview";
  if (document.documentElement.dataset.theme) doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
  doc.body.inert = true;
  const stage = doc.createElement("div");
  stage.className = "stage";
  const copy = slide.cloneNode(true);
  copy.classList.add("active");
  copy.removeAttribute("aria-hidden");
  copy.querySelectorAll(".notes, script").forEach((node) => node.remove());
  const rooms = [...copy.querySelectorAll(".slot, .play-room")];
  for (const [index, room] of rooms.entries()) {
    const still = matchingPreview(demoPreviews[slide.id]?.[index], demoSource(room, embeds));
    if (!still) {
      const placeholder = doc.createElement("div");
      placeholder.className = "demo-preview";
      placeholder.textContent = "Initial preview unavailable";
      room.replaceChildren(placeholder);
      continue;
    }
    const picture = doc.createElement("picture");
    picture.className = "demo-still";
    const theme = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const image = doc.createElement("img");
    image.src = theme === "dark" ? still.dark : still.light;
    image.alt = "Initial view of this slide’s demo";
    image.width = still.width;
    image.height = still.height;
    image.draggable = false;
    picture.append(image);
    room.replaceChildren(picture);
  }
  // Any other embedded content is also inert in a preview.
  copy.querySelectorAll("iframe, video, audio").forEach((node) => node.remove());
  stage.append(copy);
  doc.body.append(stage);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Presenter mode: the current slide, its notes and the next slide here, and
 * the slides in a window of their own for the audience. `appWindow` offers a
 * Chrome app window as well, which the local server opens (explorables/serve.py),
 * so a published deck, with no server behind it, offers only the browser window.
 */
export function initPresenter({ slides, currentSlide, getSlides, goTo, setPresenting, appWindow = true, embeds = [] }) {
  const button = document.querySelector("[data-presenter]");
  loadDemoPreviews().then((previews) => { demoPreviews = previews; refresh(); });
  const controls = document.createElement("div");
  controls.id = "presenter-controls";
  controls.hidden = true;
  controls.innerHTML = `
    <div class="presenter-closed" role="alert" hidden>
      <p><b data-closed-title>The presentation window is closed.</b> The audience can’t see your slides.</p>
      <div><button type="button" class="primary" data-reopen-window>Reopen presentation window</button>
      <button type="button" data-closed-exit>Exit presenter</button></div>
    </div>
    <div class="presenter-current-label"><b>Current slide</b><span data-current-title></span></div>
    <aside class="presenter-sidebar" aria-label="Presentation controls">
      <section class="presenter-next" aria-labelledby="presenter-next-label">
        <div class="presenter-panel-heading"><h2 id="presenter-next-label">Next slide</h2><span data-next-number></span></div>
        <div class="presenter-preview"><iframe title="Next slide preview" sandbox="allow-same-origin" tabindex="-1"></iframe><p data-end hidden>End of presentation</p></div>
        <span class="presenter-preview-kind" data-next-state>Initial view</span>
        <p class="presenter-next-title" data-next-title></p>
      </section>
      <section class="presenter-window-controls" aria-label="Presentation window">
        <h2>Presentation window</h2>
        <p data-window-status role="status"></p>
        <button type="button" class="primary" data-open-presentation>Show presentation window</button>
        ${appWindow ? `<button type="button" data-open-app>Open app window</button>
        <p>In Chrome, use the app window for a resizable presentation without an address bar. Keep it beside your notes and share that window.</p>` : `<p>Keep the presentation window beside your notes and share that window.</p>`}
        <p>Use <kbd>←</kbd> <kbd>→</kbd> here to change slides. Interactive demos run in the presentation window.</p>
        <button type="button" data-end-presentation>Exit presenter mode</button>
      </section>
    </aside>`;
  const notice = document.createElement("div");
  notice.className = "presenter-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  document.body.append(controls, notice);
  button.setAttribute("aria-controls", controls.id);
  const preview = controls.querySelector("iframe");
  const status = controls.querySelector("[data-window-status]");
  const openButton = controls.querySelector("[data-open-presentation]");
  const appButton = controls.querySelector("[data-open-app]"); // null without an app window
  const closedBanner = controls.querySelector(".presenter-closed");
  const reopenButton = closedBanner.querySelector("[data-reopen-window]");
  const session = crypto.randomUUID();
  let active = false, popup = null, monitor = null, snapshot = null, nextMarkup = null;
  let notesWereOpen = false;
  let appLink = null, pendingApp = null, appTimeout = null;
  // Whether any presentation window has shown the slides since presenter mode
  // started, and which kind of window ("browser" or "app") the banner reopens.
  let everConnected = false, closedKind = null;
  const link = presentationLink({ host: window, peer: () => popup, session, onMessage(type, data) {
    if (!active) return;
    if (type === "ready") {
      everConnected = true;
      hideClosed();
      status.textContent = "Connected · slides stay in sync";
      sendState(true);
    } else if (type === "navigate" && slides.some((slide) => slide.id === data.id)) goTo(data.id);
  } });

  function sendState(includeSlides = false) {
    if (!active) return;
    const data = { id: currentSlide().id };
    if (includeSlides || !snapshot) {
      snapshot ??= audienceSlides(getSlides());
      data.slides = snapshot;
    }
    (appLink || link).send("state", data);
  }

  function refresh({ contentChanged = false } = {}) {
    if (contentChanged) snapshot = null;
    if (!active) return;
    const current = currentSlide();
    const index = slides.indexOf(current);
    controls.querySelector("[data-current-title]").textContent = `${index + 1} / ${slides.length} · ${current.querySelector("h1, h2")?.textContent.trim() ?? current.id}`;
    const next = slides[index + 1];
    preview.hidden = !next;
    controls.querySelector("[data-end]").hidden = Boolean(next);
    controls.querySelector("[data-next-number]").textContent = next ? `${index + 2} / ${slides.length}` : "";
    controls.querySelector("[data-next-state]").hidden = !next;
    controls.querySelector("[data-next-title]").textContent = next?.querySelector("h1, h2")?.textContent.trim() ?? "";
    const markup = next ? previewDocument(next, embeds) : "";
    if (markup !== nextMarkup) { preview.srcdoc = markup; nextMarkup = markup; }
    sendState(contentChanged);
  }

  /**
   * The banner over the current slide when a presentation window that had
   * connected closes. Its Reopen button takes the keyboard, so Enter reopens
   * the window, unless the presenter is typing (in the notes, say).
   */
  function showClosed(kind) {
    closedKind = kind;
    const app = kind === "app";
    closedBanner.querySelector("[data-closed-title]").textContent = app ? "The app window is closed." : "The presentation window is closed.";
    reopenButton.textContent = app ? "Reopen app window" : "Reopen presentation window";
    const wasHidden = closedBanner.hidden;
    closedBanner.hidden = false;
    const focused = document.activeElement;
    const typing = focused && (/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName) || focused.isContentEditable);
    if (wasHidden && !typing) reopenButton.focus();
  }

  function hideClosed() {
    if (closedBanner.hidden) return;
    // A hidden button can't keep the keyboard; hand it back to the deck's keys.
    if (closedBanner.contains(document.activeElement)) document.activeElement.blur();
    closedBanner.hidden = true;
    closedKind = null;
  }

  function openWindow() {
    if (popup && !popup.closed) { popup.focus(); return true; }
    popup = window.open(presentationUrl(location.href, session, currentSlide().id), `deck-presentation-${session}`, "popup=yes,width=1280,height=800,resizable=yes,scrollbars=no");
    if (!popup) {
      notice.textContent = "The presentation window was blocked. Allow pop-ups for this site, then try again.";
      notice.hidden = false;
      return false;
    }
    disconnectApp();
    notice.hidden = true;
    status.textContent = "Opening the presentation window…";
    openButton.textContent = "Show presentation window";
    return true;
  }

  function disconnectApp() {
    clearTimeout(appTimeout);
    pendingApp?.send("end");
    pendingApp?.dispose();
    pendingApp = null;
    appLink?.send("end");
    appLink?.dispose();
    appLink = null;
    if (appButton) appButton.disabled = false;
  }

  async function openAppWindow() {
    if (!active || appButton.disabled) return;
    appButton.disabled = true;
    notice.hidden = true;
    let candidate = null;
    try {
      if (!window.BroadcastChannel) throw new Error("Open the presenter in Chrome to use an app window.");
      const response = await fetch(new URL("index.html", location.href), { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const token = response.headers.get("X-Deck-Token");
      if (!response.ok || !token || response.headers.get("X-Deck-App-Window") !== "1") {
        throw new Error("Restart the local server with python3 explorables/serve.py, then try Open app window again.");
      }
      if (!active) return;
      pendingApp?.dispose();
      clearTimeout(appTimeout);
      const appSession = crypto.randomUUID();
      candidate = appPresentationLink({ session: appSession, role: "presenter", onMessage(type, data) {
        if (!active || (candidate !== pendingApp && candidate !== appLink)) return;
        if (type === "ready") {
          if (candidate !== appLink) {
            appLink?.send("end");
            appLink?.dispose();
            appLink = candidate;
            pendingApp = null;
            if (popup && !popup.closed) popup.close();
            popup = null;
          }
          clearTimeout(appTimeout);
          everConnected = true;
          hideClosed();
          appButton.disabled = false;
          status.textContent = "App window connected · slides stay in sync";
          openButton.textContent = "Open browser window";
          appButton.textContent = "Reopen app window";
          sendState(true);
        } else if (type === "navigate" && candidate === appLink && slides.some(slide => slide.id === data.id)) {
          goTo(data.id);
        } else if (type === "closed" && candidate === appLink) {
          // Retain the pairing so a reload can reconnect on the same address.
          status.textContent = "The app window is closed. Reopen it to continue from this slide.";
          showClosed("app");
        }
      } });
      pendingApp = candidate;
      status.textContent = "Opening the app window…";
      const launched = await fetch(new URL("__app-window", location.href), {
        method: "POST", headers: { "Content-Type": "application/json", "X-Deck-Token": token },
        body: JSON.stringify({ url: presentationUrl(location.href, appSession, currentSlide().id, { app: true }) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!launched.ok) {
        const failure = await launched.json().catch(() => ({}));
        throw new Error(failure.error || "The app window could not be opened.");
      }
      if (pendingApp === candidate) appTimeout = setTimeout(() => {
        appButton.disabled = false;
        status.textContent = "Waiting for the app window. Keep the presenter and app in the same Chrome profile.";
      }, 12000);
    } catch (error) {
      if (pendingApp === candidate) { candidate?.dispose(); pendingApp = null; }
      if (active) {
        notice.textContent = error.message || "The app window could not be opened.";
        notice.hidden = false;
      }
      appButton.disabled = false;
    }
  }

  function start() {
    if (active) return openWindow();
    if (!openWindow()) return false;
    notesWereOpen = document.body.classList.contains("show-notes");
    active = true;
    everConnected = false;
    snapshot = null;
    controls.hidden = false;
    document.body.classList.add("presenter-mode");
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Exit presenter";
    setPresenting(true);
    refresh();
    monitor = setInterval(() => {
      if (popup?.closed) {
        popup = null;
        if (closedWindowResponse({ everConnected }) === "exit") { stop(); return; }
        showClosed("browser");
        status.textContent = "The presentation window is closed. Reopen it to continue from this slide.";
        openButton.textContent = "Reopen presentation window";
      }
    }, 750);
    return true;
  }

  function stop() {
    if (!active) return;
    active = false;
    disconnectApp();
    if (popup && !popup.closed) popup.close();
    popup = null;
    clearInterval(monitor);
    hideClosed();
    controls.hidden = true;
    notice.hidden = true;
    document.body.classList.remove("presenter-mode");
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Presenter";
    setPresenting(false, notesWereOpen);
    button.focus();
  }

  button.addEventListener("click", () => active ? stop() : start());
  openButton.addEventListener("click", openWindow);
  appButton?.addEventListener("click", openAppWindow);
  controls.querySelector("[data-end-presentation]").addEventListener("click", stop);
  reopenButton.addEventListener("click", () => closedKind === "app" ? openAppWindow() : openWindow());
  closedBanner.querySelector("[data-closed-exit]").addEventListener("click", stop);
  new ResizeObserver(([entry]) => {
    preview.style.transform = `scale(${entry.contentRect.width / 1600})`;
  }).observe(controls.querySelector(".presenter-preview"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => refresh());
  window.addEventListener("pagehide", () => { disconnectApp(); if (popup && !popup.closed) popup.close(); });
  return { refresh, start, stop, toggle: () => active ? stop() : start(), get active() { return active; } };
}

export function initAudience({ applySlides, currentSlide, goTo, pause = () => {} }) {
  const params = new URLSearchParams(location.search);
  const session = params.get("presenter");
  const app = params.get("display") === "app";
  const notice = document.createElement("p");
  notice.className = "audience-notice";
  notice.textContent = "Connecting to the presenter…";
  document.body.append(notice);
  let connected = false, receiving = false, lastContent = null;
  function onMessage(type, data) {
    if (type === "end") {
      connected = false;
      clearInterval(ready);
      pause();
      delete document.documentElement.dataset.connected;
      notice.textContent = "Presentation ended. Reopen the app window from the presenter to reconnect.";
      notice.hidden = false;
      link.dispose();
      window.close();
      return;
    }
    if (type !== "state" || typeof data.id !== "string") return;
    if (!connected && !Array.isArray(data.slides)) return;
    receiving = true;
    try {
      if (Array.isArray(data.slides)) {
        const content = JSON.stringify(data.slides);
        if (content !== lastContent) { applySlides(data.slides); lastContent = content; }
      }
      connected = true;
      document.documentElement.dataset.connected = "true";
      notice.hidden = true;
      clearInterval(ready);
      goTo(data.id);
    } finally { receiving = false; }
  }
  const link = app
    ? appPresentationLink({ session, role: "audience", onMessage })
    : presentationLink({ host: window, peer: () => window.opener, session, onMessage });
  const ready = setInterval(() => {
    if (!app && (!window.opener || window.opener.closed)) {
      notice.textContent = "Open the slides and choose Presenter to connect this display.";
      clearInterval(ready);
    } else link.send("ready");
  }, 500);
  link.send("ready");
  if (app) window.addEventListener("pagehide", () => { link.send("closed"); link.dispose(); });
  return {
    get connected() { return connected; },
    refresh() {
      if (connected && !receiving) link.send("navigate", { id: currentSlide().id });
    },
  };
}
