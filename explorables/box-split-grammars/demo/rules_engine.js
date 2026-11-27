/**
 * rules_engine.js
 * Implements Box-Split Grammar execution faithful to SplitGrammar.py:
 * - makeSplit with positive (absolute) and negative (proportional) sizes + repeat=True
 * - @rule constraint dispatch + Constraint.ELSE fallback
 * - Weighted nondeterministic selection with deterministic seeded PRNG
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
 * Allocates positive absolute sizes first, then divides remaining space across
 * negative relative weights, distributing integer remainder from the start.
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
 * Execute the interactive wall grammar for given dimensions, loop toggle, and seed.
 * Returns placed cells plus execution metadata for highlighting rules in the code panel.
 */
export function evaluateWallGrammar({ width, height, repeatLoop, seed }) {
  const rng = mulberry32(seed);
  const cells = []; // { x, y, w, h, material, ruleTag, bayIndex }
  const firedRules = new Set();
  const bayResults = []; // track variant choices per bay

  // Coordinate convention for elevation rendering:
  // x: 0..width (left to right), y: 0..height (bottom=0 to top=height-1)
  function fillBox(x, y, w, h, material, ruleTag, bayIndex = null) {
    if (w <= 0 || h <= 0) return;
    cells.push({ x, y, w, h, material, ruleTag, bayIndex });
  }

  // @rule dispatch for bay()
  function evalBay(bx, by, bw, bh, bayIndex) {
    if (bw >= 3) {
      const pickWindow = rng() < 0.5;
      if (pickWindow) {
        firedRules.add('bay_window');
        bayResults.push({ index: bayIndex, variant: 'window', w: bw });
        // with split(Dimension.X, [1, -1, 1]):
        const slices = makeSplit(bx, bx + bw, [1, -1, 1], false);
        const [s0, s1, s2] = slices;
        fillBox(s0[0], by, s0[1] - s0[0], bh, TEXTURE_TYPES.OAK_PLANKS, 'bay_window', bayIndex);
        fillBox(s1[0], by, s1[1] - s1[0], bh, TEXTURE_TYPES.GLASS, 'bay_window', bayIndex);
        fillBox(s2[0], by, s2[1] - s2[0], bh, TEXTURE_TYPES.OAK_PLANKS, 'bay_window', bayIndex);
      } else {
        firedRules.add('bay_timber');
        bayResults.push({ index: bayIndex, variant: 'timber', w: bw });
        // with split(Dimension.X, [-1, 1, -1]):
        const slices = makeSplit(bx, bx + bw, [-1, 1, -1], false);
        const [s0, s1, s2] = slices;
        fillBox(s0[0], by, s0[1] - s0[0], bh, TEXTURE_TYPES.OAK_PLANKS, 'bay_timber', bayIndex);
        fillBox(s1[0], by, s1[1] - s1[0], bh, TEXTURE_TYPES.OAK_LOG, 'bay_timber', bayIndex);
        fillBox(s2[0], by, s2[1] - s2[0], bh, TEXTURE_TYPES.OAK_PLANKS, 'bay_timber', bayIndex);
      }
    } else {
      // @rule(constraint=Constraint.ELSE)
      firedRules.add('bay_narrow');
      bayResults.push({ index: bayIndex, variant: 'narrow', w: bw });
      fillBox(bx, by, bw, bh, TEXTURE_TYPES.OAK_PLANKS, 'bay_narrow', bayIndex);
    }
  }

  // @rule dispatch for center()
  function evalCenter(cx, cy, cw, ch) {
    if (repeatLoop) {
      firedRules.add('center_loop');
      const slices = makeSplit(cx, cx + cw, [3], true);
      slices.forEach(([a, b], idx) => {
        evalBay(a, cy, b - a, ch, idx);
      });
    } else {
      firedRules.add('center_single');
      evalBay(cx, cy, cw, ch, 0);
    }
  }

  // @rule dispatch for wall()
  if (width >= 7) {
    firedRules.add('wall_wide');
    // with split(Dimension.X, [1, -1, 1]):
    const xSlices = makeSplit(0, width, [1, -1, 1], false);
    const [leftPillar, midSpan, rightPillar] = xSlices;

    fillBox(leftPillar[0], 0, leftPillar[1] - leftPillar[0], height, TEXTURE_TYPES.OAK_LOG, 'wall_wide_pillar');
    fillBox(rightPillar[0], 0, rightPillar[1] - rightPillar[0], height, TEXTURE_TYPES.OAK_LOG, 'wall_wide_pillar');

    // Interior: with split(Dimension.Y, [1, -1, 1]):
    const mx = midSpan[0];
    const mw = midSpan[1] - midSpan[0];
    const ySlices = makeSplit(0, height, [1, -1, 1], false);
    const [baseSlice, midY, topSlice] = ySlices;

    fillBox(mx, baseSlice[0], mw, baseSlice[1] - baseSlice[0], TEXTURE_TYPES.COBBLESTONE, 'wall_wide_base');
    evalCenter(mx, midY[0], mw, midY[1] - midY[0]);
    fillBox(mx, topSlice[0], mw, topSlice[1] - topSlice[0], TEXTURE_TYPES.OAK_LOG, 'wall_wide_top');
  } else {
    // @rule(constraint=Constraint.ELSE)
    firedRules.add('wall_narrow');
    const xSlices = makeSplit(0, width, [1, -1, 1], false);
    const [leftPillar, midSpan, rightPillar] = xSlices;
    fillBox(leftPillar[0], 0, leftPillar[1] - leftPillar[0], height, TEXTURE_TYPES.OAK_LOG, 'wall_narrow');
    fillBox(midSpan[0], 0, midSpan[1] - midSpan[0], height, TEXTURE_TYPES.COBBLESTONE, 'wall_narrow');
    fillBox(rightPillar[0], 0, rightPillar[1] - rightPillar[0], height, TEXTURE_TYPES.OAK_LOG, 'wall_narrow');
  }

  return {
    width,
    height,
    repeatLoop,
    cells,
    firedRules,
    bayResults,
    wideActive: width >= 7
  };
}
