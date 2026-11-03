// DOM-independent parts of the editor: ordering, undo, and source round trips.
export function moveSlide(order, id, destination) {
  const from = order.indexOf(id);
  if (from < 0 || !Number.isInteger(destination)) throw new Error("Unknown slide or position.");
  const result = [...order];
  result.splice(from, 1);
  result.splice(Math.max(0, Math.min(result.length, destination)), 0, id);
  return result;
}

export function numberInRange(value, min, max) {
  if (String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

/** Resize in slide pixels; a two-axis drag projects onto the image's aspect ratio. */
export function resizeImageSize(size, requested, keepRatio = true) {
  const { width, height } = size;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (!["width", "height"].some((key) => Object.hasOwn(requested, key))) return null;
  const w = requested.width ?? width, h = requested.height ?? height;
  if (![w, h].every(Number.isFinite)) return null;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  if (!keepRatio) return { width: clamp(w, 1, 5000), height: clamp(h, 1, 5000) };
  const factor = requested.width == null ? h / height : requested.height == null ? w / width
    : (w * width + h * height) / (width * width + height * height);
  const min = Math.max(1 / width, 1 / height), max = Math.min(5000 / width, 5000 / height);
  if (min > max) return null;
  const scale = clamp(factor, min, max);
  return { width: width * scale, height: height * scale };
}

// A draft identifier, not a security checksum. File saves use SHA-256 on the server.
export function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}-${(hash >>> 0).toString(16)}`;
}

/** Discard only the earlier versions this page has seen, preserving current drafts and newer writes from other tabs. */
export function discardEarlierDrafts(storage, key, drafts, currentBase) {
  const earlier = new Set(drafts.map((draft) => JSON.stringify(draft)));
  for (const location of [key, `${key}:earlier`]) {
    const raw = storage.getItem(location);
    if (!raw) continue;
    const draft = JSON.parse(raw);
    if (location === key && draft.base === currentBase) continue;
    if (earlier.has(JSON.stringify(draft))) storage.removeItem(location);
  }
}

export class History {
  constructor(initial) {
    this.entries = [structuredClone(initial)];
    this.index = 0;
    this.group = null;
    this.time = 0;
  }
  get state() { return this.entries[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  push(next, group = null, now = Date.now()) {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false;
    const combine = group && this.group === group && now - this.time < 800 && !this.canRedo;
    this.entries.splice(this.index + 1);
    if (combine) this.entries[this.index] = structuredClone(next);
    else {
      this.entries.push(structuredClone(next));
      if (this.entries.length > 101) this.entries.shift();
      this.index = this.entries.length - 1;
    }
    this.group = group;
    this.time = now;
    return true;
  }
  undo() { this.group = null; if (this.canUndo) this.index--; return this.state; }
  redo() { this.group = null; if (this.canRedo) this.index++; return this.state; }
}

/** Find slide sections without mistaking commented examples or nested sections for slides. */
export function slideBlocks(source) {
  const tags = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?section\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  const blocks = [];
  let depth = 0, start = null;
  for (const match of source.matchAll(tags)) {
    const tag = match[0];
    if (!/^<\/?section\b/i.test(tag)) continue;
    if (/^<\//.test(tag)) {
      if (depth > 0 && --depth === 0 && start) {
        blocks.push({ ...start, end: match.index + tag.length, html: source.slice(start.start, match.index + tag.length) });
        start = null;
      }
    } else {
      if (depth === 0) {
        const classes = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2]?.split(/\s+/) ?? [];
        const id = /\sid\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
        if (classes.includes("slide")) {
          if (!id) throw new Error("A slide has no id.");
          start = { id, start: match.index };
        }
      }
      depth++;
    }
  }
  if (depth || !blocks.length || new Set(blocks.map((b) => b.id)).size !== blocks.length) {
    throw new Error("The slide source has missing sections or duplicate ids.");
  }
  return blocks;
}

/** Replace just the slide sections. Keep the page's scripts, toolbar, comments and spacing. */
export function renderSource(source, slides) {
  const blocks = slideBlocks(source);
  const ids = new Set(blocks.map((block) => block.id));
  if (slides.length !== blocks.length || new Set(slides.map((s) => s.id)).size !== ids.size || slides.some((s) => !ids.has(s.id))) {
    throw new Error("Slide ids changed. Reload the page before saving.");
  }
  let output = "", end = 0;
  for (let i = 0; i < blocks.length; i++) {
    const replacement = slideBlocks(slides[i].html);
    if (replacement.length !== 1 || replacement[0].id !== slides[i].id || replacement[0].html !== slides[i].html) {
      throw new Error("Invalid slide content.");
    }
    output += source.slice(end, blocks[i].start) + slides[i].html;
    end = blocks[i].end;
  }
  return output + source.slice(end);
}
