/** A demo's identity and capture instructions, from its provider or its own frames. */
export function demoPreview(room, embeds = []) {
  for (const provider of embeds) {
    const preview = provider.preview?.(room);
    if (preview) return preview;
  }
  // An unknown slot must not share an identity with another unknown slot.
  // Until its provider supports previews, show a placeholder and refuse capture.
  if (!room.matches(".play-room")) return null;
  return { source: ["playables", ...[...room.querySelectorAll("iframe[data-src]")]
    .map((frame) => [frame.dataset.src, frame.dataset.hide || ""])] };
}

/** Identify a demo independently of its live DOM, layout and playback state. */
export function demoSource(room, embeds = []) {
  return demoPreview(room, embeds)?.source ?? null;
}

/** A changed demo must not silently show a snapshot of the previous content. */
export function matchingPreview(preview, source) {
  return preview && source != null && JSON.stringify(preview.source) === JSON.stringify(source) ? preview : null;
}

/** The deck's index of demo stills, for the presenter's next-slide preview and the slide list: {slideId: [{source, width, height, light, dark}, …]}, or {} if it has none. */
export async function loadDemoPreviews(doc = document) {
  const module = doc.documentElement.dataset.demoPreviews;
  if (!module) return {};
  try {
    return (await import(new URL(module, doc.baseURI).href)).default ?? {};
  } catch {
    return {}; // previews are a convenience: a missing index must not stop presenting or the slide list
  }
}
