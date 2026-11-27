/**
 * cadence.js
 * Speech-cadence character streaming for definition bubbles and I-beam typing.
 */

export function prepareStreamableHtml(container, html) {
  container.innerHTML = html;

  const textNodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue) textNodes.push(node);
  }

  const items = [];
  let fullText = '';

  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    const frag = document.createDocumentFragment();
    const parts = textNode.nodeValue.split(/(\s+)/);

    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
        for (const ch of part) {
          items.push({ el: null, char: ch });
          fullText += ch;
        }
      } else {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'stream-word';
        for (const ch of part) {
          const chSpan = document.createElement('span');
          chSpan.className = 'stream-ch';
          chSpan.textContent = ch;
          wordSpan.appendChild(chSpan);
          items.push({ el: chSpan, char: ch });
          fullText += ch;
        }
        frag.appendChild(wordSpan);
      }
    }

    parent.replaceChild(frag, textNode);
  }

  return { items, fullText };
}

export function buildCadenceSchedule(
  text,
  { baseMs = 25, spaceMs = 18, commaMs = 240, colonMs = 300, periodMs = 480 } = {}
) {
  const times = [];
  let elapsed = 0;

  for (let i = 0; i < text.length; i++) {
    times.push(elapsed);
    const ch = text[i];
    elapsed += /\s/.test(ch) ? spaceMs : baseMs;

    if (ch === ',') {
      elapsed += commaMs;
    } else if (ch === ':' || ch === ';') {
      elapsed += colonMs;
    } else if (
      (ch === '.' || ch === '!' || ch === '?') &&
      i + 1 < text.length &&
      /\s/.test(text[i + 1]) &&
      text.slice(Math.max(0, i - 2), i + 1) !== 'Dr.'
    ) {
      elapsed += periodMs;
    }
  }

  return { times, totalMs: elapsed + 40 };
}

export async function streamPreparedChars(anim, token, prepared, plainHtml, container) {
  const { times, totalMs } = buildCadenceSchedule(prepared.fullText);
  let nextIdx = 0;

  await anim.animate(totalMs, token, (t) => {
    const elapsed = t * totalMs;
    while (nextIdx < times.length && times[nextIdx] <= elapsed) {
      prepared.items[nextIdx].el?.classList.add('is-shown');
      nextIdx += 1;
    }
  });

  if (!anim.isCurrent(token)) return;
  await anim.wait(120, token);
  if (!anim.isCurrent(token)) return;
  container.innerHTML = plainHtml;
}

export async function streamStringWithCadence(anim, token, text, onCount) {
  const { times, totalMs } = buildCadenceSchedule(text, {
    baseMs: 27,
    spaceMs: 18,
    commaMs: 260,
    colonMs: 300,
    periodMs: 480
  });
  let revealed = 0;

  await anim.animate(totalMs, token, (t) => {
    const elapsed = t * totalMs;
    let changed = false;
    while (revealed < times.length && times[revealed] <= elapsed) {
      revealed += 1;
      changed = true;
    }
    if (changed) onCount(revealed);
  });

  if (anim.isCurrent(token)) onCount(text.length);
}
