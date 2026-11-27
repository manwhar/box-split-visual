import { computeRenderBounds, renderMockup } from './renderer.js';

const DEFAULT_SETTINGS = {
  bgBrightness: 0.62,
  shadowStrength: 0.72,
  shadowSpread: 1.0,
  autoConnectWalls: true,
  exportScale: 64,
  trimEmpty: false,
};

const MAX_UNDO = 60;

function makeEmptyCell() {
  return { fg: null, bg: null, fgDecor: null, bgDecor: null };
}

function cloneEntry(entry) {
  return entry ? { ...entry } : null;
}

function cloneCells(cells) {
  return cells.map((row) =>
    row.map((cell) => ({
      fg: cloneEntry(cell.fg),
      bg: cloneEntry(cell.bg),
      fgDecor: cloneEntry(cell.fgDecor),
      bgDecor: cloneEntry(cell.bgDecor),
    }))
  );
}

function makeEmptyGrid(rows, cols) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => makeEmptyCell())
  );
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function entrySignature(entry) {
  if (!entry) return 'null';
  return `${entry.texture}:${entry.partCol || 0}:${entry.partRow || 0}:${entry.flipX ? 1 : 0}:${entry.variant || ''}`;
}

function bresenhamLine(r0, c0, r1, c1) {
  const pts = [];
  let dr = Math.abs(r1 - r0);
  let dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1;
  const sc = c0 < c1 ? 1 : -1;
  let err = dc - dr;
  let r = r0;
  let c = c0;

  while (true) {
    pts.push([r, c]);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dr) {
      err -= dr;
      c += sc;
    }
    if (e2 < dc) {
      err += dc;
      r += sr;
    }
  }
  return pts;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = `${url}?t=${Date.now()}`;
  });
}

