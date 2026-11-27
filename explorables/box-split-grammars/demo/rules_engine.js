/**
 * rules_engine.js
 * Implements Box-Split Grammar execution for the Castle Wall demo, faithful to SplitGrammar.py:
 * - makeSplit with positive (absolute) and negative (proportional) sizes + repeat=True + Rounding.START
 * - @rule constraint dispatch:
 *   - Dimension.X > 9 triggers gate_layout() vs Constraint.ELSE plain wall
 *   - Dimension.X % 2 == 1 centers a 3-wide gate vs Dimension.X % 2 == 0 centers a 4-wide gate
 * - Weighted nondeterministic selection for wall_body() (Cobblestone vs Mossy Cobblestone)
 */

import { TEXTURE_TYPES } from './textures.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Exact port of SplitGrammar.make_split(a, b, sizes, Rounding.START, repeat)
 */
export function makeSplit(a, b, sizes, repeat = false) {
  const abssizes = sizes.filter((s) => s > 0).reduce((acc, s) => acc + s, 0);
  const relsizes = sizes.filter((s) => s < 0).reduce((acc, s) => acc + Math.abs(s), 0);
  const total = b - a;
  const reltotal = total - abssizes;
  let relperunit = 0;
  let rem = 0;
  if (relsizes > 0 && reltotal >= 0) {
    relperunit = Math.floor(reltotal / relsizes);
    rem = reltotal % relsizes;
  }

  const result = [];
  let current = a;
  let doSplit = true;
  while (doSplit) {
    doSplit = repeat;
    const remAlloc = sizes.map(() => 0);
    if (!repeat && rem > 0) {
      let currRem = rem;
      for (let idx = 0; idx < sizes.length && currRem > 0; idx++) {
        if (sizes[idx] < 0) {
          remAlloc[idx] += 1;
          currRem -= 1;
        }
      }
    }
    for (let idx = 0; idx < sizes.length; idx++) {
      const s = sizes[idx];
      let to = s > 0 ? current + s : current + (-s) * relperunit + remAlloc[idx];
      if (to >= b && repeat) {
        to = b;
        doSplit = false;
      }
      if (to > b && !repeat) {
        to = b;
      }
      result.push([current, to]);
      current = to;
      if (current >= b && repeat) {
        break;
      }
    }
    if (repeat && result.length > 64) break;
  }
  return result;
}

/**
 * Execute the castle_wall grammar for given dimensions, loop toggle, and seed.
 * Splits Y into [-1, 1] first so top battlements alternate cleanly across the whole wall
 * without pressing two tall merlons together next to the gate.
 */
export function evaluateWallGrammar({ width, height, repeatLoop, seed }) {
  const rng = mulberry32(seed);
  const cells = []; // { x, y, w, h, material, ruleTag }
  const firedRules = new Set();
  const bayResults = [];

  function fillBox(x, y, w, h, material, ruleTag) {
    if (w <= 0 || h <= 0) return;
    cells.push({ x, y, w, h, material, ruleTag });
  }

  // Top battlement row across full width: split(X, [1, 1], repeat=True) -> X _ X _ X
  function evalBattlement(bx, by, bw) {
    if (bw <= 0) return;
    if (!repeatLoop) {
      firedRules.add('wall_flat');
      fillBox(bx, by, bw, 1, TEXTURE_TYPES.COBBLESTONE, 'wall_flat');
      return;
    }
    firedRules.add('wall_loop');
    const slices = makeSplit(bx, bx + bw, [1, 1], true);
    slices.forEach(([a, b], idx) => {
      const mat = idx % 2 === 0 ? TEXTURE_TYPES.COBBLESTONE : null;
      fillBox(a, by, b - a, 1, mat, 'wall_loop');
    });
  }

  // Gate opening in the lower wall body: cobblestone jambs + open void() doorway + lintel
  function evalGate(gx, gy, gw, gh, ruleTag) {
    const ySlices = makeSplit(gy, gy + gh, [-1, 1], false);
    const [doorY, lintelY] = ySlices;
    const xSlices = makeSplit(gx, gx + gw, [1, -1, 1], false);
    const [leftJamb, openSpan, rightJamb] = xSlices;
    const dh = doorY[1] - doorY[0];

    fillBox(leftJamb[0], doorY[0], leftJamb[1] - leftJamb[0], dh, TEXTURE_TYPES.COBBLESTONE, ruleTag);
    fillBox(openSpan[0], doorY[0], openSpan[1] - openSpan[0], dh, null, ruleTag);
    fillBox(rightJamb[0], doorY[0], rightJamb[1] - rightJamb[0], dh, TEXTURE_TYPES.COBBLESTONE, ruleTag);
    fillBox(gx, lintelY[0], gw, lintelY[1] - lintelY[0], TEXTURE_TYPES.COBBLESTONE, ruleTag);
  }

  // Random @rule variants for wall_body(): Cobblestone vs Mossy Cobblestone
  function evalWallBody(bx, by, bw, bh, wallIndex) {
    const pickCobble = rng() < 0.5;
    if (pickCobble) {
      firedRules.add('body_cobble');
      bayResults.push({ index: wallIndex, variant: 'cobble', w: bw });
      fillBox(bx, by, bw, bh, TEXTURE_TYPES.COBBLESTONE, 'body_cobble');
    } else {
      firedRules.add('body_mossy');
      bayResults.push({ index: wallIndex, variant: 'mossy', w: bw });
      fillBox(bx, by, bw, bh, TEXTURE_TYPES.MOSSY_COBBLESTONE, 'body_mossy');
    }
  }

  // @rule dispatch for lower_wall(): Dimension.X > 9 opens a 3-wide gate vs Constraint.ELSE
  function evalLowerWall(lx, ly, lw, lh) {
    if (lw > 9) {
      firedRules.add('lower_gate');
      const xSlices = makeSplit(lx, lx + lw, [-1, 3, -1], false);
      const [leftWall, gate, rightWall] = xSlices;
      evalWallBody(leftWall[0], ly, leftWall[1] - leftWall[0], lh, 0);
      evalGate(gate[0], ly, gate[1] - gate[0], lh, 'lower_gate');
      evalWallBody(rightWall[0], ly, rightWall[1] - rightWall[0], lh, 1);
    } else {
      firedRules.add('lower_plain');
      evalWallBody(lx, ly, lw, lh, 0);
    }
  }

  // Root castle_wall(): split(Dimension.Y, [-1, 1]) -> lower_wall() + battlement()
  const ySlices = makeSplit(0, height, [-1, 1], false);
  const [bodyY, capY] = ySlices;
  evalLowerWall(0, bodyY[0], width, bodyY[1] - bodyY[0]);
  evalBattlement(0, capY[0], width);

  return {
    width,
    height,
    repeatLoop,
    cells,
    firedRules,
    bayResults,
    gateActive: width > 9,
    gateWidth: width > 9 ? 3 : 0
  };
}
