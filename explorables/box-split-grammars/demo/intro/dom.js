/**
 * dom.js
 * Copy definitions, DOM references, geometry measurement, visual setters,
 * bubble docking helper, and deterministic step snapshots.
 */

import { clamp, easeInOutCubic, easeOutCubic, lerp } from './anim.js';

export const PYTHON_LINE = 'Python  lets coders use loops, conditions, and other tools to assist them in building.';
export const PYTHON_WORD = 'Python';

export const BUBBLE_COPY = {
  1: 'A set of rules that breaks one big box into smaller pieces step by step. You can think about it like grammar in English that breaks a sentence into phrases and words.',
  2: "Dr. Eger's nonterminal system that slices one big box into smaller pieces.",
  3: 'A rule that expands further instead of placing blocks. For example, one side of a castle splits into <code>tower()</code>, <code>wall()</code>, <code>gate()</code>, <code>wall()</code>, and <code>tower()</code>.'
};

export const els = {
  stageRoot: document.getElementById('stage-root'),
  paperWrap: document.getElementById('paper-3d-wrap'),
  paperCard: document.getElementById('paper-3d-card'),
  paperSheen: document.getElementById('paper-3d-sheen'),
  wordBoxSplit: document.getElementById('word-box-split'),
  wordGrammar: document.getElementById('word-grammar'),
  phraseBsg: document.getElementById('phrase-bsg'),
  wordNonterminal: document.getElementById('word-nonterminal'),
  bulletGrammar: document.getElementById('bullet-grammar'),
  bulletBsg: document.getElementById('bullet-bsg'),
  bulletNonterminal: document.getElementById('bullet-nonterminal'),
  wallExample: document.getElementById('wall-example'),
  codeDropSlot: document.getElementById('code-drop-slot'),
  codeSnippetText: document.getElementById('code-snippet-text'),
  pythonBand: document.getElementById('python-band'),
  wordPython: document.getElementById('word-python'),
  pythonRest: document.getElementById('python-rest'),
  typingCaret: document.getElementById('typing-caret'),
  highlightPill: document.getElementById('highlight-pill'),
  defBubble: document.getElementById('def-bubble'),
  bubbleBeak: document.getElementById('bubble-beak'),
  bubbleBody: document.getElementById('bubble-body'),
  dockBubble: document.getElementById('dock-bubble'),
  dockBeak: document.getElementById('dock-beak'),
  dockBody: document.getElementById('dock-body'),
  marqueeBox: document.getElementById('marquee-box'),
  dragChip: document.getElementById('drag-chip'),
  cursorRipple: document.getElementById('cursor-ripple'),
  simCursor: document.getElementById('sim-cursor'),
  replayBtn: document.getElementById('replay-btn')
};

export function rectOf(el) {
  const root = els.stageRoot.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    left: r.left - root.left,
    top: r.top - root.top,
    right: r.right - root.left,
    bottom: r.bottom - root.top,
    width: r.width,
    height: r.height,
    cx: r.left - root.left + r.width / 2,
    cy: r.top - root.top + r.height / 2
  };
}

export function paddedRect(el, padX = 8, padY = 3, padRight = padX) {
  const r = rectOf(el);
  return { left: r.left - padX, top: r.top - padY, width: r.width + padX + padRight, height: r.height + padY * 2 };
}

export function setVisible(el, visible, opacity = visible ? 1 : 0) {
  el.style.visibility = visible ? 'visible' : 'hidden';
  el.style.opacity = String(opacity);
}

export function setHighlightBox(rect, opacity = 1) {
  els.highlightPill.style.left = `${rect.left}px`;
  els.highlightPill.style.top = `${rect.top}px`;
  els.highlightPill.style.width = `${rect.width}px`;
  els.highlightPill.style.height = `${rect.height}px`;
  setVisible(els.highlightPill, opacity > 0.001, opacity);
}

export function clearWordHighlights() {
  els.wordBoxSplit.classList.remove('is-highlighted');
  els.wordGrammar.classList.remove('is-highlighted');
  els.phraseBsg.classList.remove('is-highlighted');
  els.wordNonterminal.classList.remove('is-highlighted');
  els.wordPython.classList.remove('is-highlighted');
  setVisible(els.highlightPill, false, 0);
}

export function setCursor(x, y, { mode = 'pointer', opacity = 1, scale = 1 } = {}) {
  els.simCursor.dataset.mode = mode;
  const ox = mode === 'ibeam' ? -12 : -3;
  const oy = mode === 'ibeam' ? -17 : -2;
  els.simCursor.style.transform = `translate(${x + ox}px, ${y + oy}px) scale(${scale})`;
  setVisible(els.simCursor, opacity > 0.001, opacity);
}

