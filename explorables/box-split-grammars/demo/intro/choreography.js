/**
 * choreography.js
 * Deliberately paced transitions for Slides 2.1 through 2.4, with speech-cadence
 * bubble streaming, human digestion pauses, and seamless bubble-to-bullet morphing.
 */

import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from './anim.js?v=4';
import { prepareStreamableHtml, streamPreparedChars, streamStringWithCadence } from './cadence.js?v=4';
import {
  BUBBLE_COPY,
  PYTHON_LINE,
  dockBubbleIntoBullet,
  els,
  paddedRect,
  placeBubbleForStep,
  rectOf,
  setCursor,
  setHighlightBox,
  setPaperState,
  setPythonFullText,
  setVisible,
  triggerRipple
} from './dom.js?v=4';

function pointInRect(x, y, r) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

async function revealHighlight(anim, token, wordEl, targetHl, durationMs = 170) {
  wordEl.classList.add('is-highlighted');
  const cx = targetHl.left + targetHl.width / 2;
  await anim.animate(durationMs, token, (t) => {
    const e = easeOutCubic(t);
    const w = lerp(targetHl.width * 0.88, targetHl.width, e);
    setHighlightBox(
      { left: cx - w / 2, top: targetHl.top, width: w, height: targetHl.height },
      clamp(t * 2.5, 0, 1)
    );
  });
  if (anim.isCurrent(token)) setHighlightBox(targetHl, 1);
}

async function popBubble(anim, token, step, axis = 'Y', offset = -8) {
  placeBubbleForStep(step);
  const plainHtml = BUBBLE_COPY[step];
  const prepared = prepareStreamableHtml(els.bubbleBody, plainHtml);

  await anim.animate(500, token, (t) => {
    const e = easeOutBack(t);
    setVisible(els.defBubble, true, clamp(t * 2.4, 0, 1));
    els.defBubble.style.transform = `translate${axis}(${lerp(offset, 0, e)}px) scale(${lerp(0.92, 1, e)})`;
  });
  if (!anim.isCurrent(token)) return;
  els.defBubble.style.transform = 'scale(1)';

  await anim.wait(180, token);
  if (!anim.isCurrent(token)) return;
  await streamPreparedChars(anim, token, prepared, plainHtml, els.bubbleBody);
}

export async function playStep1(anim, token) {
  const gr = rectOf(els.wordGrammar);
  const startX = 980;
  const startY = 470;
  const endX = gr.right - 18;
  const endY = gr.top + gr.height * 0.44;
  const targetHl = paddedRect(els.wordGrammar, 8, 3, 2);

  await anim.wait(220, token);
  if (!anim.isCurrent(token)) return;

  let hlTask = null;
  setCursor(startX, startY, { mode: 'pointer', opacity: 0 });
  await anim.animate(1050, token, (t) => {
    const e = easeInOutCubic(t);
    const cx = lerp(startX, endX, e);
    const cy = lerp(startY, endY, e) + Math.sin(e * Math.PI) * -28;
    setCursor(cx, cy, {
      mode: 'pointer',
      opacity: clamp(t * 3.5, 0, 1)
    });
    if (!hlTask && pointInRect(cx, cy, targetHl)) {
      hlTask = revealHighlight(anim, token, els.wordGrammar, targetHl, 170);
    }
    setPaperState({
      visible: true,
      opacity: lerp(1, 0.28, e),
      blur: lerp(0, 1.5, e),
      y: lerp(0, 14, e),
      scale: lerp(1, 0.96, e)
    });
  });
  if (!anim.isCurrent(token)) return;
  if (!hlTask) hlTask = revealHighlight(anim, token, els.wordGrammar, targetHl, 170);
  await hlTask;
  if (!anim.isCurrent(token)) return;

  await anim.wait(160, token);
  if (!anim.isCurrent(token)) return;
  await popBubble(anim, token, 1, 'Y', -8);
}

