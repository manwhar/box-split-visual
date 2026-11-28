/**
 * main.js
 * Entry point for the 3-column Tower-to-2D-Grid bridge slides (demo/tower.html?step=1..5).
 */

import { clamp, createAnimator } from '../intro/anim.js?v=4';
import { createTowerController } from './choreography.js?v=5';
import { TowerRenderer, loadTowerAssets } from './tower_canvas.js?v=4';

const params = new URLSearchParams(location.search);
const parsedStep = Number.parseInt(params.get('step') ?? '1', 10);
const STEP = Number.isFinite(parsedStep) ? clamp(parsedStep, 1, 5) : 1;

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const anim = createAnimator();

let isStageVisible = window === window.top;
let receivedDeckMessage = false;
let currentDetail = window.devicePixelRatio || 1;
let readyController = null;
let readyRenderers = null;

const targetCanvas = document.getElementById('target-tower-canvas');
const buildCanvas = document.getElementById('build-canvas');
const heroCanvas = document.getElementById('hero-tower-canvas');
const replayBtn = document.getElementById('tower-replay-btn');
const mockupFrame = document.getElementById('mockup-frame');

const NAV_KEYS = new Set([
  'ArrowRight',
  'ArrowLeft',
  'PageDown',
  'PageUp',
  ' ',
  'Home',
  'End',
  'f',
  'F',
  'n',
  'N',
  'p',
  'P',
  'r',
  'R',
  'e',
  'E',
  'Escape'
]);

const SPACE_CONTROLS =
  'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';

function forwardToMockup() {
  if (STEP !== 5 || !mockupFrame?.contentWindow) return;
  const scale = readyController ? readyController.fitMockupRoom() : 1.5;
  mockupFrame.contentWindow.postMessage(
    { type: 'deck:resolution', detail: Math.min(4, currentDetail * scale) },
    '*'
  );
  mockupFrame.contentWindow.postMessage(
    { type: 'deck:visibility', visible: isStageVisible },
    '*'
  );
}

if (STEP === 5 && mockupFrame) {
  mockupFrame.addEventListener('load', () => {
    forwardToMockup();
    try {
      const doc = mockupFrame.contentDocument;
      doc?.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const typing =
          /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
        if (typing) return;
        if (e.key === ' ' && e.target?.closest?.(SPACE_CONTROLS)) return;
        if (!NAV_KEYS.has(e.key)) return;
        e.preventDefault();
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: e.key,
            code: e.code,
            bubbles: true,
            cancelable: true
          })
        );
      });
    } catch {
      // Same-origin fallback if nested frame cannot be inspected
    }
  });
  mockupFrame.src = 'index.html?v=4';
}

const waitFontsReady = () =>
  Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 600))
  ]);

const assetsReady = loadTowerAssets()
  .then((assets) => {
    const targetRenderer = new TowerRenderer(targetCanvas, assets);
    const buildRenderer = new TowerRenderer(buildCanvas, assets);
    const heroRenderer = new TowerRenderer(heroCanvas, assets);
    targetRenderer.setResolution(currentDetail);
    buildRenderer.setResolution(currentDetail);
    heroRenderer.setResolution(currentDetail);
    readyRenderers = { targetRenderer, buildRenderer, heroRenderer };
    readyController = createTowerController(readyRenderers);
    return readyController;
  })
  .catch((err) => {
    console.error('[tower] Failed to initialize assets:', err);
    throw err;
  });

async function runActiveSequence() {
  const token = anim.nextToken();
  const controller = await assetsReady;
  if (!anim.isCurrent(token)) return;

  if (reducedMotion) {
    controller.applyStaticState(STEP, { showReplay: true });
    forwardToMockup();
    return;
  }

  controller.applyStaticState(STEP - 1);
  await waitFontsReady();
  if (!anim.isCurrent(token)) return;

  if (STEP === 1) await controller.playStep1(anim, token);
  else if (STEP === 2) await controller.playStep2(anim, token);
  else if (STEP === 3) await controller.playStep3(anim, token);
  else if (STEP === 4) await controller.playStep4(anim, token);
  else if (STEP === 5) {
    forwardToMockup();
    await controller.playStep5(anim, token);
  }
}

replayBtn.addEventListener('click', () => {
  runActiveSequence();
});

window.addEventListener('message', async (event) => {
  if (event.data?.type === 'deck:resolution') {
    currentDetail = event.data.detail || window.devicePixelRatio || 1;
    if (readyRenderers) {
      readyRenderers.targetRenderer.setResolution(currentDetail);
      readyRenderers.buildRenderer.setResolution(currentDetail);
      readyRenderers.heroRenderer.setResolution(currentDetail);
    }
    forwardToMockup();
    return;
  }

  if (event.data?.type !== 'deck:visibility') return;
  const visible = Boolean(event.data.visible);
  if (receivedDeckMessage && visible === isStageVisible) return;
  receivedDeckMessage = true;
  isStageVisible = visible;

  if (!visible) {
    anim.nextToken();
    const controller = await assetsReady;
    if (!isStageVisible) {
      controller.applyStaticState(STEP - 1);
      forwardToMockup();
    }
  } else {
    runActiveSequence();
  }
});

assetsReady.then((controller) => {
  if (!isStageVisible) {
    controller.applyStaticState(STEP - 1);
    forwardToMockup();
    return;
  }
  if (!receivedDeckMessage) {
    runActiveSequence();
  }
});