export function setPaperState({ visible = true, opacity = 1, blur = 0, y = 0, scale = 1, rx = 10, ry = -14, rz = -1.2 } = {}) {
  setVisible(els.paperWrap, visible && opacity > 0.001, opacity);
  els.paperWrap.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
  els.paperCard.style.transform = `translateY(${y}px) scale(${scale}) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${rz}deg)`;
}

export function setPythonFullText(count = PYTHON_LINE.length) {
  const c = clamp(Math.round(count), 0, PYTHON_LINE.length);
  els.wordPython.textContent = PYTHON_LINE.slice(0, Math.min(c, PYTHON_WORD.length));
  els.pythonRest.textContent = c > PYTHON_WORD.length ? PYTHON_LINE.slice(PYTHON_WORD.length, c) : '';
}

export function placeBubbleForStep(step) {
  if (step === 1) {
    const gr = rectOf(els.wordGrammar);
    const width = 720;
    const left = Math.round(clamp(gr.cx - width * 0.56, 80, 1600 - 80 - width));
    const top = Math.round(gr.bottom + 26);
    const beakLeft = Math.round(clamp(gr.cx - left - 8, 28, width - 48));
    els.defBubble.style.width = `${width}px`;
    els.defBubble.style.left = `${left}px`;
    els.defBubble.style.top = `${top}px`;
    els.defBubble.style.transformOrigin = `${beakLeft + 8}px 0px`;
    els.defBubble.style.transform = 'scale(1)';
    els.bubbleBody.innerHTML = BUBBLE_COPY[1];
    els.bubbleBeak.className = 'bubble-beak top';
    els.bubbleBeak.style.left = `${beakLeft}px`;
    els.bubbleBeak.style.top = '-10px';
    els.bubbleBeak.style.opacity = '1';
  } else if (step === 2) {
    const bsgRect = rectOf(els.phraseBsg);
    const left = 848;
    const width = 640;
    const top = bsgRect.right > left + 32 ? Math.round(bsgRect.bottom + 26) : 162;
    els.defBubble.style.width = `${width}px`;
    els.defBubble.style.left = `${left}px`;
    els.defBubble.style.top = `${top}px`;
    els.defBubble.style.transform = 'scale(1)';
    els.bubbleBody.innerHTML = BUBBLE_COPY[2];
    if (bsgRect.right > left + 32) {
      const overlapCx = (Math.max(bsgRect.left, left) + Math.min(bsgRect.right, left + width)) / 2;
      const beakLeft = Math.round(clamp(overlapCx - left - 8, 28, width - 48));
      els.bubbleBeak.className = 'bubble-beak top';
      els.bubbleBeak.style.left = `${beakLeft}px`;
      els.bubbleBeak.style.top = '-10px';
      els.defBubble.style.transformOrigin = `${beakLeft + 8}px 0px`;
    } else {
      els.bubbleBeak.className = 'bubble-beak left';
      els.bubbleBeak.style.left = '-10px';
      els.bubbleBeak.style.top = '20px';
      els.defBubble.style.transformOrigin = '0px 28px';
    }
    els.bubbleBeak.style.opacity = '1';
  } else if (step === 3) {
    const ntRect = rectOf(els.wordNonterminal);
    const left = 848;
    const width = 650;
    const top = Math.round(clamp(ntRect.cy - 68, 184, 480));
    const beakTop = Math.round(clamp(ntRect.cy - top - 8, 26, 130));
    els.defBubble.style.width = `${width}px`;
    els.defBubble.style.left = `${left}px`;
    els.defBubble.style.top = `${top}px`;
    els.defBubble.style.transformOrigin = `0px ${beakTop + 8}px`;
    els.defBubble.style.transform = 'scale(1)';
    els.bubbleBody.innerHTML = BUBBLE_COPY[3];
    els.bubbleBeak.className = 'bubble-beak left';
    els.bubbleBeak.style.left = '-10px';
    els.bubbleBeak.style.top = `${beakTop}px`;
    els.bubbleBeak.style.opacity = '1';
  }
}

export function resetOverlays(onClearInteractive) {
  setVisible(els.defBubble, false, 0);
  els.defBubble.style.transform = 'scale(1)';
  setVisible(els.dockBubble, false, 0);
  els.dockBubble.style.transform = 'none';
  els.dockBubble.style.padding = '';
  els.dockBubble.style.borderWidth = '';
  els.dockBubble.style.borderRadius = '';
  els.dockBubble.style.borderColor = '';
  els.dockBubble.style.backgroundColor = '';
  els.dockBubble.style.color = '';
  els.dockBubble.style.boxShadow = '';
  els.dockBeak.style.opacity = '0';
  els.dockBeak.style.transform = '';
  els.dockBody.innerHTML = '';
  setVisible(els.marqueeBox, false, 0);
  els.wallExample.style.transform = '';
  els.wallExample.querySelectorAll('.castle-piece, .castle-cut').forEach((el) => {
    el.style.opacity = '';
  });
  setVisible(els.dragChip, false, 0);
  els.dragChip.style.transform = '';
  setVisible(els.cursorRipple, false, 0);
  els.pythonBand.style.minWidth = '';
  els.pythonBand.style.width = '';
  els.pythonBand.style.transform = '';
  els.typingCaret.classList.remove('is-blinking');
  els.replayBtn.classList.remove('is-visible');
  onClearInteractive?.();
}