export async function playStep2(anim, token) {
  const fromHl = paddedRect(els.wordGrammar, 8, 3, 2);
  const toHl = paddedRect(els.phraseBsg, 8, 3, 2);
  const gr = rectOf(els.wordGrammar);
  const bs = rectOf(els.wordBoxSplit);
  const startX = gr.right - 18;
  const startY = gr.top + gr.height * 0.44;
  const endX = bs.cx + 4;
  const endY = bs.cy + 10;

  await anim.wait(200, token);
  if (!anim.isCurrent(token)) return;

  const dockTask = dockBubbleIntoBullet(anim, els.bulletGrammar, token);
  const paperTask = anim.animate(850, token, (t) => {
    const e = easeOutCubic(t);
    setPaperState({
      visible: true,
      opacity: lerp(0.28, 0, e),
      blur: 1.5,
      y: lerp(14, 24, e),
      scale: lerp(0.96, 0.94, e)
    });
  });

  const cursorHlTask = (async () => {
    await anim.wait(240, token);
    if (!anim.isCurrent(token)) return;
    await anim.animate(1000, token, (t) => {
      const e = easeInOutCubic(t);
      const cx = lerp(startX, endX, e);
      const cy = lerp(startY, endY, e) + Math.sin(e * Math.PI) * -10;
      if (cx <= bs.right + 8) els.wordBoxSplit.classList.add('is-highlighted');
      setCursor(cx, cy, {
        mode: 'pointer',
        opacity: 1
      });
      setHighlightBox({
        left: lerp(fromHl.left, toHl.left, e),
        top: lerp(fromHl.top, toHl.top, e),
        width: lerp(fromHl.width, toHl.width, e),
        height: lerp(fromHl.height, toHl.height, e)
      }, 1);
    });
  })();

  await Promise.all([dockTask, paperTask, cursorHlTask]);
  if (!anim.isCurrent(token)) return;
  setPaperState({ visible: false, opacity: 0 });

  await anim.wait(320, token);
  if (!anim.isCurrent(token)) return;
  await popBubble(anim, token, 2, 'Y', -8);
}

export async function playStep3(anim, token) {
  const fromHl = paddedRect(els.phraseBsg, 8, 3, 2);
  const bs = rectOf(els.wordBoxSplit);
  const nt = rectOf(els.wordNonterminal);
  const toHl = paddedRect(els.wordNonterminal, 6, 2);
  const startX = bs.cx + 4;
  const startY = bs.cy + 10;
  const endX = nt.right - 8;
  const endY = nt.bottom - 4;

  await anim.wait(200, token);
  if (!anim.isCurrent(token)) return;

  const clearHlTask = anim.animate(360, token, (t) => {
    setHighlightBox(fromHl, 1 - easeOutCubic(t));
    if (t >= 0.6) {
      els.wordBoxSplit.classList.remove('is-highlighted');
      els.wordGrammar.classList.remove('is-highlighted');
    }
  });

  await Promise.all([clearHlTask, dockBubbleIntoBullet(anim, els.bulletBsg, token)]);
  if (!anim.isCurrent(token)) return;

  await anim.wait(380, token);
  if (!anim.isCurrent(token)) return;

  let hlTask = null;
  await anim.animate(980, token, (t) => {
    const e = easeInOutCubic(t);
    const cx = lerp(startX, endX, e) + Math.sin(e * Math.PI) * 32;
    const cy = lerp(startY, endY, e);
    setCursor(cx, cy, {
      mode: 'pointer',
      opacity: 1
    });
    if (!hlTask && pointInRect(cx, cy, toHl)) {
      hlTask = revealHighlight(anim, token, els.wordNonterminal, toHl, 170);
    }
  });
  if (!anim.isCurrent(token)) return;
  if (!hlTask) hlTask = revealHighlight(anim, token, els.wordNonterminal, toHl, 170);
  await hlTask;
  if (!anim.isCurrent(token)) return;

  await anim.wait(180, token);
  if (!anim.isCurrent(token)) return;
  await popBubble(anim, token, 3, 'X', -10);
}

