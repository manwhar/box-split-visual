/**
 * interaction3d.js
 * Handles pointer/mouse interactions for the 3D Box-Split Grammar tool:
 * - Move tool (grabber hand): drag to orbit camera, click a leaf region to fill/toggle block texture
 * - Slice tool (scissors): hover & click to slice unfilled leaf along X, Y, or Z; right-drag to orbit
 * - Scroll wheel: smooth zoom
 */

import { TEXTURE_TYPES } from './textures.js';

function intersectRayAABB(origin, dir, box) {
  const min = [box.x, box.y, box.z];
  const max = [box.x + box.w, box.y + box.h, box.z + box.d];
  let tMin = -Infinity;
  let tMax = Infinity;
  let enterAxis = 0;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - origin[i]) / dir[i];
      let t2 = (max[i] - origin[i]) / dir[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) {
        tMin = t1;
        enterAxis = i;
      }
      if (t2 < tMax) {
        tMax = t2;
      }
      if (tMin > tMax) return null;
    }
  }

  if (tMax <= 0) return null;
  const tHit = Math.max(tMin, 0);
  return {
    box,
    tNear: tHit,
    tFar: tMax,
    enterAxis, // 0=X, 1=Y, 2=Z
    hitNear: [
      origin[0] + dir[0] * tHit,
      origin[1] + dir[1] * tHit,
      origin[2] + dir[2] * tHit
    ],
    hitFar: [
      origin[0] + dir[0] * tMax,
      origin[1] + dir[1] * tMax,
      origin[2] + dir[2] * tMax
    ]
  };
}

export class BoxSplit3DController {
  constructor(model, renderer, onModelChanged, onModeChange) {
    this.model = model;
    this.renderer = renderer;
    this.onModelChanged = onModelChanged;
    this.onModeChange = onModeChange;

    this.mode = 'slice'; // 'slice' | 'move'
    this.axis = 'X';     // 'X' | 'Y' | 'Z'
    this.selectedTexture = TEXTURE_TYPES.OAK_LOG;

    this.hoverCut = null;
    this.hoverRegion = null;

    this.dragState = null;
    this.bindEvents();
  }

  setMode(mode) {
    this.mode = mode;
    this.hoverCut = null;
    this.hoverRegion = null;
    this.updateCursor();
    this.render();
    if (this.onModeChange) this.onModeChange(mode);
  }

  setAxis(axis) {
    this.axis = axis;
    this.hoverCut = null;
    this.render();
  }

  setTexture(texture) {
    this.selectedTexture = texture;
    this.render();
  }

  reset() {
    this.hoverCut = null;
    this.hoverRegion = null;
    this.render();
    if (this.onModelChanged) this.onModelChanged();
  }

  updateCursor() {
    const c = this.renderer.canvas;
    if (this.dragState && this.dragState.isOrbiting) {
      c.style.cursor = 'grabbing';
    } else if (this.mode === 'move') {
      c.style.cursor = 'grab';
    } else {
      c.style.cursor = 'crosshair';
    }
  }

  pickFrontLeaf(clientX, clientY) {
    const ray = this.renderer.getRay(clientX, clientY);
    if (!ray) return null;

    const leaves = this.model.getAllLeaves();
    let best = null;
    for (const leaf of leaves) {
      const hit = intersectRayAABB(ray.origin, ray.dir, leaf);
      if (!hit) continue;
      if (!best || hit.tNear < best.tNear) {
        best = hit;
      }
    }
    return best;
  }

  computeHoverCut(hit) {
    if (!hit || hit.box.fill !== null) return null;
    const leaf = hit.box;
    const axisIndex = this.axis === 'X' ? 0 : this.axis === 'Y' ? 1 : 2;
    const minCoord = axisIndex === 0 ? leaf.x : axisIndex === 1 ? leaf.y : leaf.z;
    const extent = axisIndex === 0 ? leaf.w : axisIndex === 1 ? leaf.h : leaf.d;

    if (extent < 2) return null;

    // If ray entered perpendicular to target axis, slice near midpoint of ray passage;
    // otherwise use exact surface intersection coordinate along the target axis.
    const rawCoord = hit.enterAxis === axisIndex
      ? (hit.hitNear[axisIndex] + hit.hitFar[axisIndex]) * 0.5
      : hit.hitNear[axisIndex];

    const coord = Math.max(minCoord + 1, Math.min(minCoord + extent - 1, Math.round(rawCoord)));
    return { axis: this.axis, coord, region: leaf };
  }

