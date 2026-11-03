// Where the deck's records go, and how they get there. Two independent
// features use this module: usage analytics (analytics.js) and slide feedback
// (feedback.js). Neither imports the other.
//
// A page has one of three destinations:
//   "firestore"  a published deck on an approved HTTPS host. Records are
//                created through Firestore's REST API; firebase/firestore.rules
//                allows creating documents only, never reading or changing them.
//   "console"    authoring decks and localhost previews. Records are printed to
//                the browser console, like angular-schematics' LogInDevService.
//   "off"        everything else, including audience windows and hosts that
//                the build configuration doesn't name.
import config from "./analytics-config.js";

export const DAY = 86400000;
export const uuid = () => crypto.randomUUID();
export const isId = value => typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

/** The window's localStorage or sessionStorage, or null where a browser forbids it. */
export const safeStorage = name => { try { return window[name] ?? null; } catch { return null; } };
export const readStored = (storage, key, fallback = null) => {
  try { return JSON.parse(storage?.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
export const writeStored = (storage, key, value) => {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Memory still works without storage. */ }
};
export const removeStored = (storage, key) => {
  try { storage?.removeItem(key); } catch { /* Storage can be disabled. */ }
};

/** Authoring decks and pages served from this machine print instead of sending. */
export function developmentMode({ authoring, audience, hostname, protocol }) {
  return Boolean(!audience && ["http:", "https:"].includes(protocol) &&
    (authoring || ["localhost", "127.0.0.1", "[::1]"].includes(hostname)));
}

/** "firestore", "console" or "off" for a page in `environment` (see the top of this file). */
export function destination(environment, configuration = config) {
  const { published, authoring, audience, hostname, protocol } = environment;
  if (developmentMode(environment)) return "console";
  const allowed = configuration?.enabled && configuration.projectId && published && !authoring && !audience &&
    protocol === "https:" && configuration.allowedHosts?.includes(hostname);
  return allowed ? "firestore" : "off";
}

/**
 * Firestore's REST encoding of a plain value: the shape documents:createDocument
 * expects. Integers become integerValue (sent as strings, as the API requires),
 * Dates become timestampValue, and objects
 * become maps. Undefined fields are left out, as Firestore SDKs do.
 */
export function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  switch (typeof value) {
    case "boolean": return { booleanValue: value };
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Firestore records hold finite numbers only.");
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case "string": return { stringValue: value };
    case "object": return { mapValue: { fields: toFirestoreFields(value) } };
    default: throw new TypeError(`Firestore records can't hold a ${typeof value}.`);
  }
}
export function toFirestoreFields(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toFirestoreValue(v)]));
}

/** Byte size of a record's request body, for keepalive's 64 KB budget. */
export const requestBytes = (data) => new TextEncoder().encode(JSON.stringify({ fields: toFirestoreFields(data) })).length;

/**
 * A writer that creates one Firestore document per call, or prints it in
 * console mode. It resolves to:
 *   "saved"     the document was created (or printed);
 *   "exists"    a document with that ID is already there, so an earlier
 *               attempt succeeded and this one is a harmless retry;
 *   "rejected"  the security rules or the API refused the data. Sending the
 *               same record again can't succeed, so callers drop it.
 * Network failures and server errors throw, so callers keep the record and
 * try again later.
 *
 * `keepalive` lets a request outlive the page (a closing tab). Unlike
 * sendBeacon, a keepalive fetch can omit credentials and wait for its answer
 * while the page stays open.
 */
export function openWriter(kind, { configuration = config, fetch = globalThis.fetch?.bind(globalThis), log = (...a) => console.log(...a) } = {}) {
  if (kind === "console") {
    const labels = { logs: "[Explorables analytics]", feedback: "[Explorables feedback]" };
    return async (collection, id, data) => { log(labels[collection] ?? `[${collection}]`, id, data); return "saved"; };
  }
  if (kind !== "firestore") return async () => "rejected";
  // `base` is only for tests and the emulator preview; the build writes projectId alone.
  const base = configuration.base ?? `https://firestore.googleapis.com/v1/projects/${configuration.projectId}/databases/(default)/documents`;
  let warned = false;
  return async (collection, id, data, { keepalive = false } = {}) => {
    const response = await fetch(`${base}/${collection}?documentId=${encodeURIComponent(id)}`, {
      method: "POST", keepalive, credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
      ...(keepalive ? {} : { signal: AbortSignal.timeout(12000) }),
    });
    if (response.ok) return "saved";
    if (response.status === 409) return "exists";
    if (response.status === 400 || response.status === 403) {
      // Never log the record itself: feedback text and IDs stay out of consoles on the public site.
      if (!warned) { warned = true; console.warn(`Explorables: Firestore refused a ${collection} record (${response.status}).`); }
      return "rejected";
    }
    throw new Error(`Firestore responded ${response.status}.`);
  };
}
