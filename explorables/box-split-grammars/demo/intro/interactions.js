/**
 * interactions.js
 * Step 0 Basic 3D paper pointer swivel, Step 4 castle hover linking, and Replay button.
 */

import { clamp } from './anim.js';
import { els } from './dom.js';

export function initInteractions({ getStep, isVisible, onReplay }) {
  let interactiveEnabled = false;
  const castlePieces = [...document.querySelectorAll('.castle-piece')];
  const sliceTokens = [...document.querySelectorAll('[data-slice]')];
  const ruleCodeTokens = [...document.querySelectorAll('[data-part-ref]')];

  function resetLinkOnly() {
    castlePieces.forEach((p) => p.classList.remove('is-linked', 'is-dimmed'));
    sliceTokens.forEach((s) => s.classList.remove('is-linked'));
    ruleCodeTokens.forEach((c) => c.classList.remove('is-linked'));
  }

  function clearStep4() {
    interactiveEnabled = false;
    els.wallExample.classList.remove('is-interactive');
    resetLinkOnly();
  }

  function enableStep4() {
    interactiveEnabled = true;
    els.wallExample.classList.add('is-interactive');
  }

  function applyLink(matchesPiece, partName) {
    if (!interactiveEnabled) return;
    castlePieces.forEach((p, i) => {
      const match = matchesPiece(p, i);
      p.classList.toggle('is-linked', match);
      p.classList.toggle('is-dimmed', !match);
      sliceTokens.forEach((s) => {
        if (Number(s.dataset.slice) === i) s.classList.toggle('is-linked', match);
      });
    });
    ruleCodeTokens.forEach((c) => c.classList.toggle('is-linked', c.dataset.partRef === partName));
  }

  const highlightByIndex = (idx) => applyLink((_, i) => i === idx, castlePieces[idx]?.dataset.partName);
  const highlightByPart = (partName) => applyLink((p) => p.dataset.partName === partName, partName);

  // Step 0 interactive Premiere Pro Basic 3D pointer swivel
  els.stageRoot.addEventListener('pointermove', (e) => {
    if (getStep() !== 0 || !isVisible()) return;
    const r = els.stageRoot.getBoundingClientRect();
    const nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    const ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    const ry = -14 + nx * 4.5;
    const rx = 10 - ny * 4.0;
    els.paperCard.style.transition = 'transform 0.14s ease-out';
    els.paperCard.style.transform = `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateZ(-1.2deg)`;
    els.paperSheen.style.background = `linear-gradient(${125 + nx * 18}deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.12) 34%, rgba(255,255,255,0) 56%, rgba(15,23,42,0.05) 100%)`;
  });

  els.stageRoot.addEventListener('pointerleave', () => {
    if (getStep() !== 0) return;
    els.paperCard.style.transition = 'transform 0.45s ease-out';
    els.paperCard.style.transform = 'rotateY(-14deg) rotateX(10deg) rotateZ(-1.2deg)';
  });

  castlePieces.forEach((piece) => {
    const idx = Number(piece.dataset.castleIdx);
    piece.addEventListener('pointerenter', () => highlightByIndex(idx));
    piece.addEventListener('pointerleave', resetLinkOnly);
  });

  sliceTokens.forEach((tok) => {
    const idx = Number(tok.dataset.slice);
    tok.addEventListener('pointerenter', () => highlightByIndex(idx));
    tok.addEventListener('pointerleave', resetLinkOnly);
  });

  ruleCodeTokens.forEach((codeEl) => {
    const partName = codeEl.dataset.partRef;
    codeEl.addEventListener('pointerenter', () => highlightByPart(partName));
    codeEl.addEventListener('pointerleave', resetLinkOnly);
  });

  els.replayBtn.addEventListener('click', () => {
    if (getStep() === 4) onReplay();
  });

  return { enableStep4, clearStep4 };
}