export function triggerRipple(anim, x, y, token) {
  els.cursorRipple.style.left = `${x}px`;
  els.cursorRipple.style.top = `${y}px`;
  anim.animate(420, token, (t) => {
    const e = easeOutCubic(t);
    setVisible(els.cursorRipple, true, (1 - e) * 0.9);
    els.cursorRipple.style.transform = `scale(${0.45 + e * 1.45})`;
  }).then((ok) => {
    if (ok) setVisible(els.cursorRipple, false, 0);
  });
}

export async function dockBubbleIntoBullet(anim, bulletEl, token) {
  const fromRect = rectOf(els.defBubble);
  const toRect = rectOf(bulletEl);
  const labelEl = bulletEl.querySelector('.term-label');
  const bodyEl = bulletEl.querySelector('.term-body');
  const targetLabelWidth = labelEl ? rectOf(labelEl).width : 0;
  const safeBodyHtml = bodyEl
    ? bodyEl.innerHTML.replace(/\sid="[^"]*"/g, '').replace(/\bis-highlighted\b/g, '')
    : els.bubbleBody.innerHTML;

  els.dockBody.innerHTML =
    `<span class="dock-marker" aria-hidden="true"></span>` +
    `<span class="dock-label">${labelEl ? labelEl.innerHTML : ''}</span>` +
    `<span class="dock-text">${safeBodyHtml}</span>`;

  const markerEl = els.dockBody.querySelector('.dock-marker');
  const dockLabelEl = els.dockBody.querySelector('.dock-label');

  const isLeftBeak = els.bubbleBeak.classList.contains('left');
  if (isLeftBeak) {
    els.dockBeak.className = 'bubble-beak left';
    els.dockBeak.style.left = '-8px';
    els.dockBeak.style.top = `${(parseFloat(els.bubbleBeak.style.top) || 20) + 2}px`;
  } else {
    els.dockBeak.className = 'bubble-beak top';
    els.dockBeak.style.top = '-8px';
    els.dockBeak.style.left = `${(parseFloat(els.bubbleBeak.style.left) || 28) + 2}px`;
  }
  const beakDeg = isLeftBeak ? -45 : 45;
  els.dockBeak.style.opacity = '1';
  els.dockBeak.style.transform = `rotate(${beakDeg}deg) scale(1)`;

  els.dockBubble.style.left = `${fromRect.left}px`;
  els.dockBubble.style.top = `${fromRect.top}px`;
  els.dockBubble.style.width = `${fromRect.width}px`;
  els.dockBubble.style.padding = '22px 28px';
  els.dockBubble.style.borderRadius = '20px';
  els.dockBubble.style.backgroundColor = 'rgba(255, 255, 255, 1)';
  els.dockBubble.style.boxShadow =
    'inset 0 0 0 2px rgba(61, 99, 191, 1), 0 18px 44px rgba(30, 39, 66, 0.18), 0 4px 12px rgba(61, 99, 191, 0.10)';
  els.dockBubble.style.color = 'rgb(30, 39, 66)';
  els.dockBubble.style.transform = 'none';
  setVisible(els.dockBubble, true, 1);
  setVisible(els.defBubble, false, 0);

  await anim.animate(980, token, (t) => {
    const geoP = easeInOutCubic(t);
    els.dockBubble.style.left = `${lerp(fromRect.left, toRect.left, geoP)}px`;
    els.dockBubble.style.top = `${lerp(fromRect.top, toRect.top, geoP)}px`;
    els.dockBubble.style.width = `${lerp(fromRect.width, toRect.width, geoP)}px`;
    els.dockBubble.style.padding = `${lerp(22, 0, geoP)}px ${lerp(28, 0, geoP)}px`;
    els.dockBubble.style.borderRadius = `${lerp(20, 0, geoP)}px`;

    const beakP = clamp(1 - t / 0.22, 0, 1);
    const beakTuck = (1 - beakP) * 7;
    const beakShift = isLeftBeak ? `translateX(${beakTuck}px)` : `translateY(${beakTuck}px)`;
    els.dockBeak.style.opacity = String(clamp(beakP * 1.6, 0, 1));
    els.dockBeak.style.transform = `${beakShift} rotate(${beakDeg}deg) scale(${lerp(0.4, 1, beakP)})`;

    const chromeFade = clamp(1 - geoP * 1.45, 0, 1);
    els.dockBubble.style.backgroundColor = `rgba(255, 255, 255, ${1 - geoP})`;
    els.dockBubble.style.boxShadow =
      chromeFade > 0.001
        ? `inset 0 0 0 2px rgba(61, 99, 191, ${chromeFade}), 0 18px 44px rgba(30, 39, 66, ${0.18 * chromeFade}), 0 4px 12px rgba(61, 99, 191, ${0.10 * chromeFade})`
        : 'none';

    const r = Math.round(lerp(30, 74, geoP));
    const g = Math.round(lerp(39, 84, geoP));
    const b = Math.round(lerp(66, 112, geoP));
    els.dockBubble.style.color = `rgb(${r}, ${g}, ${b})`;

    if (dockLabelEl) {
      const lp = easeInOutCubic(clamp((t - 0.05) / 0.85, 0, 1));
      if (lp >= 0.999) {
        dockLabelEl.style.width = 'auto';
        dockLabelEl.style.opacity = '1';
        dockLabelEl.style.clipPath = 'none';
      } else {
        dockLabelEl.style.width = `${targetLabelWidth * lp}px`;
        dockLabelEl.style.opacity = String(clamp((lp - 0.12) / 0.88, 0, 1));
        dockLabelEl.style.clipPath = 'inset(-8px 0 -8px 0)';
      }
    }
    if (markerEl) {
      const mp = easeOutCubic(clamp((geoP - 0.58) / 0.36, 0, 1));
      markerEl.style.opacity = String(mp);
      markerEl.style.transform = `scale(${lerp(0.5, 1, mp)})`;
    }

    els.dockBubble.style.opacity = '1';
    setVisible(bulletEl, false, 0);
  });

  if (!anim.isCurrent(token)) return;
  setVisible(bulletEl, true, 1);
  setVisible(els.dockBubble, false, 0);
  els.dockBody.innerHTML = '';
}