async function beatTypePythonCallout(anim, token, fromPos, pyBoxRect) {
  const typeStartX = pyBoxRect.left + 26;
  const typeY = pyBoxRect.top + pyBoxRect.height * 0.5;

  await anim.animate(920, token, (t) => {
    const e = easeInOutCubic(t);
    setCursor(lerp(fromPos.x, typeStartX, e), lerp(fromPos.y, typeY, e), {
      mode: t > 0.72 ? 'ibeam' : 'pointer',
      opacity: 1
    });
  });
  if (!anim.isCurrent(token)) return null;

  triggerRipple(anim, typeStartX, typeY, token);
  setPythonFullText(0);
  els.pythonBand.style.minWidth = '78px';
  els.typingCaret.classList.add('is-blinking');
  await anim.animate(180, token, (t) => {
    const e = easeOutCubic(t);
    setVisible(els.pythonBand, true, e);
    els.pythonBand.style.transform = `scale(${lerp(0.97, 1, e)})`;
  });
  if (!anim.isCurrent(token)) return null;
  setVisible(els.pythonBand, true, 1);
  els.pythonBand.style.transform = '';

  await anim.wait(160, token);
  if (!anim.isCurrent(token)) return null;

  await streamStringWithCadence(anim, token, PYTHON_LINE, (count) => {
    setPythonFullText(count);
    const caretRect = rectOf(els.typingCaret);
    setCursor(clamp(caretRect.right + 6, typeStartX, pyBoxRect.right - 12), typeY, { mode: 'ibeam', opacity: 1 });
  });
  if (!anim.isCurrent(token)) return null;

  setPythonFullText(PYTHON_LINE.length);
  els.pythonBand.style.minWidth = '';
  await anim.wait(680, token);
  if (!anim.isCurrent(token)) return null;
  els.typingCaret.classList.remove('is-blinking');

  return { x: rectOf(els.pythonBand).right - 14, y: typeY };
}

async function beatMarqueeCastleExample(anim, token, fromPos) {
  const wr = rectOf(els.wallExample);
  const dragStartX = wr.left + 6;
  const dragStartY = wr.top + 6;
  const dragEndX = wr.right - 6;
  const dragEndY = wr.bottom - 6;

  await anim.animate(900, token, (t) => {
    const e = easeInOutCubic(t);
    setCursor(lerp(fromPos.x, dragStartX, e), lerp(fromPos.y, dragStartY, e), {
      mode: t > 0.28 ? 'pointer' : 'ibeam',
      opacity: 1
    });
  });
  if (!anim.isCurrent(token)) return null;

  await anim.wait(220, token);
  if (!anim.isCurrent(token)) return null;

  triggerRipple(anim, dragStartX, dragStartY, token);
  setCursor(dragStartX, dragStartY, { mode: 'pointer', opacity: 1, scale: 0.9 });
  els.marqueeBox.style.left = `${wr.left}px`;
  els.marqueeBox.style.top = `${wr.top}px`;
  els.marqueeBox.style.width = '0px';
  els.marqueeBox.style.height = '0px';
  setVisible(els.marqueeBox, true, 1);

  await anim.animate(1280, token, (t) => {
    const e = easeInOutCubic(t);
    const cx = lerp(dragStartX, dragEndX, e);
    const cy = lerp(dragStartY, dragEndY, e);
    setCursor(cx, cy, { mode: 'pointer', opacity: 1, scale: 0.9 });
    els.marqueeBox.style.width = `${Math.max(12, cx - wr.left)}px`;
    els.marqueeBox.style.height = `${Math.max(12, cy - wr.top)}px`;
  });
  if (!anim.isCurrent(token)) return null;

  await anim.wait(240, token);
  if (!anim.isCurrent(token)) return null;

  setCursor(dragEndX, dragEndY, { mode: 'pointer', opacity: 1, scale: 1 });
  els.codeDropSlot.classList.add('is-empty');
  setVisible(els.codeSnippetText, false, 0);

  const castlePieces = [...els.wallExample.querySelectorAll('.castle-piece')];
  const castleCuts = [...els.wallExample.querySelectorAll('.castle-cut')];
  const clearCastleInlineOpacity = () => {
    castlePieces.forEach((p) => { p.style.opacity = ''; });
    castleCuts.forEach((c) => { c.style.opacity = ''; });
  };
  castlePieces.forEach((p) => { p.style.opacity = '0'; });
  castleCuts.forEach((c) => { c.style.opacity = '0'; });

  try {
    await anim.animate(460, token, (t) => {
      const e = easeOutCubic(t);
      setVisible(els.marqueeBox, true, 1 - e);
      setVisible(els.wallExample, true, e);
      els.wallExample.style.transform = `scale(${lerp(0.985, 1, e)})`;
    });
    if (!anim.isCurrent(token)) return null;
    els.wallExample.style.transform = '';
    setVisible(els.marqueeBox, false, 0);

    // Fade in the 5 castle pieces (tower, wall, gate, wall, tower) 1s each -> 5s total
    for (let i = 0; i < castlePieces.length; i++) {
      const piece = castlePieces[i];
      const cut = i > 0 ? castleCuts[i - 1] : null;
      await anim.animate(1000, token, (t) => {
        const e = easeOutCubic(t);
        piece.style.opacity = String(e);
        if (cut) cut.style.opacity = String(clamp(e * 1.4, 0, 1));
      });
      if (!anim.isCurrent(token)) return null;
      piece.style.opacity = '';
      if (cut) cut.style.opacity = '';
    }

    clearCastleInlineOpacity();
    return { x: dragEndX, y: dragEndY };
  } finally {
    if (!anim.isCurrent(token)) {
      els.wallExample.style.transform = '';
      clearCastleInlineOpacity();
    }
  }
}

