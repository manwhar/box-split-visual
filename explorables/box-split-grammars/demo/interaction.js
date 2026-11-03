/**
 * interaction.js
 * Handles mouse events for both Knife (Cut) and Fill operations,
 * enforcing that filled regions cannot be cut but can have their fill swapped.
 */

import { TEXTURE_TYPES } from './textures.js';

export class KnifeController {
  constructor(model, renderer, onModelChanged) {
    this.model = model;
    this.renderer = renderer;
    this.onModelChanged = onModelChanged;

    this.mode = 'cut'; // 'cut' | 'fill'
    this.axis = 'H';   // 'H' | 'V'
    this.selectedTexture = TEXTURE_TYPES.OAK_LOG;

    this.hoverCut = null;
    this.hoverRegion = null;

    this.bindEvents();
  }

  setMode(mode) {
    this.mode = mode;
    this.hoverCut = null;
    this.hoverRegion = null;
    this.render();
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

  bindEvents() {
    const canvas = this.renderer.canvas;

    canvas.addEventListener('mousemove', (e) => {
      const coords = this.renderer.toGridCoords(e.clientX, e.clientY);
      if (!coords) {
        if (this.hoverCut || this.hoverRegion) {
          this.hoverCut = null;
          this.hoverRegion = null;
          this.render();
        }
        return;
      }

      const { gx, gy } = coords;
      const leaf = this.model.findLeaf(Math.floor(gx), Math.floor(gy));

      if (!leaf) {
        if (this.hoverCut || this.hoverRegion) {
          this.hoverCut = null;
          this.hoverRegion = null;
          this.render();
        }
        return;
      }

      if (this.mode === 'fill') {
        this.hoverCut = null;
        if (this.hoverRegion !== leaf) {
          this.hoverRegion = leaf;
          this.render();
        }
      } else {
        // Cut mode
        this.hoverRegion = null;

        // Cannot cut a region that has already been filled
        if (leaf.fill !== null) {
          if (this.hoverCut) {
            this.hoverCut = null;
            this.render();
          }
          return;
        }

        let newHoverCut = null;
        if (this.axis === 'V') {
          const snapX = Math.round(gx);
          if (snapX > leaf.x && snapX < leaf.x + leaf.w) {
            newHoverCut = { axis: 'V', coord: snapX, region: leaf };
          }
        } else {
          const snapY = Math.round(gy);
          if (snapY > leaf.y && snapY < leaf.y + leaf.h) {
            newHoverCut = { axis: 'H', coord: snapY, region: leaf };
          }
        }

        const changed = !this.hoverCut || !newHoverCut ||
          this.hoverCut.axis !== newHoverCut.axis ||
          this.hoverCut.coord !== newHoverCut.coord ||
          this.hoverCut.region !== newHoverCut.region;

        if (changed) {
          this.hoverCut = newHoverCut;
          this.render();
        }
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (this.hoverCut || this.hoverRegion) {
        this.hoverCut = null;
        this.hoverRegion = null;
        this.render();
      }
    });

    canvas.addEventListener('click', (e) => {
      const coords = this.renderer.toGridCoords(e.clientX, e.clientY);
      if (!coords) return;

      const { gx, gy } = coords;
      const leaf = this.model.findLeaf(Math.floor(gx), Math.floor(gy));
      if (!leaf) return;

      if (this.mode === 'fill') {
        // Swap fill contents or toggle off if clicked with same texture
        if (leaf.fill === this.selectedTexture) {
          leaf.setFill(null);
        } else {
          leaf.setFill(this.selectedTexture);
        }
        this.render();
        if (this.onModelChanged) this.onModelChanged();
      } else {
        // Cut mode: strictly disallowed if region is already filled
        if (leaf.fill !== null) return;

        let cutPerformed = false;
        if (this.axis === 'V') {
          const snapX = Math.round(gx);
          if (snapX > leaf.x && snapX < leaf.x + leaf.w) {
            cutPerformed = leaf.split('V', snapX);
          }
        } else {
          const snapY = Math.round(gy);
          if (snapY > leaf.y && snapY < leaf.y + leaf.h) {
            cutPerformed = leaf.split('H', snapY);
          }
        }

        if (cutPerformed) {
          this.hoverCut = null;
          this.render();
          if (this.onModelChanged) this.onModelChanged();
        }
      }
    });
  }

  render() {
    this.renderer.render(this.model, this.hoverCut, this.hoverRegion);
  }
}