export function applyStaticState(step, { onEnableInteractive, onClearInteractive } = {}) {
  resetOverlays(onClearInteractive);
  clearWordHighlights();

  const showCastle = step === 4;
  setVisible(els.bulletGrammar, step >= 2, step >= 2 ? 1 : 0);
  setVisible(els.bulletBsg, step >= 3, step >= 3 ? 1 : 0);
  setVisible(els.bulletNonterminal, step >= 4, step >= 4 ? 1 : 0);
  setVisible(els.wallExample, showCastle, showCastle ? 1 : 0);
  els.codeDropSlot.classList.remove('is-empty', 'is-drop-ready');
  setVisible(els.codeSnippetText, showCastle, showCastle ? 1 : 0);
  setPythonFullText(PYTHON_LINE.length);
  setVisible(els.pythonBand, showCastle, showCastle ? 1 : 0);

  if (step === 0) {
    setPaperState({ visible: true, opacity: 1, blur: 0, y: 0, scale: 1 });
    setVisible(els.simCursor, false, 0);
  } else if (step === 1) {
    setPaperState({ visible: true, opacity: 0.28, blur: 1.5, y: 14, scale: 0.96 });
    const gr = rectOf(els.wordGrammar);
    els.wordGrammar.classList.add('is-highlighted');
    setHighlightBox(paddedRect(els.wordGrammar, 8, 3, 2), 1);
    placeBubbleForStep(1);
    setVisible(els.defBubble, true, 1);
    setCursor(gr.right - 18, gr.top + gr.height * 0.44, { mode: 'pointer', opacity: 1 });
  } else if (step === 2) {
    setPaperState({ visible: false, opacity: 0 });
    const bs = rectOf(els.wordBoxSplit);
    els.wordBoxSplit.classList.add('is-highlighted');
    els.wordGrammar.classList.add('is-highlighted');
    setHighlightBox(paddedRect(els.phraseBsg, 8, 3, 2), 1);
    placeBubbleForStep(2);
    setVisible(els.defBubble, true, 1);
    setCursor(bs.cx + 4, bs.cy + 10, { mode: 'pointer', opacity: 1 });
  } else if (step === 3) {
    setPaperState({ visible: false, opacity: 0 });
    const nt = rectOf(els.wordNonterminal);
    els.wordNonterminal.classList.add('is-highlighted');
    setHighlightBox(paddedRect(els.wordNonterminal, 6, 2), 1);
    placeBubbleForStep(3);
    setVisible(els.defBubble, true, 1);
    setCursor(nt.right - 8, nt.bottom - 4, { mode: 'pointer', opacity: 1 });
  } else {
    setPaperState({ visible: false, opacity: 0 });
    setVisible(els.simCursor, false, 0);
    els.replayBtn.classList.add('is-visible');
    onEnableInteractive?.();
  }
}
