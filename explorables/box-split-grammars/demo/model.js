/**
 * model.js
 * Core data structures for hierarchical 2D box splitting.
 */

// Internal parameter for the grid dimensions
export const GRID_SIZE = 10;

let nextNodeId = 1;

export class Region {
  constructor(x, y, w, h, id = 0, fill = null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.fill = fill; // 'oak_log' | 'cobblestone' | 'oak_planks' | null
    this.children = [];
    this.cut = null; // { axis: 'H' | 'V', coord: number }
  }

  setFill(fillType) {
    this.fill = fillType;
  }

  isLeaf() {
    return this.children.length === 0;
  }

  isFilled() {
    return this.fill !== null;
  }

  findLeaf(gx, gy) {
    if (gx < this.x || gx >= this.x + this.w || gy < this.y || gy >= this.y + this.h) {
      return null;
    }
    if (this.isLeaf()) return this;
    for (const child of this.children) {
      const found = child.findLeaf(gx, gy);
      if (found) return found;
    }
    return null;
  }

  findNodeById(targetId) {
    if (this.id === targetId) return this;
    for (const child of this.children) {
      const found = child.findNodeById(targetId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Split this region in two along an integer grid line.
   * Disallowed if region is already filled or non-leaf.
   */
  split(axis, coord) {
    if (!this.isLeaf() || this.fill !== null) return false;

    if (axis === 'V') {
      if (coord <= this.x || coord >= this.x + this.w) return false;
      const w1 = coord - this.x;
      const w2 = this.w - w1;
      this.cut = { axis: 'V', coord };
      this.children = [
        new Region(this.x, this.y, w1, this.h, nextNodeId++, this.fill),
        new Region(coord, this.y, w2, this.h, nextNodeId++, this.fill)
      ];
      return true;
    }

    if (axis === 'H') {
      if (coord <= this.y || coord >= this.y + this.h) return false;
      const h1 = coord - this.y;
      const h2 = this.h - h1;
      this.cut = { axis: 'H', coord };
      this.children = [
        new Region(this.x, this.y, this.w, h1, nextNodeId++, this.fill),
        new Region(this.x, coord, this.w, h2, nextNodeId++, this.fill)
      ];
      return true;
    }

    return false;
  }

  getAllLeaves() {
    const leaves = [];
    function collect(node) {
      if (node.isLeaf()) leaves.push(node);
      else for (const child of node.children) collect(child);
    }
    collect(this);
    return leaves;
  }

  getAllCuts() {
    const cuts = [];
    function collect(node) {
      if (node.cut) {
        // A cut line spans strictly across the existing box
        cuts.push({
          axis: node.cut.axis,
          coord: node.cut.coord,
          x1: node.cut.axis === 'V' ? node.cut.coord : node.x,
          y1: node.cut.axis === 'H' ? node.cut.coord : node.y,
          x2: node.cut.axis === 'V' ? node.cut.coord : node.x + node.w,
          y2: node.cut.axis === 'H' ? node.cut.coord : node.y + node.h
        });
      }
      for (const child of node.children) collect(child);
    }
    collect(this);
    return cuts;
  }
}

export function createInitialModel() {
  nextNodeId = 1;
  return new Region(0, 0, GRID_SIZE, GRID_SIZE, 0, null);
}