async function beatDragPythonRule(anim, token, fromPos) {
  const pyWordRect = rectOf(els.wordPython);
  const pyHlRect = paddedRect(els.wordPython, 6, 2);
  const pickX = pyWordRect.cx;
  const pickY = pyWordRect.cy + 4;

  let hlTask = null;
  await anim.animate(980, token, (t) => {
    const e = easeInOutCubic(t);
    const cx = lerp(fromPos.x, pickX, e);
    const cy = lerp(fromPos.y, pickY, e) + Math.sin(e * Math.PI) * 32;
    setCursor(cx, cy, {
      mode: 'pointer',
      opacity: 1
    });
    if (!hlTask && pointInRect(cx, cy, pyHlRect)) {
      hlTask = revealHighlight(anim, token, els.wordPython, pyHlRect, 170);
    }
  });
  if (!anim.isCurrent(token)) return;
  if (!hlTask) hlTask = revealHighlight(anim, token, els.wordPython, pyHlRect, 170);
  await hlTask;
  if (!anim.isCurrent(token)) return;

  await anim.wait(450, token);
  if (!anim.isCurrent(token)) return;

  triggerRipple(anim, pickX, pickY, token);
  setCursor(pickX, pickY, { mode: 'pointer', opacity: 1, scale: 0.9 });
  const chipW = els.dragChip.offsetWidth;
  const chipH = els.dragChip.offsetHeight;
  const chipStartLeft = pyWordRect.cx - chipW / 2;
  const chipStartTop = pyWordRect.cy - chipH / 2;
  els.dragChip.style.left = `${chipStartLeft}px`;
  els.dragChip.style.top = `${chipStartTop}px`;

  await anim.animate(160, token, (t) => {
    const e = easeOutCubic(t);
    setVisible(els.dragChip, true, e);
    els.dragChip.style.transform = `translate(0px, 0px) scale(${lerp(0.96, 1.05, e)})`;
  });
  if (!anim.isCurrent(token)) return;

  const slotRect = rectOf(els.codeDropSlot);
  const dropTargetX = slotRect.left + slotRect.width * 0.42;
  const dropTargetY = slotRect.cy;
  const chipDx = (dropTargetX - chipW / 2) - chipStartLeft;
  const chipDy = (dropTargetY - chipH / 2) - chipStartTop;

  await anim.animate(1380, token, (t) => {
    const e = easeInOutCubic(t);
    const arcX = Math.sin(e * Math.PI) * -45;
    const arcY = Math.sin(e * Math.PI) * -36;
    els.dragChip.style.transform = `translate(${chipDx * e + arcX}px, ${chipDy * e + arcY}px) scale(${lerp(1.05, 1, e)})`;
    setCursor(lerp(pickX, dropTargetX, e) + arcX, lerp(pickY, dropTargetY, e) + arcY, {
      mode: 'pointer',
      opacity: 1,
      scale: 0.9
    });
    if (e > 0.65) els.codeDropSlot.classList.add('is-drop-ready');
  });
  if (!anim.isCurrent(token)) return;

  await anim.wait(260, token);
  if (!anim.isCurrent(token)) return;

  triggerRipple(anim, dropTargetX, dropTargetY, token);
  setCursor(dropTargetX, dropTargetY, { mode: 'pointer', opacity: 1, scale: 1 });
  els.codeDropSlot.classList.remove('is-empty', 'is-drop-ready');
  els.wordPython.classList.remove('is-highlighted');

  await anim.animate(480, token, (t) => {
    const e = easeOutCubic(t);
    setVisible(els.dragChip, true, 1 - e);
    els.dragChip.style.transform = `translate(${chipDx}px, ${chipDy}px) scale(${lerp(1, 0.94, e)})`;
    setVisible(els.codeSnippetText, true, e);
    setHighlightBox(pyHlRect, 1 - e);
    setVisible(els.simCursor, true, 1 - clamp((t - 0.25) / 0.75, 0, 1));
  });
  if (!anim.isCurrent(token)) return;

  setVisible(els.dragChip, false, 0);
  els.dragChip.style.transform = '';
  setVisible(els.codeSnippetText, true, 1);
  setVisible(els.highlightPill, false, 0);
  setVisible(els.simCursor, false, 0);
}

