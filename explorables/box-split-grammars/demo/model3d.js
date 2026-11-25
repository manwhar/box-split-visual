/**
 * model3d.js
 * Core data structures for hierarchical 3D box splitting.
 * Matches GrammarBox.BoundingBox: (x, y, z) min corner and (w, h, d) integer extents.
 */

export const GRID_SIZE_3D = 6;

let nextNodeId = 1;

export class Region3D {
  constructor(x, y, z, w, h, d, id = 0, fill = null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w; // X extent
    this.h = h; // Y extent (up)
    this.d = d; // Z extent
    this.fill = fill; // 'oak_log' | 'cobblestone' | 'oak_planks' | null
    this.children = [];
    this.cut = null; // { axis: 'X' | 'Y' | 'Z', coord: number }
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

  findNodeById(targetId) {
    if (this.id === targetId) return this;
    for (const child of this.children) {
      const found = child.findNodeById(targetId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Split this 3D region in two along an integer grid plane.
   * Disallowed if region is already filled or non-leaf.
   */
  split(axis, coord) {
    if (!this.isLeaf() || this.fill !== null) return false;

    if (axis === 'X') {
      if (coord <= this.x || coord >= this.x + this.w) return false;
      const w1 = coord - this.x;
      const w2 = this.w - w1;
      this.cut = { axis: 'X', coord };
      this.children = [
        new Region3D(this.x, this.y, this.z, w1, this.h, this.d, nextNodeId++, this.fill),
        new Region3D(coord, this.y, this.z, w2, this.h, this.d, nextNodeId++, this.fill)
      ];
      return true;
    }

    if (axis === 'Y') {
      if (coord <= this.y || coord >= this.y + this.h) return false;
      const h1 = coord - this.y;
      const h2 = this.h - h1;
      this.cut = { axis: 'Y', coord };
      this.children = [
        new Region3D(this.x, this.y, this.z, this.w, h1, this.d, nextNodeId++, this.fill),
        new Region3D(this.x, coord, this.z, this.w, h2, this.d, nextNodeId++, this.fill)
      ];
      return true;
    }

    if (axis === 'Z') {
      if (coord <= this.z || coord >= this.z + this.d) return false;
      const d1 = coord - this.z;
      const d2 = this.d - d1;
      this.cut = { axis: 'Z', coord };
      this.children = [
        new Region3D(this.x, this.y, this.z, this.w, this.h, d1, nextNodeId++, this.fill),
        new Region3D(this.x, this.y, coord, this.w, this.h, d2, nextNodeId++, this.fill)
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
        cuts.push({
          axis: node.cut.axis,
          coord: node.cut.coord,
          x: node.x,
          y: node.y,
          z: node.z,
          w: node.w,
          h: node.h,
          d: node.d
        });
      }
      for (const child of node.children) collect(child);
    }
    collect(this);
    return cuts;
  }
}

export function createInitialModel3D() {
  nextNodeId = 1;
  return new Region3D(0, 0, 0, GRID_SIZE_3D, GRID_SIZE_3D, GRID_SIZE_3D, 0, null);
}
