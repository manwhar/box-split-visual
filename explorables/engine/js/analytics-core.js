// Framework-independent usage analytics: identity, the time tracker and the
// outbox. The record format follows angular-schematics' TimeAnalyticsService
// and LogService, so its BigQuery views (logs_latest, events_flat) read
// these logs unchanged:
//
//   { __deviceId, __sessionId, route, state, startTime,
//     time: [{type: "active"|"rest", total}],             chronological runs
//     interactions?: [{0: ms, 1: category, 2: action, 3: JSON string|null}],
//     _createdAt, _updatedAt }                            added when sent
//
// plus deckId, contentVersion, endTime and schemaVersion. There is no
// __userId: decks have no login. Logs are kept indefinitely; browsers can
// create them but never read them (firebase/firestore.rules).
//
// One record is one segment: an unbroken stay in one context (deck, slide,
// panel, mode) while the tab is visible. Records are written once, when the
// segment ends, under the original's document ID `${__sessionId}__${startTime}`.
// A retry therefore finds the document already there instead of counting twice.
// Durations are milliseconds. DOM text and typed values never enter a record.
import { DAY, isId, uuid, readStored, writeStored, removeStored, requestBytes } from "./collection.js";

/** A gap between two user events longer than this is rest, not active time (as in the original). */
export const BREAK_THRESHOLD = 60000;
/** Segments are split at these sizes so documents stay small; firestore.rules enforces them too. */
export const LIMITS = { time: 200, interactions: 500 };

/**
 * __deviceId lives in localStorage and, as in the original SessionService, is
 * kept until the browser's storage is cleared; __sessionId lives in
 * sessionStorage, so it lasts for the tab, including reloads.
 */
export function createIdentity({ local, session, id = uuid } = {}) {
  const stored = readStored(local, "explorables:device");
  // An ID saved by an earlier engine as {id, createdAt} is kept, not replaced.
  let deviceId = isId(stored) ? stored : stored?.id;
  if (!isId(deviceId)) {
    deviceId = id(); writeStored(local, "explorables:device", deviceId);
  }
  let sessionId = readStored(session, "explorables:session");
  if (!isId(sessionId)) {
    sessionId = id(); writeStored(session, "explorables:session", sessionId);
  }
  return { __deviceId: deviceId, __sessionId: sessionId };
}

/** The original's document ID: unique per tab because start times are unique per tab. */
export const logId = record => `${record.__sessionId}__${record.startTime}`;

/**
 * A finished record as it is written: like the original LogService, add
 * _createdAt (the start time) and _updatedAt (the time of writing).
 */
export const prepareLog = (record, now = Date.now()) => ({ ...record, _createdAt: record.startTime, _updatedAt: now });

/** Interaction payloads are stored as JSON strings, as TimeAnalyticsService does. */
export function serializeInteractionData(data) {
  if (data === null || data === undefined) return null;
  return JSON.stringify(typeof data === "object" ? data : { value: data });
}

/**
 * Splits a tab's time into segments and measures each one with
 * TimeAnalyticsService's rule. Every user event (pointer movement, press,
 * key, scroll, touch) closes an interval since the previous one:
 *   - an interval of BREAK_THRESHOLD or less is active time, added to the
 *     current active run;
 *   - a longer interval is rest, recorded as a rest run of its full length.
 * `time` therefore lists active and rest runs in the order they happened.
 *
 * Unlike the original, a segment also ends when the tab is hidden. The moment
 * a segment ends (a slide change, a tab switch, closing the page) is itself a
 * user action, so it closes the last interval by the same rule.
 *
 * `emit` receives each finished record. Times are wall-clock milliseconds,
 * passed in so tests control them.
 */
export class TimeTracker {
  constructor({ identity, emit = () => {}, limits = LIMITS }) {
    Object.assign(this, { identity, emit, limits });
    this.context = null;      // { deckId, contentVersion, route, state }
    this.visible = true;
    this.segment = null;      // { startTime, last, time, interactions }
    this.lastStart = -Infinity;
  }
  /** Start a segment at `at` when there is a context and the tab is visible. */
  open(at) {
    if (!this.context || !this.visible || this.segment) return;
    // Two segments of one tab never share a start time, and so never a document ID.
    const startTime = Math.max(Math.round(at), this.lastStart + 1);
    this.lastStart = startTime;
    this.segment = { startTime, last: startTime, time: [{ type: "active", total: 0 }], interactions: null };
  }
  /** Apply the interval rule up to `at`. Returns false when there is nothing to count. */
  count(at) {
    const s = this.segment;
    if (!s) return false;
    const interval = Math.round(at) - s.last;
    if (interval <= 0) return false;
    s.last += interval;
    const active = interval > BREAK_THRESHOLD ? 0 : interval;
    const recent = s.time.at(-1);
    if (active && recent.type === "active") recent.total += active;
    else if (active) s.time.push({ type: "active", total: active });
    else s.time.push({ type: "rest", total: interval });
    return true;
  }
  /** A user event at `at`. */
  activity(at) {
    if (this.count(at) && this.segment.time.length >= this.limits.time) this.rotate(at);
  }
  /** Add a [timestamp, category, action, JSON data] tuple to the current segment. */
  interaction(category, action, data = null, at = Date.now()) {
    const s = this.segment;
    if (!s) return;
    (s.interactions ??= []).push({ 0: Math.round(at), 1: String(category), 2: String(action), 3: serializeInteractionData(data) });
    if (s.interactions.length >= this.limits.interactions) this.rotate(at);
  }
  /** The current segment as a record, without ending it (for the 5-second save). */
  snapshot(at) {
    const s = this.segment;
    if (!s) return null;
    return { schemaVersion: 1, ...this.identity, ...this.context, startTime: s.startTime,
      endTime: Math.max(Math.round(at), s.last), time: s.time.map(t => ({ ...t })),
      ...(s.interactions ? { interactions: s.interactions.map(i => ({ ...i })) } : {}) };
  }
  /** End the current segment at `at` and emit its record. */
  close(at) {
    if (!this.segment) return null;
    this.count(at);
    const record = this.snapshot(at);
    this.segment = null;
    this.emit(record);
    return record;
  }
  /** Move to a new context (slide, panel or mode). Identical contexts change nothing. */
  setContext(context, at) {
    if (JSON.stringify(context) === JSON.stringify(this.context)) return;
    this.close(at);
    this.context = context;
    this.open(at);
  }
  hide(at) { this.close(at); this.visible = false; }
  show(at) { this.visible = true; this.open(at); }
  /** Continue the same context in a new document when one grows to its limit. */
  rotate(at) { this.close(at); this.open(at); }
}