  updateHover(clientX, clientY) {
    const hit = this.pickFrontLeaf(clientX, clientY);
    if (!hit) {
      if (this.hoverCut || this.hoverRegion) {
        this.hoverCut = null;
        this.hoverRegion = null;
        this.render();
      }
      return;
    }

    if (this.mode === 'move') {
      this.hoverCut = null;
      if (this.hoverRegion !== hit.box) {
        this.hoverRegion = hit.box;
        this.render();
      }
    } else {
      this.hoverRegion = null;
      const newCut = this.computeHoverCut(hit);
      const changed = !this.hoverCut !== !newCut || (
        newCut && this.hoverCut && (
          this.hoverCut.axis !== newCut.axis ||
          this.hoverCut.coord !== newCut.coord ||
          this.hoverCut.region !== newCut.region
        )
      );
      if (changed) {
        this.hoverCut = newCut;
        this.render();
      }
    }
  }

  bindEvents() {
    const canvas = this.renderer.canvas;

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('pointerdown', (e) => {
      const isOrbitButton = (this.mode === 'move' && e.button === 0) || e.button === 2 || e.button === 1;
      canvas.setPointerCapture(e.pointerId);
      this.dragState = {
        pointerId: e.pointerId,
        button: e.button,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        travel: 0,
        canOrbit: isOrbitButton,
        isOrbiting: false
      };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.dragState && this.dragState.pointerId === e.pointerId) {
        const dx = e.clientX - this.dragState.lastX;
        const dy = e.clientY - this.dragState.lastY;
        this.dragState.travel += Math.hypot(dx, dy);
        this.dragState.lastX = e.clientX;
        this.dragState.lastY = e.clientY;

        if (this.dragState.canOrbit && this.dragState.travel >= 5) {
          this.dragState.isOrbiting = true;
          this.hoverCut = null;
          this.hoverRegion = null;
          this.updateCursor();
          this.renderer.orbit(-dx * 0.011, dy * 0.011);
        }
        return;
      }

      this.updateHover(e.clientX, e.clientY);
    });

    const endDrag = (e) => {
      if (!this.dragState || this.dragState.pointerId !== e.pointerId) return;
      const { travel, isOrbiting, button } = this.dragState;
      this.dragState = null;
      this.updateCursor();

      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }

      // Click action if pointer barely moved
      if (!isOrbiting && travel < 5 && button === 0) {
        const hit = this.pickFrontLeaf(e.clientX, e.clientY);
        if (hit) {
          if (this.mode === 'move') {
            const leaf = hit.box;
            if (leaf.fill === this.selectedTexture) {
              leaf.setFill(null);
            } else {
              leaf.setFill(this.selectedTexture);
            }
            this.hoverRegion = leaf;
            this.render();
            if (this.onModelChanged) this.onModelChanged();
          } else {
            const cut = this.computeHoverCut(hit);
            if (cut && cut.region.split(cut.axis, cut.coord)) {
              this.hoverCut = null;
              this.render();
              if (this.onModelChanged) this.onModelChanged();
              this.updateHover(e.clientX, e.clientY);
            }
          }
        }
      }
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('pointerleave', () => {
      if (!this.dragState && (this.hoverCut || this.hoverRegion)) {
        this.hoverCut = null;
        this.hoverRegion = null;
        this.render();
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.zoom(e.deltaY * 0.01);
    }, { passive: false });
  }

  render() {
    this.renderer.render(this.model, this.hoverCut, this.hoverRegion);
  }
}
