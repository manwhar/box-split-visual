/**
 * choreography.js
 * Visual-first 3-column Tower-to-2D-Grid bridge choreography (?step=1..5):
 *   1: Pull leftmost tower from castle while dissolving recessed bg blocks in flight
 *   2: Split 7x12 grid into 7 equal vertical slices
 *   3: Split each vertical slice into horizontal sub-boxes with target spotlighting
 *   4: Drag fill(STONE_BRICKS) x2 from tower.py onto the grid, then fill the rest at once
 *   5: "Make something yourself!" FLIP transition into live interactive 2D mockup
 */

import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from '../intro/anim.js?v=4';
import {
  ALL_CUTS,
  ALL_FILLED_REGIONS,
  ALL_H_CUTS,
  ALL_SUBBOXES,
  ALL_VOID_REGIONS,
  CODE_LINES,
  CODE_STEP_1,
  CODE_STEP_2,
  COLUMN_H_CUTS,
  DRAG_1_REGION,
  DRAG_2_REGION,
  REST_FILLED_REGIONS,
  TOWER_COLS,
  TOWER_ROWS,
  VERTICAL_CUTS
} from './grammar_spec.js?v=4';

const CELL_PX = 48;

export function createTowerController({ targetRenderer, buildRenderer, heroRenderer }) {
  const stageRoot = document.getElementById('stage-root');
  const introSnapshot = document.getElementById('intro-snapshot');
  const originTowerImg = document.getElementById('origin-tower-img');
  const towerStage = document.getElementById('tower-stage');
  const targetCanvas = document.getElementById('target-tower-canvas');
  const buildCanvas = document.getElementById('build-canvas');
  const heroCanvas = document.getElementById('hero-tower-canvas');
  const topSliceTicks = document.getElementById('top-slice-ticks');
  const grammarPanel = document.getElementById('grammar-panel');
  const codeLinesEl = document.getElementById('code-lines');
  const codeDragChip = document.getElementById('code-drag-chip');
  const cursorRipple = document.getElementById('cursor-ripple');
  const simCursor = document.getElementById('sim-cursor');
  const yoursCallout = document.getElementById('yours-callout');
  const yoursHeading = document.getElementById('yours-heading');
  const yoursSub = document.getElementById('yours-sub');
  const chapterStage = document.getElementById('chapter-stage');
  const chapterNum = document.getElementById('chapter-num');
  const chapterTitle = document.getElementById('chapter-title');
  const chapterSub = document.getElementById('chapter-sub');
  const mockupRoom = document.getElementById('mockup-room');
  const mockupScaleWrap = document.getElementById('mockup-scale-wrap');
  const replayBtn = document.getElementById('tower-replay-btn');

  const ALL_FILLED_LINE_IDS = new Set(CODE_LINES.filter((l) => l.filledHtml).map((l) => l.id));

  let interactiveStep4 = false;
  const lineEls = new Map();
  const lineMeta = new Map();

  function setVisible(el, visible, opacity = visible ? 1 : 0) {
    el.style.visibility = visible ? 'visible' : 'hidden';
    el.style.opacity = String(opacity);
  }

  function rectRel(el) {
    const root = stageRoot.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      left: r.left - root.left,
      top: r.top - root.top,
      width: r.width,
      height: r.height,
      cx: r.left - root.left + r.width / 2,
      cy: r.top - root.top + r.height / 2
    };
  }

  function setCursor(x, y, { opacity = 1, scale = 1 } = {}) {
    simCursor.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${scale})`;
    setVisible(simCursor, opacity > 0.001, opacity);
  }

  function triggerRipple(anim, x, y, token) {
    cursorRipple.style.left = `${x}px`;
    cursorRipple.style.top = `${y}px`;
    anim.animate(420, token, (t) => {
      const e = easeOutCubic(t);
      setVisible(cursorRipple, true, (1 - e) * 0.9);
      cursorRipple.style.transform = `scale(${0.45 + e * 1.45})`;
    }).then((ok) => {
      if (ok) setVisible(cursorRipple, false, 0);
    });
  }

  function initSliceTicks() {
    topSliceTicks.innerHTML = '';
    for (let i = 0; i < TOWER_COLS; i++) {
      const tick = document.createElement('span');
      tick.className = 'slice-tick';
      tick.textContent = '1';
      topSliceTicks.appendChild(tick);
    }
  }
  initSliceTicks();

  function setSliceTicks(opacity) {
    topSliceTicks.style.opacity = String(opacity);
  }

  function setInteractiveStep4(enabled) {
    interactiveStep4 = enabled;
    buildCanvas.style.cursor = enabled ? 'pointer' : 'default';
    grammarPanel.classList.toggle('is-interactive', enabled);
  }

  function renderCode(mode, filledIds = new Set()) {
    codeLinesEl.innerHTML = '';
    lineEls.clear();
    lineMeta.clear();

    const list = mode === 'step1' ? CODE_STEP_1 : mode === 'step2' ? CODE_STEP_2 : CODE_LINES;
    for (const line of list) {
      const el = document.createElement('div');
      el.className = 'code-line';
      el.dataset.lineId = line.id;
      const html = line.filledHtml && filledIds.has(line.id) ? line.filledHtml : line.html;
      el.innerHTML = html;
      el.addEventListener('pointerenter', () => {
        if (!interactiveStep4) return;
        applyHoverLine(line.id);
      });
      codeLinesEl.appendChild(el);
      lineEls.set(line.id, el);
      lineMeta.set(line.id, line);
    }
  }

  codeLinesEl.addEventListener('pointerleave', () => {
    if (interactiveStep4) clearHover();
  });

  function clearLineHighlights() {
    for (const el of lineEls.values()) {
      el.classList.remove('is-encompassed', 'is-focus', 'is-drag-active');
    }
  }

  function highlightLines(focusId, extraIds = null) {
    clearLineHighlights();
    if (!focusId) return;
    const meta = lineMeta.get(focusId);
    lineEls.get(focusId)?.classList.add('is-focus');
    const blockIds = extraIds ?? meta?.blockLines ?? [];
    for (const id of blockIds) {
      lineEls.get(id)?.classList.add('is-encompassed');
    }
  }

  function targetFlatState(colSpotlight = null) {
    return {
      backdropAlpha: 1,
      bgProgress: 0,
      fgAlpha: 1,
      gridAlpha: 0,
      outerBorderAlpha: 1,
      colSpotlight
    };
  }

  function labelsForUnfilled(filledSet, alpha = 1) {
    if (alpha <= 0.01) return [];
    return ALL_SUBBOXES.filter((b) => !filledSet.has(`${b.x},${b.y}`)).map((b) => ({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      text: b.text,
      alpha
    }));
  }

  function step4CompletedBuildState(extra = {}) {
    return {
      backdropAlpha: 1,
      bgProgress: 0,
      fgAlpha: 0,
      filledRegions: ALL_FILLED_REGIONS,
      gridAlpha: 1,
      voidBoxes: ALL_VOID_REGIONS,
      filledBoxes: ALL_FILLED_REGIONS,
      solidCuts: ALL_CUTS,
      outerBorderAlpha: 1,
      ...extra
    };
  }

  function applyHoverBoxes(boxes, lineId = null) {
    if (lineId) highlightLines(lineId);
    else clearLineHighlights();

    buildRenderer.render(step4CompletedBuildState({ focusBoxes: boxes, focusAlpha: 1 }));
    const cols = [...new Set(boxes.flatMap((b) => Array.from({ length: b.w }, (_, i) => b.x + i)))];
    targetRenderer.render(
      targetFlatState(cols.length < TOWER_COLS ? { cols, dimAlpha: 0.65, outlineAlpha: 0.85 } : null)
    );
  }

  function applyHoverLine(lineId) {
    const meta = lineMeta.get(lineId);
    if (!meta) return;
    applyHoverBoxes(meta.boxes, lineId);
  }

  function findCellTarget(gx, gy) {
    const sub = ALL_SUBBOXES.find(
      (b) => gx >= b.x && gx < b.x + b.w && gy >= b.y && gy < b.y + b.h
    );
    if (!sub) return null;
    if (sub.col >= 4) {
      return { lineId: 'slices-mirror', boxes: [sub] };
    }
    const leaf = CODE_LINES.find(
      (l) => !l.blockLines && l.boxes?.some((b) => b.x === sub.x && b.y === sub.y)
    );
    return { lineId: leaf?.id ?? null, boxes: [sub] };
  }

  function clearHover() {
    clearLineHighlights();
    if (!interactiveStep4) return;
    buildRenderer.render(step4CompletedBuildState());
    targetRenderer.render(targetFlatState());
  }

  buildCanvas.addEventListener('pointermove', (e) => {
    if (!interactiveStep4) return;
    const r = buildCanvas.getBoundingClientRect();
    const gx = ((e.clientX - r.left) / r.width) * TOWER_COLS;
    const gy = ((e.clientY - r.top) / r.height) * TOWER_ROWS;
    const found = findCellTarget(gx, gy);
    if (found) applyHoverBoxes(found.boxes, found.lineId);
    else clearHover();
  });

  buildCanvas.addEventListener('pointerleave', () => {
    if (interactiveStep4) clearHover();
  });

  function fitMockupRoom() {
    const w = mockupRoom.clientWidth;
    const h = mockupRoom.clientHeight;
    if (!w || !h) return 1.5;
    const scale = Math.min(w / 900, h / 460, 1.5);
    const x = (w - 900 * scale) / 2;
    const y = (h - 460 * scale) / 2;
    mockupScaleWrap.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    return scale;
  }

  function resetAllVisuals() {
    setInteractiveStep4(false);
    clearLineHighlights();
    codeLinesEl.style.opacity = '';
    introSnapshot.classList.remove('is-visible');
    setVisible(introSnapshot, false, 0);
    introSnapshot.style.transform = '';
    originTowerImg.style.opacity = '';
    setVisible(heroCanvas, false, 0);
    heroCanvas.style.transform = '';
    setVisible(towerStage, false, 0);
    towerStage.style.transform = '';
    setVisible(targetCanvas, true, 1);
    setVisible(buildCanvas, true, 1);
    setSliceTicks(0);
    setVisible(codeDragChip, false, 0);
    codeDragChip.style.transform = '';
    setVisible(cursorRipple, false, 0);
    setVisible(simCursor, false, 0);
    setVisible(yoursCallout, false, 0);
    yoursHeading.style.transformOrigin = 'top left';
    yoursHeading.style.transform = '';
    yoursHeading.style.opacity = '';
    yoursSub.style.opacity = '';
    yoursSub.style.transform = '';
    setVisible(chapterStage, false, 0);
    chapterTitle.style.opacity = '';
    chapterNum.style.opacity = '';
    chapterNum.style.transform = '';
    chapterSub.style.opacity = '';
    chapterSub.style.transform = '';
    mockupRoom.style.opacity = '';
    mockupRoom.style.transform = '';
    replayBtn.classList.remove('is-visible');
  }

  function applyStaticState(step, { showReplay = false } = {}) {
    resetAllVisuals();

    if (step <= 0) {
      introSnapshot.classList.add('is-visible');
      setVisible(introSnapshot, true, 1);
      return;
    }

    if (step >= 1 && step <= 4) {
      setVisible(towerStage, true, 1);
      targetRenderer.render(targetFlatState());
    }

    if (step === 1) {
      renderCode('step1');
      setSliceTicks(0);
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        gridAlpha: 1,
        outerBorderAlpha: 1
      });
    } else if (step === 2) {
      renderCode('step2');
      setSliceTicks(1);
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        gridAlpha: 1,
        solidCuts: VERTICAL_CUTS,
        outerBorderAlpha: 1
      });
    } else if (step === 3) {
      renderCode('step34', new Set());
      setSliceTicks(1);
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        gridAlpha: 1,
        cellLabels: labelsForUnfilled(new Set(), 1),
        solidCuts: ALL_CUTS,
        outerBorderAlpha: 1
      });
    } else if (step === 4) {
      renderCode('step34', ALL_FILLED_LINE_IDS);
      setSliceTicks(1);
      buildRenderer.render(step4CompletedBuildState());
      setInteractiveStep4(true);
    } else if (step === 5) {
      fitMockupRoom();
      setVisible(chapterStage, true, 1);
      chapterTitle.style.opacity = '1';
    }

    if (showReplay && step >= 1) {
      replayBtn.classList.add('is-visible');
    }
  }

  async function playStep1(anim, token) {
    applyStaticState(0);

    // Prepare destination stage invisibly so destRect can be measured cleanly
    renderCode('step1');
    setSliceTicks(0);
    buildRenderer.render({
      backdropAlpha: 1,
      bgProgress: 0,
      fgAlpha: 0,
      gridAlpha: 1,
      outerBorderAlpha: 1
    });
    setVisible(targetCanvas, false, 0);
    setVisible(towerStage, true, 0);

    const originRect = rectRel(originTowerImg);
    const destRect = rectRel(targetCanvas);
    const sx0 = originRect.width / destRect.width;
    const sy0 = originRect.height / destRect.height;

    await anim.wait(200, token);
    if (!anim.isCurrent(token)) return;

    heroRenderer.render({
      backdropAlpha: 0,
      bgProgress: 1,
      fgAlpha: 1,
      gridAlpha: 0,
      outerBorderAlpha: 0
    });
    heroCanvas.style.transform = `translate(${originRect.left}px, ${originRect.top}px) scale(${sx0}, ${sy0})`;
    setVisible(heroCanvas, true, 1);
    originTowerImg.style.opacity = '0';

    // Single seamless glide: pull tower to left slot while dissolving bg walls in flight
    await anim.animate(1150, token, (t) => {
      const e = easeInOutCubic(t);
      const x = lerp(originRect.left, destRect.left, e);
      const y = lerp(originRect.top, destRect.top, e);
      const sx = lerp(sx0, 1, e);
      const sy = lerp(sy0, 1, e);
      heroCanvas.style.transform = `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;

      const bgFade = 1 - easeInOutCubic(clamp((t - 0.1) / 0.72, 0, 1));
      const frameIn = easeOutCubic(clamp((t - 0.3) / 0.65, 0, 1));
      heroRenderer.render({
        backdropAlpha: frameIn,
        bgProgress: bgFade,
        fgAlpha: 1,
        gridAlpha: 0,
        outerBorderAlpha: frameIn
      });

      const introFade = 1 - clamp(t / 0.64, 0, 1);
      setVisible(introSnapshot, introFade > 0.002, easeOutCubic(introFade));
      introSnapshot.style.transform = `scale(${lerp(1, 0.985, e)})`;

      const stageIn = easeOutCubic(clamp((t - 0.36) / 0.64, 0, 1));
      setVisible(towerStage, true, stageIn);
    });
    if (!anim.isCurrent(token)) return;

    introSnapshot.classList.remove('is-visible');
    setVisible(introSnapshot, false, 0);
    introSnapshot.style.transform = '';
    setVisible(towerStage, true, 1);

    // Atomic 0.0px handoff to #target-tower-canvas
    targetRenderer.render(targetFlatState());
    setVisible(targetCanvas, true, 1);
    setVisible(heroCanvas, false, 0);
    heroCanvas.style.transform = '';

    replayBtn.classList.add('is-visible');
  }

  async function playStep2(anim, token) {
    applyStaticState(1);

    await anim.wait(220, token);
    if (!anim.isCurrent(token)) return;

    // Cross-fade code to 7 equal vertical slices
    await anim.animate(180, token, (t) => {
      codeLinesEl.style.opacity = String(1 - easeOutCubic(t));
    });
    if (!anim.isCurrent(token)) return;
    renderCode('step2');
    highlightLines('s2-split', ['s2-col-0', 's2-col-1', 's2-col-2', 's2-col-3', 's2-col-4', 's2-col-5', 's2-col-6']);
    await anim.animate(220, token, (t) => {
      codeLinesEl.style.opacity = String(easeOutCubic(t));
    });
    if (!anim.isCurrent(token)) return;
    codeLinesEl.style.opacity = '';

    // Sweep 6 vertical cuts left-to-right across the 7x12 grid in one step
    await anim.animate(820, token, (t) => {
      const knives = VERTICAL_CUTS.map((cut, i) => {
        const local = clamp((t - i * 0.055) / 0.68, 0, 1);
        return { ...cut, progress: easeInOutCubic(local), alpha: 1 };
      });
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        gridAlpha: 1,
        knifeCuts: knives,
        outerBorderAlpha: 1
      });
    });
    if (!anim.isCurrent(token)) return;

    // Solidify cuts & fade in top width ticks (1, 1, 1, 1, 1, 1, 1)
    await anim.animate(280, token, (t) => {
      const e = easeOutCubic(t);
      setSliceTicks(e);
      targetRenderer.render(targetFlatState());
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        gridAlpha: 1,
        solidCuts: VERTICAL_CUTS,
        knifeCuts: VERTICAL_CUTS.map((c) => ({ ...c, progress: 1, alpha: 1 - e })),
        outerBorderAlpha: 1
      });
    });
    if (!anim.isCurrent(token)) return;

    setSliceTicks(1);
    clearLineHighlights();
    replayBtn.classList.add('is-visible');
  }

  async function playStep3(anim, token) {
    applyStaticState(2);

    await anim.wait(200, token);
    if (!anim.isCurrent(token)) return;

    // Expand tower.py into per-slice horizontal splits
    await anim.animate(180, token, (t) => {
      codeLinesEl.style.opacity = String(1 - easeOutCubic(t));
    });
    if (!anim.isCurrent(token)) return;
    renderCode('step34', new Set());
    await anim.animate(220, token, (t) => {
      codeLinesEl.style.opacity = String(easeOutCubic(t));
    });
    if (!anim.isCurrent(token)) return;
    codeLinesEl.style.opacity = '';

    const completedHCuts = [];
    const shownCols = new Set();

    const currentLabels = (extraLabels = []) => [
      ...ALL_SUBBOXES.filter((b) => shownCols.has(b.col)).map((b) => ({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        text: b.text,
        alpha: 1
      })),
      ...extraLabels
    ];

    const groups = [
      {
        cols: [0],
        line: 'c0-split',
        cuts: COLUMN_H_CUTS[0],
        duration: 480
      },
      {
        cols: [1],
        line: 'c1-split',
        cuts: COLUMN_H_CUTS[1],
        duration: 480
      },
      {
        cols: [2],
        line: 'c2-split',
        cuts: COLUMN_H_CUTS[2],
        duration: 700
      },
      {
        cols: [3, 4, 5, 6],
        line: 'c3-split',
        extraLines: ['c3-top', 'c3-bricks', 'slices-mirror'],
        cuts: [...COLUMN_H_CUTS[3], ...COLUMN_H_CUTS[4], ...COLUMN_H_CUTS[5], ...COLUMN_H_CUTS[6]],
        duration: 720
      }
    ];

    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
      const grp = groups[gIdx];
      highlightLines(grp.line, grp.extraLines ?? null);

      // Spotlight active column(s) on target tower
      if (gIdx === 0) {
        await anim.animate(220, token, (t) => {
          const e = easeOutCubic(t);
          targetRenderer.render(
            targetFlatState({ cols: grp.cols, dimAlpha: 0.68 * e, outlineAlpha: 0.85 * e })
          );
        });
        if (!anim.isCurrent(token)) return;
      } else {
        targetRenderer.render(targetFlatState({ cols: grp.cols, dimAlpha: 0.68, outlineAlpha: 0.85 }));
      }

      // Sweep horizontal knife cuts within the column(s)
      await anim.animate(grp.duration, token, (t) => {
        const knives = grp.cuts.map((cut, idx) => {
          const stagger = grp.cuts.length > 1 ? (idx % 7) * 0.05 : 0;
          const local = clamp((t - stagger) / (1 - Math.min(0.45, stagger)), 0, 1);
          return { ...cut, progress: easeInOutCubic(local), alpha: 1 };
        });
        buildRenderer.render({
          backdropAlpha: 1,
          bgProgress: 0,
          fgAlpha: 0,
          gridAlpha: 1,
          cellLabels: currentLabels(),
          solidCuts: [...VERTICAL_CUTS, ...completedHCuts],
          knifeCuts: knives,
          outerBorderAlpha: 1
        });
      });
      if (!anim.isCurrent(token)) return;

      completedHCuts.push(...grp.cuts);
      const colSet = new Set(grp.cols);
      const fadingLabels = ALL_SUBBOXES.filter((b) => colSet.has(b.col));

      await anim.animate(260, token, (t) => {
        const e = easeOutCubic(t);
        buildRenderer.render({
          backdropAlpha: 1,
          bgProgress: 0,
          fgAlpha: 0,
          gridAlpha: 1,
          cellLabels: currentLabels(
            fadingLabels.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, text: b.text, alpha: e }))
          ),
          solidCuts: [...VERTICAL_CUTS, ...completedHCuts],
          knifeCuts: grp.cuts.map((c) => ({ ...c, progress: 1, alpha: 1 - e })),
          outerBorderAlpha: 1
        });
      });
      if (!anim.isCurrent(token)) return;

      grp.cols.forEach((c) => shownCols.add(c));
      await anim.wait(120, token);
      if (!anim.isCurrent(token)) return;
    }

    // Restore full brightness on target tower
    await anim.animate(280, token, (t) => {
      const e = 1 - easeOutCubic(t);
      targetRenderer.render(
        targetFlatState(e > 0.01 ? { cols: [3, 4, 5, 6], dimAlpha: 0.68 * e, outlineAlpha: 0.85 * e } : null)
      );
    });
    if (!anim.isCurrent(token)) return;

    targetRenderer.render(targetFlatState());
    clearLineHighlights();
    replayBtn.classList.add('is-visible');
  }

  async function playStep4(anim, token) {
    applyStaticState(3);

    const filledLineIds = new Set();
    const filledRegionKeys = new Set();
    const lockedRegions = [];

    const renderBuildProgress = (extra = {}) => {
      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        filledRegions: extra.filledRegions ?? lockedRegions,
        gridAlpha: 1,
        cellLabels: extra.cellLabels ?? labelsForUnfilled(filledRegionKeys, 1),
        dropHighlightBox: extra.dropHighlightBox ?? null,
        filledBoxes: extra.filledBoxes ?? lockedRegions,
        solidCuts: ALL_CUTS,
        outerBorderAlpha: 1
      });
    };

    async function animateDragFill(lineId, region, prevCursorPos) {
      // 1. Update line in tower.py from void() to fill(STONE_BRICKS) & light up region
      const meta = lineMeta.get(lineId);
      const lineEl = lineEls.get(lineId);
      filledLineIds.add(lineId);
      lineEl.innerHTML = meta.filledHtml;
      clearLineHighlights();
      lineEl.classList.add('is-drag-active');

      await anim.animate(260, token, (t) => {
        const e = easeOutCubic(t);
        renderBuildProgress({ dropHighlightBox: { ...region, alpha: e * 0.7 } });
      });
      if (!anim.isCurrent(token)) return null;

      const snipEl = lineEl.querySelector('.drag-snippet') || lineEl;
      const snipRect = rectRel(snipEl);
      const pickX = snipRect.left + snipRect.width * 0.56;
      const pickY = snipRect.top + snipRect.height * 0.58;

      const startX = prevCursorPos ? prevCursorPos.x : snipRect.left + snipRect.width + 70;
      const startY = prevCursorPos ? prevCursorPos.y : snipRect.top + 36;

      // 2. Glide cursor to the fill(STONE_BRICKS) snippet
      setCursor(startX, startY, { opacity: prevCursorPos ? 1 : 0 });
      await anim.animate(prevCursorPos ? 760 : 620, token, (t) => {
        const e = easeInOutCubic(t);
        const arcY = Math.sin(e * Math.PI) * -18;
        setCursor(lerp(startX, pickX, e), lerp(startY, pickY, e) + arcY, {
          opacity: prevCursorPos ? 1 : clamp(t * 3.2, 0, 1)
        });
      });
      if (!anim.isCurrent(token)) return null;

      // 3. Click ripple & pick up chip
      triggerRipple(anim, pickX, pickY, token);
      setCursor(pickX, pickY, { opacity: 1, scale: 0.9 });

      const chipW = codeDragChip.offsetWidth;
      const chipH = codeDragChip.offsetHeight;
      const chipStartLeft = snipRect.cx - chipW / 2;
      const chipStartTop = snipRect.cy - chipH / 2;
      codeDragChip.style.left = `${chipStartLeft}px`;
      codeDragChip.style.top = `${chipStartTop}px`;

      await anim.animate(160, token, (t) => {
        const e = easeOutCubic(t);
        setVisible(codeDragChip, true, e);
        codeDragChip.style.transform = `translate(0px, 0px) scale(${lerp(0.95, 1.05, e)})`;
      });
      if (!anim.isCurrent(token)) return null;

      // 4. Drag chip across to target box on #build-canvas
      const buildRect = rectRel(buildCanvas);
      const destX = buildRect.left + (region.x + region.w / 2) * CELL_PX;
      const destY = buildRect.top + (region.y + region.h / 2) * CELL_PX;
      const chipDx = (destX - chipW / 2) - chipStartLeft;
      const chipDy = (destY - chipH / 2) - chipStartTop;

      await anim.animate(980, token, (t) => {
        const e = easeInOutCubic(t);
        const arcX = Math.sin(e * Math.PI) * -22;
        const arcY = Math.sin(e * Math.PI) * -44;
        const cx = lerp(pickX, destX, e) + arcX;
        const cy = lerp(pickY, destY, e) + arcY;
        codeDragChip.style.transform = `translate(${chipDx * e + arcX}px, ${chipDy * e + arcY}px) scale(${lerp(1.05, 1, e)})`;
        setCursor(cx, cy, { opacity: 1, scale: 0.9 });

        const targetAlpha = e > 0.55 ? lerp(0.7, 1, (e - 0.55) / 0.45) : 0.7;
        renderBuildProgress({ dropHighlightBox: { ...region, alpha: targetAlpha } });
      });
      if (!anim.isCurrent(token)) return null;

      // 5. Drop ripple & wipe-fill region top-to-bottom
      triggerRipple(anim, destX, destY, token);
      setCursor(destX, destY, { opacity: 1, scale: 1 });
      lineEl.classList.remove('is-drag-active');

      const regKey = `${region.x},${region.y}`;
      const wipeMs = region.h > 4 ? 460 : 300;
      await anim.animate(wipeMs, token, (t) => {
        const e = easeOutCubic(t);
        const chipFade = 1 - clamp(t / 0.45, 0, 1);
        setVisible(codeDragChip, chipFade > 0.002, chipFade);
        codeDragChip.style.transform = `translate(${chipDx}px, ${chipDy}px) scale(${lerp(1, 0.92, 1 - chipFade)})`;

        const labels = ALL_SUBBOXES.filter(
          (b) => !filledRegionKeys.has(`${b.x},${b.y}`)
        ).map((b) => ({
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          text: b.text,
          alpha: `${b.x},${b.y}` === regKey ? 1 - e : 1
        }));

        renderBuildProgress({
          filledRegions: [...lockedRegions, { ...region, alpha: 1, wipeProgress: e }],
          filledBoxes: [...lockedRegions, { ...region, alpha: e }],
          dropHighlightBox: { ...region, alpha: 1 - e },
          cellLabels: labels
        });
      });
      if (!anim.isCurrent(token)) return null;

      setVisible(codeDragChip, false, 0);
      codeDragChip.style.transform = '';
      filledRegionKeys.add(regKey);
      lockedRegions.push(region);
      renderBuildProgress();

      return { x: destX, y: destY };
    }

    await anim.wait(200, token);
    if (!anim.isCurrent(token)) return;

    // Drag #1: 11-block stone pier in slice 2
    const afterDrag1 = await animateDragFill('c1-bricks', DRAG_1_REGION, null);
    if (!afterDrag1 || !anim.isCurrent(token)) return;

    await anim.wait(220, token);
    if (!anim.isCurrent(token)) return;

    // Drag #2: top stone lintel in slice 3
    const afterDrag2 = await animateDragFill('c2-lintel-0', DRAG_2_REGION, afterDrag1);
    if (!afterDrag2 || !anim.isCurrent(token)) return;

    await anim.wait(320, token);
    if (!anim.isCurrent(token)) return;

    // Fade cursor out, flip remaining lines in tower.py, and fill the rest all at once
    const newlyFilledIds = [];
    for (const line of CODE_LINES) {
      if (line.filledHtml && !filledLineIds.has(line.id)) {
        filledLineIds.add(line.id);
        const el = lineEls.get(line.id);
        el.innerHTML = line.filledHtml;
        el.classList.add('is-drag-active');
        newlyFilledIds.push(el);
      }
    }

    await anim.animate(640, token, (t) => {
      const cursorFade = 1 - clamp(t / 0.35, 0, 1);
      setCursor(afterDrag2.x, afterDrag2.y, { opacity: cursorFade });

      const e = easeInOutCubic(t);
      const restAnimated = REST_FILLED_REGIONS.map((reg) => ({
        ...reg,
        alpha: e,
        wipeProgress: 1
      }));
      const labels = ALL_SUBBOXES.filter(
        (b) => !filledRegionKeys.has(`${b.x},${b.y}`)
      ).map((b) => ({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        text: b.text,
        alpha: 1 - e
      }));

      buildRenderer.render({
        backdropAlpha: 1,
        bgProgress: 0,
        fgAlpha: 0,
        filledRegions: [...lockedRegions, ...restAnimated],
        gridAlpha: 1,
        cellLabels: labels,
        voidBoxes: ALL_VOID_REGIONS.map((b) => ({ ...b, alpha: e })),
        filledBoxes: [
          ...lockedRegions,
          ...REST_FILLED_REGIONS.map((b) => ({ ...b, alpha: e }))
        ],
        solidCuts: ALL_CUTS,
        outerBorderAlpha: 1
      });
    });
    if (!anim.isCurrent(token)) return;

    setVisible(simCursor, false, 0);
    newlyFilledIds.forEach((el) => el.classList.remove('is-drag-active'));
    buildRenderer.render(step4CompletedBuildState());
    setInteractiveStep4(true);
    replayBtn.classList.add('is-visible');
  }

  async function playStep5(anim, token) {
    applyStaticState(4);
    setInteractiveStep4(false);
    fitMockupRoom();

    const skipToInteractive = (e) => {
      if (e?.target?.closest?.('#tower-replay-btn')) return;
      if (!anim.isCurrent(token)) return;
      stageRoot.removeEventListener('pointerdown', skipToInteractive);
      anim.nextToken();
      applyStaticState(5, { showReplay: true });
    };
    stageRoot.addEventListener('pointerdown', skipToInteractive);

    try {
      yoursHeading.style.transformOrigin = 'center center';
      await anim.animate(540, token, (t) => {
        const e = easeInOutCubic(t);
        const fadeOut = 1 - easeOutCubic(clamp(t / 0.65, 0, 1));
        setVisible(towerStage, fadeOut > 0.002, fadeOut);
        towerStage.style.transform = `scale(${lerp(1, 0.96, e)})`;

        const textIn = easeOutBack(clamp((t - 0.15) / 0.85, 0, 1));
        const textAlpha = clamp((t - 0.15) / 0.55, 0, 1);
        setVisible(yoursCallout, textAlpha > 0.002, textAlpha);
        yoursHeading.style.transform = `scale(${lerp(0.92, 1, textIn)})`;
        yoursSub.style.opacity = String(textAlpha);
      });
      if (!anim.isCurrent(token)) return;
      setVisible(towerStage, false, 0);
      towerStage.style.transform = '';
      yoursHeading.style.transform = 'scale(1)';

      await anim.wait(2350, token);
      if (!anim.isCurrent(token)) return;

      yoursHeading.style.transformOrigin = 'top left';
      yoursHeading.style.transform = '';
      setVisible(chapterStage, true, 0);
      chapterTitle.style.opacity = '0';
      const fromRect = rectRel(yoursHeading);
      const toRect = rectRel(chapterTitle);
      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      const scaleRatio = toRect.height / fromRect.height;

      await anim.animate(780, token, (t) => {
        const e = easeInOutCubic(t);
        const subOut = 1 - easeOutCubic(clamp(t / 0.34, 0, 1));
        yoursSub.style.opacity = String(subOut);
        yoursSub.style.transform = `translateY(${lerp(0, 10, 1 - subOut)}px)`;

        yoursHeading.style.transform = `translate(${dx * e}px, ${dy * e}px) scale(${lerp(1, scaleRatio, e)})`;

        const stageIn = easeOutCubic(clamp((t - 0.16) / 0.84, 0, 1));
        setVisible(chapterStage, true, stageIn);
        const rise = lerp(16, 0, stageIn);
        chapterNum.style.opacity = String(stageIn);
        chapterNum.style.transform = `translateY(${rise * 0.5}px)`;
        chapterSub.style.opacity = String(stageIn);
        chapterSub.style.transform = `translateY(${rise * 0.5}px)`;
        mockupRoom.style.opacity = String(stageIn);
        mockupRoom.style.transform = `translateY(${rise}px)`;
      });
      if (!anim.isCurrent(token)) return;

      applyStaticState(5, { showReplay: true });
    } finally {
      stageRoot.removeEventListener('pointerdown', skipToInteractive);
    }
  }

  return {
    applyStaticState,
    fitMockupRoom,
    playStep1,
    playStep2,
    playStep3,
    playStep4,
    playStep5
  };
}
