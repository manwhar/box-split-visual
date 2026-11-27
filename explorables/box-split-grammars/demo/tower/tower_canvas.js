/**
 * tower_canvas.js
 * Pixel-exact renderer for demo/assets/tower.json (reproducing tools/ui/renderer.js
 * foreground, dimmed recessed background, crevice shadows, and auto-connected walls)
 * with support for partial region wipe fills, in-box size labels, knife sweeps,
 * drop highlights, and uncut reference column spotlighting.
 */

import { clamp, lerp } from '../intro/anim.js?v=3';
import { TOWER_COLS, TOWER_ROWS } from './grammar_spec.js?v=3';

function makeOffscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function getTexId(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.texture;
}

function isWallConnectable(entry) {
  const id = getTexId(entry);
  return id === 'stone_bricks' || id === 'cobblestone' || id === 'cobblestone_wall';
}

function drawWallTile(ctx, r, c, layerKey, data, textures, cellPx, dx, dy) {
  const srcImg = textures.cobblestone;
  const cells = data.cells;
  const rows = data.rows;
  const cols = data.cols;

  const getCell = (rr, cc) => (rr >= 0 && rr < rows && cc >= 0 && cc < cols ? cells[rr]?.[cc] : null);
  const leftCell = getCell(r, c - 1);
  const rightCell = getCell(r, c + 1);
  const aboveCell = getCell(r - 1, c);

  const connectLeft = isWallConnectable(leftCell?.[layerKey]);
  const connectRight = isWallConnectable(rightCell?.[layerKey]);
  const hasAbove = Boolean(aboveCell?.[layerKey] || (layerKey === 'fg' && aboveCell?.fgDecor));
  const hasSolidAbove = isWallConnectable(aboveCell?.[layerKey]);

  const u = cellPx / 16;
  const x0 = dx;
  const x1 = dx + Math.round(4 * u);
  const x2 = dx + Math.round(12 * u);
  const x3 = dx + cellPx;
  const wingTopTexel = hasSolidAbove ? 0 : 2;
  const yWing = dy + Math.round(wingTopTexel * u);
  const hWing = dy + cellPx - yWing;

  const srcScaleX = srcImg.width / 16;
  const srcScaleY = srcImg.height / 16;

  if (connectLeft && connectRight && !hasAbove) {
    ctx.drawImage(
      srcImg,
      0,
      2 * srcScaleY,
      16 * srcScaleX,
      14 * srcScaleY,
      dx,
      yWing,
      cellPx,
      hWing
    );
    return;
  }

  ctx.drawImage(srcImg, 4 * srcScaleX, 0, 8 * srcScaleX, 16 * srcScaleY, x1, dy, x2 - x1, cellPx);

  if (connectLeft) {
    ctx.drawImage(
      srcImg,
      0,
      wingTopTexel * srcScaleY,
      4 * srcScaleX,
      (16 - wingTopTexel) * srcScaleY,
      x0,
      yWing,
      x1 - x0,
      hWing
    );
  }

  if (connectRight) {
    ctx.drawImage(
      srcImg,
      12 * srcScaleX,
      wingTopTexel * srcScaleY,
      4 * srcScaleX,
      (16 - wingTopTexel) * srcScaleY,
      x2,
      yWing,
      x3 - x2,
      hWing
    );
  }
}

function drawCellLayer(ctx, r, c, entry, layerKey, data, textures, cellPx, dx, dy) {
  const texId = getEntryTexId(entry);
  if (!texId) return;
  if (texId === 'cobblestone_wall') {
    drawWallTile(ctx, r, c, layerKey, data, textures, cellPx, dx, dy);
    return;
  }
  const img = textures[texId];
  if (img) {
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, cellPx, cellPx);
  }
}

function getEntryTexId(entry) {
  return getTexId(entry);
}