class MockupStudioApp {
  constructor() {
    this.textureMap = new Map();
    this.textures = [];

    this.state = {
      cols: 12,
      rows: 10,
      cells: makeEmptyGrid(10, 12),
      settings: { ...DEFAULT_SETTINGS },
    };

    this.ui = {
      mode: 'fg',
      tool: 'paint',
      selectedTexture: null,
      flipX: false,
      torchVariant: 'upright',
      cellPx: 48,
      showGrid: true,
      backdrop: 'checker-light',
      hoverCell: null,
    };

    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
    this.toastTimer = null;

    this.els = {
      gridCols: document.getElementById('grid-cols'),
      gridRows: document.getElementById('grid-rows'),
      resizeAnchor: document.getElementById('resize-anchor'),
      btnApplySize: document.getElementById('btn-apply-size'),
      btnUndo: document.getElementById('btn-undo'),
      btnRedo: document.getElementById('btn-redo'),
      btnClear: document.getElementById('btn-clear'),
      btnOpenLoad: document.getElementById('btn-open-load'),
      btnLoadFile: document.getElementById('btn-load-file'),
      fileImportInput: document.getElementById('file-import-input'),
      exportName: document.getElementById('export-name'),
      btnExport: document.getElementById('btn-export'),

      modeFg: document.getElementById('mode-fg'),
      modeBg: document.getElementById('mode-bg'),
      modeHelp: document.getElementById('mode-help'),
      toolBtns: Array.from(document.querySelectorAll('.tool-btn')),
      btnFlipX: document.getElementById('btn-flip-x'),
      torchOrientationGroup: document.getElementById('torch-orientation-group'),
      torchVariantBtns: Array.from(document.querySelectorAll('#torch-orientation-group .seg-btn')),
      btnRefreshTextures: document.getElementById('btn-refresh-textures'),
      textureGrid: document.getElementById('texture-grid'),

      btnZoomOut: document.getElementById('btn-zoom-out'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomFit: document.getElementById('btn-zoom-fit'),
      zoomLabel: document.getElementById('zoom-label'),
      btnToggleGrid: document.getElementById('btn-toggle-grid'),
      backdropSelect: document.getElementById('backdrop-select'),
      cursorStatus: document.getElementById('cursor-status'),
      canvasViewport: document.getElementById('canvas-viewport'),
      editorCanvas: document.getElementById('editor-canvas'),

      previewCanvas: document.getElementById('preview-canvas'),
      exportDimsLabel: document.getElementById('export-dims-label'),
      bgBrightness: document.getElementById('setting-bg-brightness'),
      valBgBrightness: document.getElementById('val-bg-brightness'),
      shadowStrength: document.getElementById('setting-shadow-strength'),
      valShadowStrength: document.getElementById('val-shadow-strength'),
      shadowSpread: document.getElementById('setting-shadow-spread'),
      valShadowSpread: document.getElementById('val-shadow-spread'),
      autoWalls: document.getElementById('setting-auto-walls'),
      exportScale: document.getElementById('setting-export-scale'),
      trimEmpty: document.getElementById('setting-trim-empty'),

      loadModal: document.getElementById('load-modal'),
      btnCloseLoad: document.getElementById('btn-close-load'),
      projectsList: document.getElementById('projects-list'),
      toast: document.getElementById('toast'),
    };
  }

  async init() {
    this.bindEvents();
    await this.loadTextures();
    this.syncControlsFromState();
    this.fitZoom();
    this.renderAll();
  }

  bindEvents() {
    // Grid resize
    this.els.btnApplySize.addEventListener('click', () => this.applyGridResize());
    for (const input of [this.els.gridCols, this.els.gridRows]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.applyGridResize();
        }
      });
    }

    // History & Clear
    this.els.btnUndo.addEventListener('click', () => this.undo());
    this.els.btnRedo.addEventListener('click', () => this.redo());
    this.els.btnClear.addEventListener('click', () => this.clearGrid());

    // Load / Export
    this.els.btnOpenLoad.addEventListener('click', () => this.openLoadModal());
    this.els.btnCloseLoad.addEventListener('click', () => this.closeLoadModal());
    this.els.loadModal.addEventListener('click', (e) => {
      if (e.target === this.els.loadModal) this.closeLoadModal();
    });
    this.els.btnLoadFile.addEventListener('click', () => this.els.fileImportInput.click());
    this.els.fileImportInput.addEventListener('change', (e) => this.handleLocalFileImport(e));
    this.els.btnExport.addEventListener('click', () => this.exportMockup());
    this.els.exportName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.exportMockup();
      }
    });

    // Layer Mode
    this.els.modeFg.addEventListener('click', () => this.setMode('fg'));
    this.els.modeBg.addEventListener('click', () => this.setMode('bg'));

    // Tools
    for (const btn of this.els.toolBtns) {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    }

    this.els.btnFlipX.addEventListener('click', () => {
      this.ui.flipX = !this.ui.flipX;
      this.els.btnFlipX.classList.toggle('active', this.ui.flipX);
      this.renderEditor();
    });

    for (const btn of this.els.torchVariantBtns) {
      btn.addEventListener('click', () => {
        this.ui.torchVariant = btn.dataset.variant;
        this.updateTorchVariantButtons();
        this.renderEditor();
      });
    }

    this.els.btnRefreshTextures.addEventListener('click', async () => {
      await this.loadTextures();
      this.renderAll();
      this.showToast('Textures refreshed from demo/assets/', 'success');
    });

    // Zoom & Viewport
    this.els.btnZoomOut.addEventListener('click', () => this.adjustZoom(-8));
    this.els.btnZoomIn.addEventListener('click', () => this.adjustZoom(8));
    this.els.btnZoomFit.addEventListener('click', () => {
      this.fitZoom();
      this.renderEditor();
    });
    this.els.btnToggleGrid.addEventListener('click', () => {
      this.ui.showGrid = !this.ui.showGrid;
      this.els.btnToggleGrid.classList.toggle('is-active', this.ui.showGrid);
      this.renderEditor();
    });
    this.els.backdropSelect.addEventListener('change', () => {
      this.ui.backdrop = this.els.backdropSelect.value;
      this.renderEditor();
    });

    this.els.canvasViewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.adjustZoom(e.deltaY < 0 ? 6 : -6);
    }, { passive: false });

    // Settings Sliders
    this.els.bgBrightness.addEventListener('input', () => {
      this.state.settings.bgBrightness = Number(this.els.bgBrightness.value) / 100;
      this.els.valBgBrightness.textContent = `${this.els.bgBrightness.value}%`;
      this.renderAll();
    });
    this.els.shadowStrength.addEventListener('input', () => {
      this.state.settings.shadowStrength = Number(this.els.shadowStrength.value) / 100;
      this.els.valShadowStrength.textContent = `${this.els.shadowStrength.value}%`;
      this.renderAll();
    });
    this.els.shadowSpread.addEventListener('input', () => {
      this.state.settings.shadowSpread = Number(this.els.shadowSpread.value) / 100;
      this.els.valShadowSpread.textContent = `${this.els.shadowSpread.value}%`;
      this.renderAll();
    });
    this.els.autoWalls.addEventListener('change', () => {
      this.state.settings.autoConnectWalls = this.els.autoWalls.checked;
      this.renderAll();
    });
    this.els.exportScale.addEventListener('change', () => {
      this.state.settings.exportScale = Number(this.els.exportScale.value);
      this.updateExportDimsLabel();
    });
    this.els.trimEmpty.addEventListener('change', () => {
      this.state.settings.trimEmpty = this.els.trimEmpty.checked;
      this.renderPreview();
      this.updateExportDimsLabel();
    });

    // Canvas Pointer Painting
    const canvas = this.els.editorCanvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.stroke) {
        this.ui.hoverCell = null;
        this.els.cursorStatus.textContent = 'Ready';
        this.renderEditor();
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  async loadTextures() {
    const res = await fetch('/api/textures');
    if (!res.ok) throw new Error('Failed to fetch /api/textures');
    const data = await res.json();
    const list = data.textures || [];

    const nextMap = new Map();
    await Promise.all(
      list.map(async (meta) => {
        try {
          const image = await loadImage(meta.url);
          nextMap.set(meta.id, { meta, image });
        } catch (err) {
          console.warn(err);
        }
      })
    );

    this.textures = list.filter((t) => nextMap.has(t.id));
    this.textureMap = nextMap;

    if (!this.ui.selectedTexture || !this.textureMap.has(this.ui.selectedTexture)) {
      const preferred = this.textures.find((t) => t.id === 'stone_bricks') || this.textures[0];
      this.ui.selectedTexture = preferred ? preferred.id : null;
    }

    this.renderTexturePalette();
    this.updateContextualControls();
  }

  renderTexturePalette() {
    const container = this.els.textureGrid;
    container.innerHTML = '';

    for (const tex of this.textures) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'texture-card';
      if (tex.id === this.ui.selectedTexture) btn.classList.add('active');
      btn.dataset.textureId = tex.id;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(tex.id === this.ui.selectedTexture));
      btn.title = `${tex.label} (${tex.width}×${tex.height}px)`;

      if (tex.spanRows > 1 || tex.spanCols > 1) {
        const badge = document.createElement('span');
        badge.className = 'texture-badge';
        badge.textContent = `${tex.spanCols}×${tex.spanRows}`;
        btn.appendChild(badge);
      } else if (tex.kind === 'wall') {
        const badge = document.createElement('span');
        badge.className = 'texture-badge';
        badge.textContent = 'Wall';
        btn.appendChild(badge);
      } else if (tex.kind === 'decor') {
        const badge = document.createElement('span');
        badge.className = 'texture-badge';
        badge.textContent = 'Decor';
        btn.appendChild(badge);
      }

      const thumbBox = document.createElement('div');
      thumbBox.className = 'texture-thumb-box';
      const img = document.createElement('img');
      img.src = tex.url;
      img.alt = tex.label;
      thumbBox.appendChild(img);

      const label = document.createElement('span');
      label.className = 'texture-name';
      label.textContent = tex.label;

      btn.appendChild(thumbBox);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        this.selectTexture(tex.id);
      });

      container.appendChild(btn);
    }
  }

  selectTexture(texId) {
    if (!this.textureMap.has(texId)) return;
    this.ui.selectedTexture = texId;
    if (this.ui.tool === 'erase' || this.ui.tool === 'eyedropper') {
      this.setTool('paint');
    }
    this.renderTexturePalette();
    this.updateContextualControls();
    this.renderEditor();
  }

  updateContextualControls() {
    const meta = this.textureMap.get(this.ui.selectedTexture)?.meta;
    const isDecor = Boolean(meta && meta.kind === 'decor');
    this.els.torchOrientationGroup.hidden = !isDecor;
    this.updateTorchVariantButtons();
  }

  updateTorchVariantButtons() {
    for (const btn of this.els.torchVariantBtns) {
      btn.classList.toggle('active', btn.dataset.variant === this.ui.torchVariant);
    }
  }

  setMode(mode) {
    this.ui.mode = mode === 'bg' ? 'bg' : 'fg';
    this.els.modeFg.classList.toggle('active', this.ui.mode === 'fg');
    this.els.modeBg.classList.toggle('active', this.ui.mode === 'bg');
    this.els.modeHelp.textContent =
      this.ui.mode === 'fg'
        ? 'Normal brightness blocks that cast shadows onto nearby background blocks.'
        : 'Lower brightness recessed blocks that receive shadows along foreground borders.';
    this.renderEditor();
  }

  setTool(tool) {
    this.ui.tool = tool;
    for (const btn of this.els.toolBtns) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    }
    this.renderEditor();
  }

  adjustZoom(delta) {
    this.ui.cellPx = clamp(this.ui.cellPx + delta, 16, 96);
    this.els.zoomLabel.textContent = `${this.ui.cellPx} px`;
    this.renderEditor();
  }

  fitZoom() {
    const vp = this.els.canvasViewport;
    const availW = Math.max(240, vp.clientWidth - 64);
    const availH = Math.max(240, vp.clientHeight - 64);
    const fit = Math.floor(Math.min(availW / this.state.cols, availH / this.state.rows));
    const snapped = Math.max(16, Math.min(80, Math.floor(fit / 4) * 4));
    this.ui.cellPx = snapped;
    this.els.zoomLabel.textContent = `${this.ui.cellPx} px`;
  }

  pushUndoSnapshot(snapshot = null) {
    const snap = snapshot || {
      cols: this.state.cols,
      rows: this.state.rows,
      cells: cloneCells(this.state.cells),
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push({
      cols: this.state.cols,
      rows: this.state.rows,
      cells: cloneCells(this.state.cells),
    });
    const prev = this.undoStack.pop();
    this.state.cols = prev.cols;
    this.state.rows = prev.rows;
    this.state.cells = cloneCells(prev.cells);
    this.syncControlsFromState();
    this.updateHistoryButtons();
    this.renderAll();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push({
      cols: this.state.cols,
      rows: this.state.rows,
      cells: cloneCells(this.state.cells),
    });
    const next = this.redoStack.pop();
    this.state.cols = next.cols;
    this.state.rows = next.rows;
    this.state.cells = cloneCells(next.cells);
    this.syncControlsFromState();
    this.updateHistoryButtons();
    this.renderAll();
  }

  updateHistoryButtons() {
    this.els.btnUndo.disabled = this.undoStack.length === 0;
    this.els.btnRedo.disabled = this.redoStack.length === 0;
  }

  applyGridResize() {
    const newCols = clamp(parseInt(this.els.gridCols.value, 10) || this.state.cols, 1, 64);
    const newRows = clamp(parseInt(this.els.gridRows.value, 10) || this.state.rows, 1, 64);
    this.els.gridCols.value = String(newCols);
    this.els.gridRows.value = String(newRows);

    if (newCols === this.state.cols && newRows === this.state.rows) return;

    this.pushUndoSnapshot();

    const anchor = this.els.resizeAnchor.value;
    const oldCols = this.state.cols;
    const oldRows = this.state.rows;

    let offsetC = 0;
    let offsetR = 0;
    if (anchor === 'bottom-left') {
      offsetR = newRows - oldRows;
    } else if (anchor === 'center') {
      offsetC = Math.floor((newCols - oldCols) / 2);
      offsetR = Math.floor((newRows - oldRows) / 2);
    }

    const nextCells = makeEmptyGrid(newRows, newCols);
    for (let r = 0; r < oldRows; r++) {
      for (let c = 0; c < oldCols; c++) {
        const nr = r + offsetR;
        const nc = c + offsetC;
        if (nr >= 0 && nr < newRows && nc >= 0 && nc < newCols) {
          nextCells[nr][nc] = {
            fg: cloneEntry(this.state.cells[r][c].fg),
            bg: cloneEntry(this.state.cells[r][c].bg),
            fgDecor: cloneEntry(this.state.cells[r][c].fgDecor),
            bgDecor: cloneEntry(this.state.cells[r][c].bgDecor),
          };
        }
      }
    }

    this.state.cols = newCols;
    this.state.rows = newRows;
    this.state.cells = nextCells;
    this.fitZoom();
    this.renderAll();
    this.showToast(`Grid resized to ${newCols} × ${newRows}`, 'success');
  }

  clearGrid() {
    const hasContent = this.state.cells.some((row) =>
      row.some((cell) => cell.fg || cell.bg || cell.fgDecor || cell.bgDecor)
    );
    if (!hasContent) return;
    this.pushUndoSnapshot();
    this.state.cells = makeEmptyGrid(this.state.rows, this.state.cols);
    this.renderAll();
  }

  syncControlsFromState() {
    this.els.gridCols.value = String(this.state.cols);
    this.els.gridRows.value = String(this.state.rows);

    const bgPct = Math.round(this.state.settings.bgBrightness * 100);
    this.els.bgBrightness.value = String(bgPct);
    this.els.valBgBrightness.textContent = `${bgPct}%`;

    const shPct = Math.round(this.state.settings.shadowStrength * 100);
    this.els.shadowStrength.value = String(shPct);
    this.els.valShadowStrength.textContent = `${shPct}%`;

    const spPct = Math.round(this.state.settings.shadowSpread * 100);
    this.els.shadowSpread.value = String(spPct);
    this.els.valShadowSpread.textContent = `${spPct}%`;

    this.els.autoWalls.checked = Boolean(this.state.settings.autoConnectWalls);
    this.els.exportScale.value = String(this.state.settings.exportScale);
    this.els.trimEmpty.checked = Boolean(this.state.settings.trimEmpty);
    this.updateHistoryButtons();
    this.updateExportDimsLabel();
  }

  getCellFromPointer(e) {
    const rect = this.els.editorCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor((x / rect.width) * this.state.cols);
    const r = Math.floor((y / rect.height) * this.state.rows);
    if (r < 0 || r >= this.state.rows || c < 0 || c >= this.state.cols) {
      return null;
    }
    return { r, c };
  }

  clearMultiBlockAt(r, c, layerKey) {
    const cell = this.state.cells[r]?.[c];
    const entry = cell?.[layerKey];
    if (!entry) return false;
    const meta = this.textureMap.get(entry.texture)?.meta;
    if (!meta || ((meta.spanCols || 1) <= 1 && (meta.spanRows || 1) <= 1)) {
      return false;
    }
    const spanCols = meta.spanCols || 1;
    const spanRows = meta.spanRows || 1;
    const originR = r - (entry.partRow || 0);
    const originC = c - (entry.partCol || 0);
    let changed = false;

    for (let dr = 0; dr < spanRows; dr++) {
      for (let dc = 0; dc < spanCols; dc++) {
        const nr = originR + dr;
        const nc = originC + dc;
        if (nr < 0 || nr >= this.state.rows || nc < 0 || nc >= this.state.cols) continue;
        const target = this.state.cells[nr][nc][layerKey];
        if (
          target &&
          target.texture === entry.texture &&
          (target.partRow || 0) === dr &&
          (target.partCol || 0) === dc
        ) {
          this.state.cells[nr][nc][layerKey] = null;
          changed = true;
        }
      }
    }
    return changed;
  }

  computeMultiPlacement(r, c, meta) {
    const spanCols = meta.spanCols || 1;
    const spanRows = meta.spanRows || 1;

    // Anchor multi-height blocks (like 1x2 oak_door) by bottom cell unless clicked at row 0.
    let botR = r;
    if (spanRows > 1 && r === 0 && this.state.rows > 1) {
      botR = Math.min(this.state.rows - 1, spanRows - 1);
    }
    const startR = botR - (spanRows - 1);
    const startC = Math.min(c, Math.max(0, this.state.cols - spanCols));

    const parts = [];
    for (let dr = 0; dr < spanRows; dr++) {
      for (let dc = 0; dc < spanCols; dc++) {
        const nr = startR + dr;
        const nc = startC + dc;
        if (nr >= 0 && nr < this.state.rows && nc >= 0 && nc < this.state.cols) {
          parts.push({
            r: nr,
            c: nc,
            entry: {
              texture: meta.id,
              partCol: dc,
              partRow: dr,
              ...(this.ui.flipX ? { flipX: true } : {}),
            },
          });
        }
      }
    }
    return { startR, startC, parts };
  }

  buildSingleEntry(meta) {
    const entry = { texture: meta.id };
    if (this.ui.flipX && meta.kind !== 'decor') {
      entry.flipX = true;
    }
    if (meta.kind === 'decor' && this.ui.torchVariant !== 'upright') {
      entry.variant = this.ui.torchVariant;
    }
    return entry;
  }

  paintAt(r, c, multiLockAnchor = null) {
    const texId = this.ui.selectedTexture;
    const texRec = this.textureMap.get(texId);
    if (!texRec) return false;
    const meta = texRec.meta;
    const mode = this.ui.mode;

    // Multi-cell block (e.g. 1x2 oak_door)
    if ((meta.spanCols || 1) > 1 || (meta.spanRows || 1) > 1) {
      const targetR = multiLockAnchor !== null ? multiLockAnchor : r;
      const placement = this.computeMultiPlacement(targetR, c, meta);
      let changed = false;

      for (const part of placement.parts) {
        const cell = this.state.cells[part.r][part.c];
        const prevSig = entrySignature(cell[mode]);
        const nextSig = entrySignature(part.entry);

        if (mode === 'fg') {
          if (cell.fgDecor) {
            cell.fgDecor = null;
            changed = true;
          }
          if (prevSig !== nextSig) {
            this.clearMultiBlockAt(part.r, part.c, 'fg');
            cell.fg = part.entry;
            if (!meta.preservesBg) {
              this.clearMultiBlockAt(part.r, part.c, 'bg');
              cell.bg = null;
              cell.bgDecor = null;
            }
            changed = true;
          }
        } else {
          const fgMeta = cell.fg ? this.textureMap.get(cell.fg.texture)?.meta : null;
          if (cell.fg && (!fgMeta || !fgMeta.preservesBg)) {
            this.clearMultiBlockAt(part.r, part.c, 'fg');
            cell.fg = null;
            cell.fgDecor = null;
            changed = true;
          }
          if (cell.bgDecor) {
            cell.bgDecor = null;
            changed = true;
          }
          if (prevSig !== nextSig) {
            this.clearMultiBlockAt(part.r, part.c, 'bg');
            cell.bg = part.entry;
            changed = true;
          }
        }
      }
      return changed;
    }

    const cell = this.state.cells[r]?.[c];
    if (!cell) return false;
    const entry = this.buildSingleEntry(meta);
    const nextSig = entrySignature(entry);

    // Decor (e.g. torch)
    if (meta.isDecor) {
      if (mode === 'fg') {
        if (entrySignature(cell.fgDecor) === nextSig) return false;
        cell.fgDecor = entry;
        return true;
      }
      let changed = false;
      const fgMeta = cell.fg ? this.textureMap.get(cell.fg.texture)?.meta : null;
      if (cell.fg && (!fgMeta || !fgMeta.preservesBg)) {
        this.clearMultiBlockAt(r, c, 'fg');
        cell.fg = null;
        changed = true;
      }
      if (cell.fgDecor) {
        cell.fgDecor = null;
        changed = true;
      }
      if (entrySignature(cell.bgDecor) !== nextSig) {
        cell.bgDecor = entry;
        changed = true;
      }
      return changed;
    }

    // Standard 1x1 block or cutout/wall
    if (mode === 'fg') {
      let changed = false;
      if (cell.fgDecor) {
        cell.fgDecor = null;
        changed = true;
      }
      if (entrySignature(cell.fg) !== nextSig) {
        this.clearMultiBlockAt(r, c, 'fg');
        cell.fg = entry;
        changed = true;
      }
      if (!meta.preservesBg && (cell.bg || cell.bgDecor)) {
        this.clearMultiBlockAt(r, c, 'bg');
        cell.bg = null;
        cell.bgDecor = null;
        changed = true;
      }
      return changed;
    }

    // Background mode for 1x1 block or cutout/wall
    let changed = false;
    const fgMeta = cell.fg ? this.textureMap.get(cell.fg.texture)?.meta : null;
    if (cell.fg && (!fgMeta || !fgMeta.preservesBg)) {
      this.clearMultiBlockAt(r, c, 'fg');
      cell.fg = null;
      cell.fgDecor = null;
      changed = true;
    }
    if (cell.bgDecor) {
      cell.bgDecor = null;
      changed = true;
    }
    if (entrySignature(cell.bg) !== nextSig) {
      this.clearMultiBlockAt(r, c, 'bg');
      cell.bg = entry;
      changed = true;
    }
    return changed;
  }

  eraseAt(r, c, wholeCell = false) {
    const cell = this.state.cells[r]?.[c];
    if (!cell) return false;

    if (wholeCell) {
      if (!cell.fg && !cell.bg && !cell.fgDecor && !cell.bgDecor) return false;
      this.clearMultiBlockAt(r, c, 'fg');
      this.clearMultiBlockAt(r, c, 'bg');
      cell.fg = null;
      cell.bg = null;
      cell.fgDecor = null;
      cell.bgDecor = null;
      return true;
    }

    const order =
      this.ui.mode === 'fg'
        ? ['fgDecor', 'fg', 'bgDecor', 'bg']
        : ['bgDecor', 'bg', 'fgDecor', 'fg'];

    for (const key of order) {
      if (!cell[key]) continue;
      if (key === 'fg' || key === 'bg') {
        if (!this.clearMultiBlockAt(r, c, key)) {
          cell[key] = null;
        }
      } else {
        cell[key] = null;
      }
      return true;
    }
    return false;
  }

  floodFillAt(startR, startC) {
    const texId = this.ui.selectedTexture;
    const texRec = this.textureMap.get(texId);
    if (!texRec) return;
    const meta = texRec.meta;

    if ((meta.spanCols || 1) > 1 || (meta.spanRows || 1) > 1) {
      this.pushUndoSnapshot();
      if (this.paintAt(startR, startC)) {
        this.renderAll();
      } else {
        this.undoStack.pop();
        this.updateHistoryButtons();
      }
      return;
    }

    const mode = this.ui.mode;
    const cellKey = (r, c) => {
      const cell = this.state.cells[r][c];
      if (mode === 'fg') {
        return meta.isDecor
          ? `${entrySignature(cell.fg)}|${entrySignature(cell.fgDecor)}`
          : entrySignature(cell.fg);
      }
      const fgMeta = cell.fg ? this.textureMap.get(cell.fg.texture)?.meta : null;
      const fgSolid = Boolean(cell.fg && (!fgMeta || !fgMeta.preservesBg));
      const bgPart = meta.isDecor
        ? `${entrySignature(cell.bg)}|${entrySignature(cell.bgDecor)}`
        : entrySignature(cell.bg);
      return `${fgSolid ? 'FG_SOLID' : 'OPEN'}|${bgPart}`;
    };

    const targetKey = cellKey(startR, startC);
    const snapshot = {
      cols: this.state.cols,
      rows: this.state.rows,
      cells: cloneCells(this.state.cells),
    };

    const visited = new Set();
    const queue = [[startR, startC]];
    const targets = [];

    while (queue.length) {
      const [r, c] = queue.shift();
      const id = `${r},${c}`;
      if (visited.has(id)) continue;
      if (r < 0 || r >= this.state.rows || c < 0 || c >= this.state.cols) continue;
      if (cellKey(r, c) !== targetKey) continue;

      visited.add(id);
      targets.push([r, c]);
      queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }

    let anyChanged = false;
    for (const [r, c] of targets) {
      if (this.paintAt(r, c)) anyChanged = true;
    }

    if (anyChanged) {
      this.pushUndoSnapshot(snapshot);
      this.renderAll();
    }
  }

  eyedropAt(r, c) {
    const cell = this.state.cells[r]?.[c];
    if (!cell) return;
    const order = [
      { key: 'fgDecor', mode: 'fg' },
      { key: 'fg', mode: 'fg' },
      { key: 'bgDecor', mode: 'bg' },
      { key: 'bg', mode: 'bg' },
    ];
    for (const item of order) {
      const entry = cell[item.key];
      if (!entry || !this.textureMap.has(entry.texture)) continue;
      this.setMode(item.mode);
      this.ui.selectedTexture = entry.texture;
      this.ui.flipX = Boolean(entry.flipX);
      this.els.btnFlipX.classList.toggle('active', this.ui.flipX);
      if (entry.variant) {
        this.ui.torchVariant = entry.variant;
      } else {
        this.ui.torchVariant = 'upright';
      }
      this.setTool('paint');
      this.renderTexturePalette();
      this.updateContextualControls();
      this.renderEditor();
      const label = this.textureMap.get(entry.texture).meta.label;
      this.showToast(`Picked ${label} (${item.mode.toUpperCase()})`);
      return;
    }
  }

  handlePointerDown(e) {
    const pos = this.getCellFromPointer(e);
    if (!pos) return;

    this.els.editorCanvas.setPointerCapture(e.pointerId);

    if (e.altKey || (e.button === 0 && this.ui.tool === 'eyedropper')) {
      this.eyedropAt(pos.r, pos.c);
      return;
    }

    const isRightClick = e.button === 2;
    const action = isRightClick || this.ui.tool === 'erase' ? 'erase' : this.ui.tool;

    if (action === 'fill') {
      this.floodFillAt(pos.r, pos.c);
      return;
    }

    const texMeta = this.textureMap.get(this.ui.selectedTexture)?.meta;
    const isMulti = Boolean(texMeta && ((texMeta.spanCols || 1) > 1 || (texMeta.spanRows || 1) > 1));

    this.stroke = {
      pointerId: e.pointerId,
      action,
      wholeCell: isRightClick && e.shiftKey,
      lastR: pos.r,
      lastC: pos.c,
      multiLockR: action === 'paint' && isMulti ? pos.r : null,
      snapshot: {
        cols: this.state.cols,
        rows: this.state.rows,
        cells: cloneCells(this.state.cells),
      },
      mutated: false,
    };

    const changed =
      action === 'erase'
        ? this.eraseAt(pos.r, pos.c, this.stroke.wholeCell)
        : this.paintAt(pos.r, pos.c, this.stroke.multiLockR);

    if (changed) {
      this.stroke.mutated = true;
      this.renderAll();
    }
  }

  handlePointerMove(e) {
    const pos = this.getCellFromPointer(e);
    this.ui.hoverCell = pos;
    this.updateCursorStatus(pos);

    if (!this.stroke || e.pointerId !== this.stroke.pointerId) {
      this.renderEditor();
      return;
    }

    if (!pos) return;
    if (pos.r === this.stroke.lastR && pos.c === this.stroke.lastC) return;

    const pts = bresenhamLine(this.stroke.lastR, this.stroke.lastC, pos.r, pos.c);
    this.stroke.lastR = pos.r;
    this.stroke.lastC = pos.c;

    let changed = false;
    for (const [r, c] of pts) {
      if (this.stroke.action === 'erase') {
        if (this.eraseAt(r, c, this.stroke.wholeCell)) changed = true;
      } else {
        if (this.paintAt(r, c, this.stroke.multiLockR)) changed = true;
      }
    }

    if (changed) {
      this.stroke.mutated = true;
      this.renderAll();
    } else {
      this.renderEditor();
    }
  }

  handlePointerUp(e) {
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    if (this.els.editorCanvas.hasPointerCapture(e.pointerId)) {
      this.els.editorCanvas.releasePointerCapture(e.pointerId);
    }
    if (this.stroke.mutated) {
      this.pushUndoSnapshot(this.stroke.snapshot);
    }
    this.stroke = null;
    this.renderEditor();
  }

  handleKeyDown(e) {
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.exportMockup();
      return;
    }

    if (isInput) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }

    const key = e.key.toLowerCase();
    if (key === '1') this.setMode('fg');
    else if (key === '2') this.setMode('bg');
    else if (key === 'b') this.setTool('paint');
    else if (key === 'g') this.setTool('fill');
    else if (key === 'e') this.setTool('erase');
    else if (key === 'i') this.setTool('eyedropper');
    else if (key === 'f') {
      this.ui.flipX = !this.ui.flipX;
      this.els.btnFlipX.classList.toggle('active', this.ui.flipX);
      this.renderEditor();
    } else if (key === 'h') {
      this.ui.showGrid = !this.ui.showGrid;
      this.els.btnToggleGrid.classList.toggle('is-active', this.ui.showGrid);
      this.renderEditor();
    } else if (key === 'escape') {
      this.closeLoadModal();
    }
  }

  updateCursorStatus(pos) {
    if (!pos) {
      this.els.cursorStatus.textContent = 'Ready';
      return;
    }
    const cell = this.state.cells[pos.r][pos.c];
    const parts = [];
    if (cell.fg) parts.push(`FG:${cell.fg.texture}`);
    if (cell.fgDecor) parts.push(`FG*:${cell.fgDecor.texture}`);
    if (cell.bg) parts.push(`BG:${cell.bg.texture}`);
    if (cell.bgDecor) parts.push(`BG*:${cell.bgDecor.texture}`);
    const desc = parts.length ? parts.join(' · ') : 'Empty';
    this.els.cursorStatus.textContent = `(${pos.c}, ${pos.r}) ${desc}`;
  }

  buildHoverPreview() {
    if (this.stroke || !this.ui.hoverCell) return null;
    const { r, c } = this.ui.hoverCell;
    const tool = this.ui.tool;

    if (tool === 'erase' || tool === 'eyedropper') {
      return { tool, mode: this.ui.mode, cells: [{ r, c, entry: null }] };
    }

    const texRec = this.textureMap.get(this.ui.selectedTexture);
    if (!texRec) return null;
    const meta = texRec.meta;

    if ((meta.spanCols || 1) > 1 || (meta.spanRows || 1) > 1) {
      const placement = this.computeMultiPlacement(r, c, meta);
      return {
        tool,
        mode: this.ui.mode,
        cells: placement.parts,
      };
    }

    return {
      tool,
      mode: this.ui.mode,
      cells: [{ r, c, entry: this.buildSingleEntry(meta) }],
    };
  }

  renderEditor() {
    renderMockup(this.els.editorCanvas, this.state, this.textureMap, {
      cellPx: this.ui.cellPx,
      showGrid: this.ui.showGrid,
      backdrop: this.ui.backdrop,
      hoverPreview: this.buildHoverPreview(),
      trimEmpty: false,
    });
  }

  renderPreview() {
    const previewCellPx = Math.max(8, Math.min(24, Math.floor(140 / Math.max(this.state.cols, this.state.rows))));
    renderMockup(this.els.previewCanvas, this.state, this.textureMap, {
      cellPx: previewCellPx,
      showGrid: false,
      backdrop: 'transparent',
      hoverPreview: null,
      trimEmpty: this.state.settings.trimEmpty,
    });
    this.updateExportDimsLabel();
  }

  renderAll() {
    this.renderEditor();
    this.renderPreview();
  }

  updateExportDimsLabel() {
    const bounds = computeRenderBounds(this.state, this.state.settings.trimEmpty);
    const cols = bounds.maxC - bounds.minC + 1;
    const rows = bounds.maxR - bounds.minR + 1;
    const scale = this.state.settings.exportScale;
    this.els.exportDimsLabel.textContent = `${cols * scale}×${rows * scale} px`;
  }

  buildProjectPayload(name) {
    return {
      format: 'minecraft-mockup-2d',
      version: 1,
      name,
      cols: this.state.cols,
      rows: this.state.rows,
      settings: { ...this.state.settings },
      cells: cloneCells(this.state.cells),
    };
  }

  applyLoadedProject(data) {
    if (!data || data.format !== 'minecraft-mockup-2d') {
      throw new Error('File is not a valid minecraft-mockup-2d project JSON.');
    }
    const cols = clamp(parseInt(data.cols, 10) || 12, 1, 64);
    const rows = clamp(parseInt(data.rows, 10) || 10, 1, 64);
    const nextCells = makeEmptyGrid(rows, cols);

    if (Array.isArray(data.cells)) {
      for (let r = 0; r < rows; r++) {
        const srcRow = data.cells[r];
        if (!Array.isArray(srcRow)) continue;
        for (let c = 0; c < cols; c++) {
          const srcCell = srcRow[c];
          if (!srcCell || typeof srcCell !== 'object') continue;
          nextCells[r][c] = {
            fg: cloneEntry(srcCell.fg),
            bg: cloneEntry(srcCell.bg),
            fgDecor: cloneEntry(srcCell.fgDecor),
            bgDecor: cloneEntry(srcCell.bgDecor),
          };
        }
      }
    }

    this.pushUndoSnapshot();
    this.state.cols = cols;
    this.state.rows = rows;
    this.state.cells = nextCells;
    this.state.settings = {
      ...DEFAULT_SETTINGS,
      ...(data.settings && typeof data.settings === 'object' ? data.settings : {}),
    };
    if (data.name) {
      this.els.exportName.value = data.name;
    }

    this.syncControlsFromState();
    this.fitZoom();
    this.renderAll();
  }

  async exportMockup() {
    const rawName = this.els.exportName.value.trim();
    if (!rawName) {
      this.showToast('Enter a file name before exporting.', 'error');
      this.els.exportName.focus();
      return;
    }

    const exportCanvas = document.createElement('canvas');
    const info = renderMockup(exportCanvas, this.state, this.textureMap, {
      cellPx: this.state.settings.exportScale,
      showGrid: false,
      backdrop: 'transparent',
      hoverPreview: null,
      trimEmpty: this.state.settings.trimEmpty,
    });

    const pngDataUrl = exportCanvas.toDataURL('image/png');
    const project = this.buildProjectPayload(rawName);

    this.els.btnExport.disabled = true;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rawName, pngDataUrl, project }),
      });
      const result = await res.json();
      if (!res.ok) {
        this.showToast(result.error || 'Export failed', 'error');
        return;
      }
      this.els.exportName.value = result.name;
      this.showToast(
        `Saved ${result.png} (${info.width}×${info.height}px) + ${result.json} to demo/assets/`,
        'success'
      );
    } catch (err) {
      this.showToast(`Export error: ${err.message}`, 'error');
    } finally {
      this.els.btnExport.disabled = false;
    }
  }

  async openLoadModal() {
    this.els.loadModal.hidden = false;
    this.els.projectsList.innerHTML = '<div class="empty-projects">Loading saved mockups...</div>';

    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      const projects = data.projects || [];

      if (!projects.length) {
        this.els.projectsList.innerHTML =
          '<div class="empty-projects">No saved mockups found in <code>demo/assets/</code> yet. Export one first!</div>';
        return;
      }

      this.els.projectsList.innerHTML = '';
      for (const proj of projects) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'project-card';

        const thumb = document.createElement('div');
        thumb.className = 'project-thumb';
        if (proj.pngUrl) {
          const img = document.createElement('img');
          img.src = proj.pngUrl;
          img.alt = proj.name;
          thumb.appendChild(img);
        }

        const meta = document.createElement('div');
        meta.className = 'project-meta';
        const title = document.createElement('span');
        title.className = 'project-title';
        title.textContent = proj.name;
        const sub = document.createElement('span');
        sub.className = 'project-sub';
        sub.textContent = `${proj.cols || '?'} × ${proj.rows || '?'} blocks`;

        meta.appendChild(title);
        meta.appendChild(sub);
        card.appendChild(thumb);
        card.appendChild(meta);

        card.addEventListener('click', () => this.loadProjectByName(proj.name));
        this.els.projectsList.appendChild(card);
      }
    } catch (err) {
      this.els.projectsList.innerHTML = `<div class="empty-projects">Failed to load projects: ${err.message}</div>`;
    }
  }

  closeLoadModal() {
    this.els.loadModal.hidden = true;
  }

  async loadProjectByName(name) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || `Failed to load ${name}`, 'error');
        return;
      }
      this.applyLoadedProject(data);
      this.closeLoadModal();
      this.showToast(`Loaded "${name}" (${this.state.cols}×${this.state.rows})`, 'success');
    } catch (err) {
      this.showToast(`Error loading "${name}": ${err.message}`, 'error');
    }
  }

  async handleLocalFileImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      this.applyLoadedProject(data);
      this.showToast(`Loaded ${file.name}`, 'success');
    } catch (err) {
      this.showToast(`Invalid JSON file: ${err.message}`, 'error');
    }
  }

  showToast(message, variant = 'info') {
    const el = this.els.toast;
    el.textContent = message;
    el.className = 'toast';
    if (variant === 'success') el.classList.add('is-success');
    if (variant === 'error') el.classList.add('is-error');
    el.hidden = false;

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3600);
  }
}

const app = new MockupStudioApp();
app.init().catch((err) => {
  console.error(err);
});