/** A page whose outbox hasn't been saved for this long is gone; others may adopt its records. */
export const STALE_AFTER = 60000;
export const OUTBOX_PREFIX = "explorables:outbox:";

/**
 * Finished records waiting to be created in Firestore, kept in localStorage
 * under one key per page load, with the page's open segment saved beside
 * them every few seconds. A record leaves the outbox once Firestore has it
 * (created now or by an earlier attempt) or refuses it outright.
 *
 * When a page dies without sending (a crash, a lost connection, a phone
 * closing a background tab), the next page on this browser adopts its records,
 * including its last open segment, which becomes final as saved. Retrying a
 * record that did arrive is harmless: its document ID already exists.
 */
export class Outbox {
  constructor({ storage, key = OUTBOX_PREFIX + uuid(), now = Date.now, limit = 200 }) {
    Object.assign(this, { storage, key, now, limit });
    this.records = new Map();   // document ID → { queuedAt, record }
    this.open = null;           // the page's current, unfinished segment
    this.busy = null;
    this.again = null;        // a flush asked for while one was in flight
    this.departed = new Set(); // IDs already sent by a keepalive flush of this page
  }
  /** Valid, unexpired entries from a stored outbox value. */
  static entries(value, now) {
    const queued = Array.isArray(value?.queued) ? value.queued : [];
    return queued.filter(entry => typeof entry?.record?.__sessionId === "string" && Number.isSafeInteger(entry.record.startTime) &&
      Number.isFinite(entry.queuedAt) && entry.queuedAt <= now && now - entry.queuedAt < DAY);
  }
  persist() {
    if (!this.records.size && !this.open) { removeStored(this.storage, this.key); return; }
    writeStored(this.storage, this.key, { savedAt: this.now(), queued: [...this.records.values()], open: this.open });
  }
  put(record) {
    const id = logId(record);
    if (!this.records.has(id)) this.records.set(id, { queuedAt: this.now(), record });
    // The oldest records go first when a long offline stay fills the outbox.
    while (this.records.size > this.limit) this.records.delete(this.records.keys().next().value);
    this.persist();
  }
  /** Save the open segment (or null once it has ended). This also marks the page alive. */
  checkpoint(record) { this.open = record; this.persist(); }
  get size() { return this.records.size; }
  /**
   * Adopt the records of pages that stopped saving STALE_AFTER ago or more,
   * at most `max` of them per call. Live tabs keep their own outboxes.
   */
  adoptStale(max = 10) {
    let keys = [];
    try { keys = Object.keys(this.storage ?? {}).filter(k => k.startsWith(OUTBOX_PREFIX) && k !== this.key); } catch { return 0; }
    let adopted = 0;
    for (const key of keys) {
      if (adopted >= max) break;
      const value = readStored(this.storage, key);
      if (Number.isFinite(value?.savedAt) && this.now() - value.savedAt < STALE_AFTER) continue;
      for (const entry of Outbox.entries(value, this.now())) this.put(entry.record);
      if (typeof value?.open?.__sessionId === "string" && Number.isSafeInteger(value.open.startTime) &&
          Number.isFinite(value.savedAt) && this.now() - value.savedAt < DAY) this.put(value.open);
      removeStored(this.storage, key);
      adopted++;
    }
    return adopted;
  }
  /**
   * Send every queued record through `write` (collection.js's openWriter),
   * prepared by `prepare`. Ordinary flushes go one at a time and stop at the
   * first network failure. A keepalive flush (the page is closing) starts all
   * requests at once within keepalive's 64 KB budget and can't wait for
   * answers, so its records stay queued until a later page confirms them.
   * Hiding and then closing a tab both flush; each record leaves this way once.
   * A flush asked for while one is in flight (a record finishing, the browser
   * coming back online) runs again once that one settles.
   */
  async flush(write, prepare = r => r, { keepalive = false } = {}) {
    if (keepalive) {
      let budget = 60000;
      for (const [id, { record }] of this.records) {
        if (this.departed.has(id)) continue;
        const data = prepare(record), size = requestBytes(data);
        if (size > budget) continue;
        budget -= size;
        this.departed.add(id);
        write("logs", id, data, { keepalive: true }).catch(() => {});
      }
      return;
    }
    if (this.busy) { this.again = { write, prepare }; return this.busy; }
    this.busy = (async () => {
      for (const id of [...this.records.keys()]) {
        const entry = this.records.get(id);
        if (!entry) continue;
        if (this.now() - entry.queuedAt >= DAY) { this.records.delete(id); continue; }
        await write("logs", id, prepare(entry.record));   // a throw keeps this and later records
        this.records.delete(id);
        this.persist();
      }
    })();
    try { await this.busy; } finally {
      this.busy = null; this.persist();
      const again = this.again;
      this.again = null;
      if (again) this.flush(again.write, again.prepare).catch(() => { /* kept for the next attempt */ });
    }
  }
}