function buildShadowedBgCanvas(data, textures, exportCellPx = 64) {
  const w = data.cols * exportCellPx;
  const h = data.rows * exportCellPx;
  const { canvas: bgCanvas, ctx: bgCtx } = makeOffscreen(w, h);
  const { canvas: fgOccCanvas, ctx: fgOccCtx } = makeOffscreen(w, h);

  let hasBg = false;
  let hasFg = false;

  for (let r = 0; r < data.rows; r++) {
    for (let c = 0; c < data.cols; c++) {
      const cell = data.cells[r]?.[c];
      if (!cell) continue;
      const dx = c * exportCellPx;
      const dy = r * exportCellPx;
      if (cell.bg) {
        drawCellLayer(bgCtx, r, c, cell.bg, 'bg', data, textures, exportCellPx, dx, dy);
        hasBg = true;
      }
      if (cell.fg) {
        drawCellLayer(fgOccCtx, r, c, cell.fg, 'fg', data, textures, exportCellPx, dx, dy);
        hasFg = true;
      }
    }
  }

  const bgBrightness = clamp(data.settings?.bgBrightness ?? 0.62, 0.1, 1.0);
  if (hasBg && bgBrightness < 1.0) {
    bgCtx.save();
    bgCtx.globalCompositeOperation = 'source-atop';
    bgCtx.fillStyle = `rgba(0, 0, 0, ${1 - bgBrightness})`;
    bgCtx.fillRect(0, 0, w, h);
    bgCtx.restore();
  }

  const shadowStrength = clamp(data.settings?.shadowStrength ?? 0.72, 0, 1);
  const shadowSpread = clamp(data.settings?.shadowSpread ?? 1.0, 0.25, 2.5);
  if (hasBg && hasFg && shadowStrength > 0) {
    const { canvas: fgMaskCanvas, ctx: fgMaskCtx } = makeOffscreen(w, h);
    fgMaskCtx.drawImage(fgOccCanvas, 0, 0);
    fgMaskCtx.globalCompositeOperation = 'source-in';
    fgMaskCtx.fillStyle = '#000000';
    fgMaskCtx.fillRect(0, 0, w, h);

    const { canvas: shadowCanvas, ctx: shadowCtx } = makeOffscreen(w, h);

    shadowCtx.save();
    shadowCtx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, shadowStrength * 0.85)})`;
    shadowCtx.shadowBlur = Math.max(1, exportCellPx * 0.14 * shadowSpread);
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    shadowCtx.save();
    shadowCtx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, shadowStrength * 0.65)})`;
    shadowCtx.shadowBlur = Math.max(1, exportCellPx * 0.34 * shadowSpread);
    shadowCtx.shadowOffsetY = exportCellPx * 0.05 * shadowSpread;
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    shadowCtx.save();
    shadowCtx.globalCompositeOperation = 'destination-out';
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    bgCtx.save();
    bgCtx.globalCompositeOperation = 'source-atop';
    bgCtx.drawImage(shadowCanvas, 0, 0);
    bgCtx.restore();
  }

  return { bgCanvas, fgCanvas: fgOccCanvas, exportCellPx };
}

function mergeColSpans(cols) {
  const sorted = [...new Set(cols)].sort((a, b) => a - b);
  const spans = [];
  for (const c of sorted) {
    const last = spans[spans.length - 1];
    if (last && last.x + last.w === c) last.w += 1;
    else spans.push({ x: c, w: 1 });
  }
  return spans;
}

export async function loadTowerAssets() {
  const [data, stoneBricks, cobblestone] = await Promise.all([
    fetch('assets/tower.json?v=3').then((r) => {
      if (!r.ok) throw new Error(`Failed to load tower.json (${r.status})`);
      return r.json();
    }),
    loadImage('assets/stone_bricks.png?v=3'),
    loadImage('assets/cobblestone.png?v=3')
  ]);
  const textures = { stone_bricks: stoneBricks, cobblestone };
  const baked = buildShadowedBgCanvas(data, textures, 64);
  return { data, textures, ...baked };
}

