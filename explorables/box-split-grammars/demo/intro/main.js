/**
 * main.js
 * Entry point for Slide 2's choreographed intro stage (?step=0..4).
 */

import { createAnimator } from './anim.js';
import { playStep1, playStep2, playStep3, playStep4 } from './choreography.js';
import { applyStaticState } from './dom.js';
import { initInteractions } from './interactions.js';

const params = new URLSearchParams(location.search);
const parsedStep = Number.parseInt(params.get('step') ?? '0', 10);
const STEP = Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep <= 4 ? parsedStep : 0;

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const anim = createAnimator();

let isStageVisible = window === window.top;
let receivedDeckMessage = false;

const interactions = initInteractions({
  getStep: () => STEP,
  isVisible: () => isStageVisible,
  onReplay: () => runActiveSequence()
});

const staticHooks = {
  onEnableInteractive: interactions.enableStep4,
  onClearInteractive: interactions.clearStep4
};

async function runActiveSequence() {
  const token = anim.nextToken();
  await document.fonts?.ready;
  if (!anim.isCurrent(token)) return;

  if (STEP === 0 || reducedMotion) {
    applyStaticState(STEP, staticHooks);
    return;
  }

  applyStaticState(STEP - 1, staticHooks);
  if (STEP === 1) await playStep1(anim, token);
  else if (STEP === 2) await playStep2(anim, token);
  else if (STEP === 3) await playStep3(anim, token);
  else if (STEP === 4) await playStep4(anim, token, interactions.enableStep4);
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'deck:visibility') return;
  const visible = Boolean(event.data.visible);
  if (receivedDeckMessage && visible === isStageVisible) return;
  receivedDeckMessage = true;
  isStageVisible = visible;
  if (!visible) {
    anim.nextToken();
    applyStaticState(STEP === 0 ? 0 : STEP - 1, staticHooks);
  } else {
    runActiveSequence();
  }
});

if (!isStageVisible) {
  applyStaticState(STEP === 0 ? 0 : STEP - 1, staticHooks);
}

document.fonts?.ready.then(() => {
  if (receivedDeckMessage) {
    if (!isStageVisible) applyStaticState(STEP === 0 ? 0 : STEP - 1, staticHooks);
    return;
  }
  if (!isStageVisible) {
    applyStaticState(STEP === 0 ? 0 : STEP - 1, staticHooks);
  } else {
    runActiveSequence();
  }
});