export async function playStep4(anim, token, onComplete) {
  const nt = rectOf(els.wordNonterminal);
  const ntHl = paddedRect(els.wordNonterminal, 6, 2);

  setPythonFullText(PYTHON_LINE.length);
  els.pythonBand.style.width = '';
  const pyBoxRect = rectOf(els.pythonBand);

  await anim.wait(200, token);
  if (!anim.isCurrent(token)) return;

  // Beat A: Dock Nonterminal bubble into Bullet #3
  const clearNtTask = anim.animate(340, token, (t) => {
    setHighlightBox(ntHl, 1 - easeOutCubic(t));
    if (t >= 0.55) els.wordNonterminal.classList.remove('is-highlighted');
  });
  await Promise.all([clearNtTask, dockBubbleIntoBullet(anim, els.bulletNonterminal, token)]);
  if (!anim.isCurrent(token)) return;

  await anim.wait(550, token);
  if (!anim.isCurrent(token)) return;

  // Beat B: Morph to I-beam and type the Python callout sentence
  const afterTypePos = await beatTypePythonCallout(anim, token, { x: nt.right - 8, y: nt.bottom - 4 }, pyBoxRect);
  if (!afterTypePos || !anim.isCurrent(token)) return;

  // Beat C: Drag dotted marquee across Castle Side Example
  const afterMarqueePos = await beatMarqueeCastleExample(anim, token, afterTypePos);
  if (!afterMarqueePos || !anim.isCurrent(token)) return;

  // Deliberate pause so Castle Side Example & empty slot register before dragging "Python"
  await anim.wait(1450, token);
  if (!anim.isCurrent(token)) return;

  // Beat D: Highlight and drag a copy of "Python" up to fill the split() rule slot
  await beatDragPythonRule(anim, token, afterMarqueePos);
  if (!anim.isCurrent(token)) return;

  els.replayBtn.classList.add('is-visible');
  onComplete?.();
}
