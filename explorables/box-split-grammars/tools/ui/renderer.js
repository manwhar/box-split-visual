/**
 * renderer.js
 * Shared pixel-accurate 2D Minecraft mockup renderer used for both
 * the interactive editor canvas and the transparent PNG export.
 */

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function getCell(state, r, c) {
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return null;
  return state.cells[r]?.[c] || null;
}

function getEntryTexId(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.texture;
}

function isWallConnectable(entry, textureMap) {
  const texId = getEntryTexId(entry);
  if (!texId) return false;
  const meta = textureMap.get(texId)?.meta;
  if (!meta) return false;
  return meta.kind === 'block' || meta.kind === 'wall';
}

function hasAnyEntry(cell, layerKey) {
  if (!cell) return false;
  if (layerKey === 'fg') return Boolean(cell.fg || cell.fgDecor);
  return Boolean(cell.bg || cell.bgDecor);
}

function resolveWallSourceImage(texId, textureMap, fallbackImage) {
  if (texId === 'cobblestone_wall') {
    return textureMap.get('cobblestone')?.image || fallbackImage;
  }
  if (texId.endsWith('_wall')) {
    const baseId = texId.slice(0, -5);
    return (
      textureMap.get(baseId)?.image ||
      textureMap.get(`${baseId}s`)?.image ||
      fallbackImage
    );
  }
  return fallbackImage;
}

function drawWallTile(ctx, entry, r, c, layerKey, state, textureMap, cellPx, dx, dy, fallbackImg) {
  const texId = getEntryTexId(entry);
  const srcImg = resolveWallSourceImage(texId, textureMap, fallbackImg);

  const leftCell = getCell(state, r, c - 1);
  const rightCell = getCell(state, r, c + 1);
  const aboveCell = getCell(state, r - 1, c);

  const connectLeft = isWallConnectable(leftCell?.[layerKey], textureMap);
  const connectRight = isWallConnectable(rightCell?.[layerKey], textureMap);
  const hasAbove = hasAnyEntry(aboveCell, layerKey) || (layerKey === 'fg' && Boolean(aboveCell?.fgDecor));
  const hasSolidAbove = isWallConnectable(aboveCell?.[layerKey], textureMap);

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
    // Continuous flat wall segment (14 texels tall, like connected Minecraft walls)
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

  // Center 8x16 pillar post
  ctx.drawImage(
    srcImg,
    4 * srcScaleX,
    0,
    8 * srcScaleX,
    16 * srcScaleY,
    x1,
    dy,
    x2 - x1,
    cellPx
  );

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

function drawWallTorch(ctx, img, variant, cellPx, dx, dy) {
  const u = cellPx / 16;
  const angleRad = (variant === 'wall-left' ? 22.5 : -22.5) * (Math.PI / 180);
  const pivotX = variant === 'wall-left' ? dx + 1.5 * u : dx + 14.5 * u;
  const pivotY = dy + 12.5 * u;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angleRad);
  ctx.drawImage(img, 0, 0, img.width, img.height, -8 * u, -16 * u, cellPx, cellPx);
  ctx.restore();
}

