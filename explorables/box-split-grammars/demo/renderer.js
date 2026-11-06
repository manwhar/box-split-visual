/**
 * renderer.js
 * Visualizes the 10x10 unit grid, filled regions with glowing green outlines,
 * cut lines, animated darkening of non-highlighted regions, and bloom/brightness lift
 * on the active code-highlighted region.
 */

import { GRID_SIZE } from './model.js';
import { TextureLibrary } from './textures.js';

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.textureLib = new TextureLibrary();
    this.detailScale = window.devicePixelRatio || 1;
    this.padding = 25;

    // Darkening & Bloom highlight animation state
    this.codeHighlightId = null;
    this.lastHighlightNodeId = null;
    this.highlightProgress = 0;
    this.targetProgress = 0;
    this.animId = null;

    // Cache latest arguments for animation frames
    this.lastRootRegion = null;
    this.lastHoverCut = null;
    this.lastHoverRegion = null;
  }

  setResolution(scale) {
    this.detailScale = scale;
    this.resize();
  }

  setCodeHighlightId(nodeId) {
    if (nodeId !== null) {
      this.codeHighlightId = nodeId;
      this.lastHighlightNodeId = nodeId;
      this.targetProgress = 1.0;
    } else {
      this.codeHighlightId = null;
      this.targetProgress = 0.0;
    }
    this.startDimAnimation();
  }

  startDimAnimation() {
    if (this.animId) cancelAnimationFrame(this.animId);

    let lastTime = performance.now();
    const step = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const diff = this.targetProgress - this.highlightProgress;
      if (Math.abs(diff) > 0.01) {
        // Smooth ease: fast fade-in (~100ms) and snappy fade-out (~80ms)
        const speed = this.targetProgress > 0 ? 15 : 20;
        this.highlightProgress += diff * Math.min(speed * dt, 0.55);
        this.renderCurrent();
        this.animId = requestAnimationFrame(step);
      } else {
        this.highlightProgress = this.targetProgress;
        if (this.highlightProgress === 0) {
          this.lastHighlightNodeId = null;
        }
        this.renderCurrent();
        this.animId = null;
      }
    };

    this.animId = requestAnimationFrame(step);
  }

  renderCurrent() {
    if (this.lastRootRegion) {
      this.render(this.lastRootRegion, this.lastHoverCut, this.lastHoverRegion);
    }
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * this.detailScale);
    this.canvas.height = Math.round(h * this.detailScale);
    this.ctx.setTransform(this.detailScale, 0, 0, this.detailScale, 0, 0);
  }

  getMetrics() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const availW = w - this.padding * 2;
    const availH = h - this.padding * 2;
    const side = Math.min(availW, availH);
    const cellSize = side / GRID_SIZE;
    const ox = (w - side) / 2;
    const oy = (h - side) / 2;
    return { w, h, ox, oy, side, cellSize };
  }

  toGridCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { ox, oy, cellSize, side } = this.getMetrics();

    if (px < ox || px > ox + side || py < oy || py > oy + side) {
      return null;
    }

    const gx = (px - ox) / cellSize;
    const gy = (py - oy) / cellSize;
    return { gx, gy, px, py };
  }

  render(rootRegion, hoverCut = null, hoverRegion = null) {
    this.lastRootRegion = rootRegion;
    this.lastHoverCut = hoverCut;
    this.lastHoverRegion = hoverRegion;

    const { w, h, ox, oy, side, cellSize } = this.getMetrics();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    // 1. Blank Square Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, side, side);

    // 2. Official 16x16 Minecraft Block Textures for all Leaf Regions
    const leaves = rootRegion.getAllLeaves();
    for (const leaf of leaves) {
      if (leaf.fill) {
        const texCanvas = this.textureLib.getCanvas(leaf.fill);
        if (texCanvas) {
          for (let ix = 0; ix < leaf.w; ix++) {
            for (let iy = 0; iy < leaf.h; iy++) {
              const bx = ox + (leaf.x + ix) * cellSize;
              const by = oy + (leaf.y + iy) * cellSize;
              ctx.drawImage(texCanvas, bx, by, cellSize, cellSize);
            }
          }
        }
      }
    }

    // 3. Unit Grid Lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + i * cellSize, oy);
      ctx.lineTo(ox + i * cellSize, oy + side);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ox, oy + i * cellSize);
      ctx.lineTo(ox + side, oy + i * cellSize);
      ctx.stroke();
    }

    // 4. Glowing Green Outlines for Filled Regions (cannot be cut)
    for (const leaf of leaves) {
      if (leaf.fill) {
        const lx = ox + leaf.x * cellSize;
        const ly = oy + leaf.y * cellSize;
        const lw = leaf.w * cellSize;
        const lh = leaf.h * cellSize;

        ctx.save();
        ctx.strokeStyle = '#22c55e'; // Glowing green
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(34, 197, 94, 0.7)';
        ctx.shadowBlur = 6;
        ctx.strokeRect(lx + 1, ly + 1, lw - 2, lh - 2);
        ctx.restore();
      }
    }

    // 5. Executed Cuts (spanning strictly across each sliced box)
    const cuts = rootRegion.getAllCuts();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'square';

    for (const cut of cuts) {
      const x1 = ox + cut.x1 * cellSize;
      const y1 = oy + cut.y1 * cellSize;
      const x2 = ox + cut.x2 * cellSize;
      const y2 = oy + cut.y2 * cellSize;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 6. Interactive Previews (Hover Region in Fill Mode or Hover Cut in Knife Mode)
    if (hoverRegion) {
      const rx = ox + hoverRegion.x * cellSize;
      const ry = oy + hoverRegion.y * cellSize;
      const rw = hoverRegion.w * cellSize;
      const rh = hoverRegion.h * cellSize;

      ctx.fillStyle = 'rgba(2, 132, 199, 0.2)';
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
    }

    if (hoverCut) {
      const { axis, coord, region } = hoverCut;
      const x1 = ox + (axis === 'V' ? coord : region.x) * cellSize;
      const y1 = oy + (axis === 'H' ? coord : region.y) * cellSize;
      const x2 = ox + (axis === 'V' ? coord : region.x + region.w) * cellSize;
      const y2 = oy + (axis === 'H' ? coord : region.y + region.h) * cellSize;

      ctx.strokeStyle = '#dc2626'; // Knife red
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    // 7. CODE HOVER HIGHLIGHT: Darken other regions + Bloom & Additive Brightness on Target Region
    const activeHighlightId = this.codeHighlightId || this.lastHighlightNodeId;
    if (this.highlightProgress > 0.005 && activeHighlightId !== null) {
      const targetNode = rootRegion.findNodeById(activeHighlightId);
      if (targetNode) {
        const hx = ox + targetNode.x * cellSize;
        const hy = oy + targetNode.y * cellSize;
        const hw = targetNode.w * cellSize;
        const hh = targetNode.h * cellSize;
        const p = this.highlightProgress;

        // A. Dark scrim overlay covering everything EXCEPT the highlighted box
        ctx.save();
        ctx.fillStyle = `rgba(15, 23, 42, ${0.68 * p})`;
        ctx.beginPath();
        ctx.rect(ox, oy, side, side);       // Outer square
        ctx.rect(hx, hy, hw, hh);           // Cutout for target region
        ctx.fill('evenodd');
        ctx.restore();

        // B. Additive Brightness Lift on the selected region
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 255, 255, ${0.22 * p})`;
        ctx.fillRect(hx, hy, hw, hh);
        ctx.restore();

        // C. Bloom Glow Border around selected region
        ctx.save();
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.95 * p})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = `rgba(56, 189, 248, ${0.85 * p})`;
        ctx.shadowBlur = 12 * p;
        ctx.strokeRect(hx + 1.5, hy + 1.5, hw - 3, hh - 3);

        // Delicate inner bright highlight line
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * p})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.strokeRect(hx + 3, hy + 3, hw - 6, hh - 6);
        ctx.restore();
      }
    }

    // 8. Outer Boundary of 10x10 Box
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(ox, oy, side, side);
  }
}