export class TowerRenderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.detailScale = window.devicePixelRatio || 1;
    this.cssWidth = canvas.clientWidth || 336;
    this.cssHeight = canvas.clientHeight || 576;
    this.lastState = null;
  }

  setResolution(detailScale) {
    this.detailScale = clamp(detailScale || 1, 1, 4);
    this.resize(this.cssWidth, this.cssHeight);
    if (this.lastState) this.render(this.lastState);
  }

  resize(cssWidth, cssHeight) {
    if (cssWidth > 0) this.cssWidth = cssWidth;
    if (cssHeight > 0) this.cssHeight = cssHeight;
    const w = Math.max(1, Math.round(this.cssWidth * this.detailScale));
    const h = Math.max(1, Math.round(this.cssHeight * this.detailScale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(state = {}) {
    this.lastState = state;
    const {
      backdropAlpha = 0,
      bgProgress = 1,
      fgAlpha = 1,
      filledRegions = null,
      gridAlpha = 0,
      cellLabels = [],
      voidBoxes = [],
      filledBoxes = [],
      dropHighlightBox = null,
      solidCuts = [],
      knifeCuts = [],
      focusBoxes = [],
      focusAlpha = 0,
      colSpotlight = null,
      outerBorderAlpha = 0
    } = state;

    const w = this.cssWidth;
    const h = this.cssHeight;
    const cellW = w / TOWER_COLS;
    const cellH = h / TOWER_ROWS;
    const ctx = this.ctx;

    ctx.setTransform(this.detailScale, 0, 0, this.detailScale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    // 1. Clean white 2D grid backdrop
    if (backdropAlpha > 0.002) {
      ctx.fillStyle = `rgba(255, 255, 255, ${clamp(backdropAlpha, 0, 1)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Recessed background blocks + crevice shadows (fades out during pull glide)
    if (bgProgress > 0.002) {
      const { data, bgCanvas, exportCellPx } = this.assets;
      const bp = clamp(bgProgress, 0, 1);
      const inset = (1 - bp) * 0.1 * cellW;
      const driftY = (1 - bp) * 0.12 * cellH;
      ctx.save();
      ctx.globalAlpha = bp;
      for (let r = 0; r < data.rows; r++) {
        for (let c = 0; c < data.cols; c++) {
          if (!data.cells[r]?.[c]?.bg) continue;
          ctx.drawImage(
            bgCanvas,
            c * exportCellPx,
            r * exportCellPx,
            exportCellPx,
            exportCellPx,
            c * cellW + inset,
            r * cellH + inset + driftY,
            Math.max(1, cellW - inset * 2),
            Math.max(1, cellH - inset * 2)
          );
        }
      }
      ctx.restore();
    }

    // 3a. Full foreground layer (Target / Hero Tower)
    if (fgAlpha > 0.002) {
      const { fgCanvas } = this.assets;
      ctx.save();
      ctx.globalAlpha = clamp(fgAlpha, 0, 1);
      ctx.drawImage(fgCanvas, 0, 0, fgCanvas.width, fgCanvas.height, 0, 0, w, h);
      ctx.restore();
    }

    // 3b. Partial region fills (Construction Grid during Step 4)
    if (filledRegions && filledRegions.length > 0) {
      const { fgCanvas, exportCellPx } = this.assets;
      for (const reg of filledRegions) {
        const a = clamp(reg.alpha ?? 1, 0, 1);
        const wp = clamp(reg.wipeProgress ?? 1, 0, 1);
        if (a <= 0.002 || wp <= 0.002) continue;
        const dx = reg.x * cellW;
        const dy = reg.y * cellH;
        const dw = reg.w * cellW;
        const dh = reg.h * cellH;
        ctx.save();
        ctx.globalAlpha = a;
        if (wp < 0.999) {
          ctx.beginPath();
          ctx.rect(dx, dy, dw, dh * wp);
          ctx.clip();
        }
        ctx.drawImage(
          fgCanvas,
          reg.x * exportCellPx,
          reg.y * exportCellPx,
          reg.w * exportCellPx,
          reg.h * exportCellPx,
          dx,
          dy,
          dw,
          dh
        );
        ctx.restore();
      }
    }

    // 4. Unit 7x12 grid lines
    if (gridAlpha > 0.002) {
      ctx.save();
      ctx.strokeStyle = `rgba(203, 213, 225, ${0.72 * clamp(gridAlpha, 0, 1)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < TOWER_COLS; c++) {
        const gx = Math.round(c * cellW) + 0.5;
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
      }
      for (let r = 1; r < TOWER_ROWS; r++) {
        const gy = Math.round(r * cellH) + 0.5;
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5. Subtle in-box height numbers inside empty sub-boxes
    if (cellLabels.length > 0) {
      ctx.save();
      ctx.font = '700 13.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const lbl of cellLabels) {
        const a = clamp(lbl.alpha ?? 1, 0, 1);
        if (a <= 0.01) continue;
        ctx.fillStyle = `rgba(100, 116, 139, ${0.85 * a})`;
        ctx.fillText(lbl.text, (lbl.x + lbl.w / 2) * cellW, (lbl.y + lbl.h / 2) * cellH + 0.5);
      }
      ctx.restore();
    }

    // 6. Drop-target highlight during Step 4 drag-and-drop
    if (dropHighlightBox && (dropHighlightBox.alpha ?? 1) > 0.002) {
      const a = clamp(dropHighlightBox.alpha ?? 1, 0, 1);
      const bx = dropHighlightBox.x * cellW;
      const by = dropHighlightBox.y * cellH;
      const bw = dropHighlightBox.w * cellW;
      const bh = dropHighlightBox.h * cellH;
      ctx.save();
      ctx.fillStyle = `rgba(59, 130, 246, ${0.18 * a})`;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = `rgba(37, 99, 235, ${0.95 * a})`;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx + 1.25, by + 1.25, Math.max(1, bw - 2.5), Math.max(1, bh - 2.5));
      ctx.restore();
    }

    // 7. Void tints & green filled leaf outlines
    for (const vb of voidBoxes) {
      const a = clamp(vb.alpha ?? 1, 0, 1);
      if (a <= 0.002) continue;
      const vx = vb.x * cellW;
      const vy = vb.y * cellH;
      const vw = vb.w * cellW;
      const vh = vb.h * cellH;
      ctx.save();
      ctx.fillStyle = `rgba(2, 132, 199, ${0.1 * a})`;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.restore();
    }

    for (const fb of filledBoxes) {
      const a = clamp(fb.alpha ?? 1, 0, 1);
      if (a <= 0.002) continue;
      const fx = fb.x * cellW;
      const fy = fb.y * cellH;
      const fw = fb.w * cellW;
      const fh = fb.h * cellH;
      ctx.save();
      ctx.strokeStyle = `rgba(34, 197, 94, ${0.92 * a})`;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = `rgba(34, 197, 94, ${0.45 * a})`;
      ctx.shadowBlur = 4 * a;
      ctx.strokeRect(fx + 1.5, fy + 1.5, Math.max(1, fw - 3), Math.max(1, fh - 3));
      ctx.restore();
    }

    // 8a. Executed solid split lines
    for (const cut of solidCuts) {
      const a = clamp(cut.alpha ?? 1, 0, 1);
      if (a <= 0.002) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(30, 41, 59, ${a})`;
      ctx.lineWidth = 2.25;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      if (cut.axis === 'V') {
        const cx = cut.at * cellW;
        ctx.moveTo(cx, cut.from * cellH);
        ctx.lineTo(cx, cut.to * cellH);
      } else {
        const cy = cut.at * cellH;
        ctx.moveTo(cut.from * cellW, cy);
        ctx.lineTo(cut.to * cellW, cy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 8b. Active red-dashed knife sweeps
    for (const knife of knifeCuts) {
      const a = clamp(knife.alpha ?? 1, 0, 1);
      const p = clamp(knife.progress ?? 1, 0, 1);
      if (a <= 0.002 || p <= 0.002) continue;
      const curTo = lerp(knife.from, knife.to, p);
      ctx.save();
      ctx.strokeStyle = `rgba(220, 38, 38, ${a})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      if (knife.axis === 'V') {
        const kx = knife.at * cellW;
        ctx.moveTo(kx, knife.from * cellH);
        ctx.lineTo(kx, curTo * cellH);
      } else {
        const ky = knife.at * cellH;
        ctx.moveTo(knife.from * cellW, ky);
        ctx.lineTo(curTo * cellW, ky);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 9. Reference-tower column spotlight (soft wash outside active columns, zero cuts)
    if (colSpotlight && colSpotlight.cols?.length && (colSpotlight.dimAlpha ?? 0) > 0.002) {
      const activeSet = new Set(colSpotlight.cols);
      const da = clamp(colSpotlight.dimAlpha, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.72 * da})`;
      for (let c = 0; c < TOWER_COLS; c++) {
        if (!activeSet.has(c)) {
          ctx.fillRect(c * cellW, 0, cellW, h);
        }
      }
      const oa = clamp(colSpotlight.outlineAlpha ?? da, 0, 1);
      if (oa > 0.002) {
        ctx.strokeStyle = `rgba(59, 130, 246, ${0.7 * oa})`;
        ctx.lineWidth = 2;
        for (const span of mergeColSpans(colSpotlight.cols)) {
          ctx.strokeRect(span.x * cellW + 1, 1, span.w * cellW - 2, h - 2);
        }
      }
      ctx.restore();
    }

    // 10. Scope focus scrim + cyan bloom border (Step 4 hover & focus)
    if (focusAlpha > 0.002 && focusBoxes.length > 0) {
      const fa = clamp(focusAlpha, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(15, 23, 42, ${0.56 * fa})`;
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      for (const b of focusBoxes) {
        ctx.rect(b.x * cellW, b.y * cellH, b.w * cellW, b.h * cellH);
      }
      ctx.fill('evenodd');
      ctx.restore();

      for (const b of focusBoxes) {
        const bx = b.x * cellW;
        const by = b.y * cellH;
        const bw = b.w * cellW;
        const bh = b.h * cellH;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 255, 255, ${0.14 * fa})`;
        ctx.fillRect(bx, by, bw, bh);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.95 * fa})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = `rgba(56, 189, 248, ${0.85 * fa})`;
        ctx.shadowBlur = 10 * fa;
        ctx.strokeRect(bx + 1.5, by + 1.5, Math.max(1, bw - 3), Math.max(1, bh - 3));

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * fa})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.strokeRect(bx + 3, by + 3, Math.max(1, bw - 6), Math.max(1, bh - 6));
        ctx.restore();
      }
    }

    // 11. Outer 7x12 root boundary
    if (outerBorderAlpha > 0.002) {
      ctx.save();
      ctx.strokeStyle = `rgba(15, 23, 42, ${clamp(outerBorderAlpha, 0, 1)})`;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(1.25, 1.25, w - 2.5, h - 2.5);
      ctx.restore();
    }
  }
}