export function drawTile(ctx, entry, r, c, layerKey, state, textureMap, cellPx, offsetR = 0, offsetC = 0) {
  const texId = getEntryTexId(entry);
  if (!texId) return;
  const texRec = textureMap.get(texId);
  if (!texRec || !texRec.image) return;

  const { meta, image } = texRec;
  const dx = (c - offsetC) * cellPx;
  const dy = (r - offsetR) * cellPx;
  ctx.imageSmoothingEnabled = false;

  // 1. Auto-connecting cobblestone wall
  if (meta.kind === 'wall' && state.settings?.autoConnectWalls !== false) {
    drawWallTile(ctx, entry, r, c, layerKey, state, textureMap, cellPx, dx, dy, image);
    return;
  }

  // 2. Wall-mounted torch orientation
  const variant = typeof entry === 'object' ? entry.variant : null;
  if (meta.kind === 'decor' && (variant === 'wall-left' || variant === 'wall-right')) {
    drawWallTorch(ctx, image, variant, cellPx, dx, dy);
    return;
  }

  const flipX = typeof entry === 'object' ? Boolean(entry.flipX) : false;

  // 3. Multi-cell texture slice (e.g. 16x32 oak_door)
  if ((meta.spanCols || 1) > 1 || (meta.spanRows || 1) > 1) {
    const spanCols = Math.max(1, meta.spanCols || 1);
    const spanRows = Math.max(1, meta.spanRows || 1);
    const partCol = clamp(typeof entry === 'object' ? (entry.partCol || 0) : 0, 0, spanCols - 1);
    const partRow = clamp(typeof entry === 'object' ? (entry.partRow || 0) : 0, 0, spanRows - 1);
    const tileW = image.width / spanCols;
    const tileH = image.height / spanRows;
    const sx = partCol * tileW;
    const sy = partRow * tileH;

    if (flipX) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(dx + cellPx, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(image, sx, sy, tileW, tileH, 0, 0, cellPx, cellPx);
      ctx.restore();
    } else {
      ctx.drawImage(image, sx, sy, tileW, tileH, dx, dy, cellPx, cellPx);
    }
    return;
  }

  // 4. Sub-block texture (<16px) preserves native 1:16 texel scale
  if (image.width < 16 || image.height < 16) {
    const u = cellPx / 16;
    const dw = image.width * u;
    const dh = image.height * u;
    const ox = dx + (cellPx - dw) / 2;
    const oy = dy + (cellPx - dh);
    if (flipX) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(dx + cellPx, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0, image.width, image.height, (cellPx - dw) / 2, cellPx - dh, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(image, 0, 0, image.width, image.height, ox, oy, dw, dh);
    }
    return;
  }

  // 5. Standard 1x1 block (16x16, 32x32, etc.)
  if (flipX) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(dx + cellPx, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, cellPx, cellPx);
    ctx.restore();
  } else {
    ctx.drawImage(image, 0, 0, image.width, image.height, dx, dy, cellPx, cellPx);
  }
}

export function computeRenderBounds(state, trimEmpty = false) {
  if (!trimEmpty) {
    return { minR: 0, maxR: state.rows - 1, minC: 0, maxC: state.cols - 1 };
  }
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.cells[r]?.[c];
      if (!cell) continue;
      if (cell.fg || cell.bg || cell.fgDecor || cell.bgDecor) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }

  if (minR === Infinity) {
    return { minR: 0, maxR: state.rows - 1, minC: 0, maxC: state.cols - 1 };
  }
  return { minR, maxR, minC, maxC };
}

function drawBackdrop(ctx, width, height, cellPx, backdrop) {
  if (backdrop === 'transparent') return;
  if (backdrop === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (backdrop === 'slate') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const isDark = backdrop === 'checker-dark';
  const c1 = isDark ? '#1e293b' : '#f8fafc';
  const c2 = isDark ? '#0f172a' : '#e2e8f0';
  const check = Math.max(8, Math.round(cellPx / 4));

  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = c2;
  for (let y = 0; y < height; y += check) {
    const rowIdx = Math.floor(y / check);
    for (let x = 0; x < width; x += check) {
      const colIdx = Math.floor(x / check);
      if ((rowIdx + colIdx) % 2 === 1) {
        ctx.fillRect(x, y, Math.min(check, width - x), Math.min(check, height - y));
      }
    }
  }
}

function drawGridLines(ctx, width, height, spanRows, spanCols, cellPx, backdrop) {
  const isDark = backdrop === 'checker-dark' || backdrop === 'slate';
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.16)';
  ctx.beginPath();
  for (let c = 0; c <= spanCols; c++) {
    const x = Math.min(width - 0.5, Math.max(0.5, Math.round(c * cellPx) + 0.5));
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let r = 0; r <= spanRows; r++) {
    const y = Math.min(height - 0.5, Math.max(0.5, Math.round(r * cellPx) + 0.5));
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHoverOverlay(ctx, hoverPreview, state, textureMap, cellPx, minR, minC) {
  if (!hoverPreview || !hoverPreview.cells?.length) return;
  const { cells, tool, mode } = hoverPreview;

  let strokeColor = '#2563eb';
  let fillTint = 'rgba(37, 99, 235, 0.14)';
  if (tool === 'erase') {
    strokeColor = '#dc2626';
    fillTint = 'rgba(220, 38, 38, 0.16)';
  } else if (tool === 'eyedropper') {
    strokeColor = '#0284c7';
    fillTint = 'rgba(2, 132, 199, 0.14)';
  } else if (mode === 'fg') {
    strokeColor = '#10b981';
    fillTint = 'rgba(16, 185, 129, 0.10)';
  } else if (mode === 'bg') {
    strokeColor = '#f59e0b';
    fillTint = 'rgba(245, 158, 11, 0.12)';
  }

  for (const item of cells) {
    const dx = (item.c - minC) * cellPx;
    const dy = (item.r - minR) * cellPx;

    if (item.entry && tool !== 'erase' && tool !== 'eyedropper') {
      ctx.save();
      ctx.globalAlpha = mode === 'bg' ? 0.52 : 0.65;
      drawTile(ctx, item.entry, item.r, item.c, mode, state, textureMap, cellPx, minR, minC);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = fillTint;
    ctx.fillRect(dx, dy, cellPx, cellPx);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 1, dy + 1, Math.max(1, cellPx - 2), Math.max(1, cellPx - 2));
    ctx.restore();
  }
}

export function renderMockup(targetCanvas, state, textureMap, options = {}) {
  const cellPx = options.cellPx ?? 48;
  const showGrid = options.showGrid ?? true;
  const backdrop = options.backdrop ?? 'checker-light';
  const hoverPreview = options.hoverPreview ?? null;
  const trimEmpty = options.trimEmpty ?? false;

  const bounds = computeRenderBounds(state, trimEmpty);
  const spanCols = bounds.maxC - bounds.minC + 1;
  const spanRows = bounds.maxR - bounds.minR + 1;
  const width = spanCols * cellPx;
  const height = spanRows * cellPx;

  if (targetCanvas.width !== width) targetCanvas.width = width;
  if (targetCanvas.height !== height) targetCanvas.height = height;

  const targetCtx = targetCanvas.getContext('2d');
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.clearRect(0, 0, width, height);

  const { canvas: bgCanvas, ctx: bgCtx } = makeCanvas(width, height);
  const { canvas: fgOccCanvas, ctx: fgOccCtx } = makeCanvas(width, height);
  const { canvas: fgLightCanvas, ctx: fgLightCtx } = makeCanvas(width, height);

  let hasFgOccluders = false;
  let hasBgPixels = false;

  for (let r = bounds.minR; r <= bounds.maxR; r++) {
    for (let c = bounds.minC; c <= bounds.maxC; c++) {
      const cell = getCell(state, r, c);
      if (!cell) continue;

      if (cell.bg) {
        drawTile(bgCtx, cell.bg, r, c, 'bg', state, textureMap, cellPx, bounds.minR, bounds.minC);
        hasBgPixels = true;
      }
      if (cell.bgDecor) {
        drawTile(bgCtx, cell.bgDecor, r, c, 'bg', state, textureMap, cellPx, bounds.minR, bounds.minC);
        hasBgPixels = true;
      }

      if (cell.fg) {
        const texId = getEntryTexId(cell.fg);
        const castsShadow = textureMap.get(texId)?.meta?.castsShadow !== false;
        if (castsShadow) {
          drawTile(fgOccCtx, cell.fg, r, c, 'fg', state, textureMap, cellPx, bounds.minR, bounds.minC);
          hasFgOccluders = true;
        } else {
          drawTile(fgLightCtx, cell.fg, r, c, 'fg', state, textureMap, cellPx, bounds.minR, bounds.minC);
        }
      }

      if (cell.fgDecor) {
        drawTile(fgLightCtx, cell.fgDecor, r, c, 'fg', state, textureMap, cellPx, bounds.minR, bounds.minC);
      }
    }
  }

  // Dim background layer for clear depth separation
  const bgBrightness = clamp(state.settings?.bgBrightness ?? 0.62, 0.1, 1.0);
  if (hasBgPixels && bgBrightness < 1.0) {
    bgCtx.save();
    bgCtx.globalCompositeOperation = 'source-atop';
    bgCtx.fillStyle = `rgba(0, 0, 0, ${1 - bgBrightness})`;
    bgCtx.fillRect(0, 0, width, height);
    bgCtx.restore();
  }

  // Cast crisp border + ambient recess shadows from FG occluders onto BG pixels
  const shadowStrength = clamp(state.settings?.shadowStrength ?? 0.72, 0, 1);
  const shadowSpread = clamp(state.settings?.shadowSpread ?? 1.0, 0.25, 2.5);
  if (hasBgPixels && hasFgOccluders && shadowStrength > 0) {
    const { canvas: fgMaskCanvas, ctx: fgMaskCtx } = makeCanvas(width, height);
    fgMaskCtx.drawImage(fgOccCanvas, 0, 0);
    fgMaskCtx.globalCompositeOperation = 'source-in';
    fgMaskCtx.fillStyle = '#000000';
    fgMaskCtx.fillRect(0, 0, width, height);

    const { canvas: shadowCanvas, ctx: shadowCtx } = makeCanvas(width, height);

    // Pass A: tight crevice AO along every FG/BG edge and corner
    shadowCtx.save();
    shadowCtx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, shadowStrength * 0.85)})`;
    shadowCtx.shadowBlur = Math.max(1, cellPx * 0.14 * shadowSpread);
    shadowCtx.shadowOffsetX = 0;
    shadowCtx.shadowOffsetY = 0;
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    // Pass B: softer recessed drop shadow with slight downward depth bias
    shadowCtx.save();
    shadowCtx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, shadowStrength * 0.65)})`;
    shadowCtx.shadowBlur = Math.max(1, cellPx * 0.34 * shadowSpread);
    shadowCtx.shadowOffsetX = 0;
    shadowCtx.shadowOffsetY = cellPx * 0.05 * shadowSpread;
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    // Remove interior silhouette so shadow only remains outside FG occluder pixels
    shadowCtx.save();
    shadowCtx.shadowColor = 'transparent';
    shadowCtx.shadowBlur = 0;
    shadowCtx.shadowOffsetX = 0;
    shadowCtx.shadowOffsetY = 0;
    shadowCtx.globalCompositeOperation = 'destination-out';
    shadowCtx.drawImage(fgMaskCanvas, 0, 0);
    shadowCtx.restore();

    // Restrict shadows strictly to existing background pixels
    bgCtx.save();
    bgCtx.globalCompositeOperation = 'source-atop';
    bgCtx.drawImage(shadowCanvas, 0, 0);
    bgCtx.restore();
  }

  // Final composite
  drawBackdrop(targetCtx, width, height, cellPx, backdrop);
  targetCtx.drawImage(bgCanvas, 0, 0);
  targetCtx.drawImage(fgOccCanvas, 0, 0);
  targetCtx.drawImage(fgLightCanvas, 0, 0);

  if (showGrid) {
    drawGridLines(targetCtx, width, height, spanRows, spanCols, cellPx, backdrop);
  }
  if (hoverPreview) {
    drawHoverOverlay(targetCtx, hoverPreview, state, textureMap, cellPx, bounds.minR, bounds.minC);
  }

  return { width, height, ...bounds };
}
