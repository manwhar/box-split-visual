/**
 * rules_engine.js
 * Faithful Box-Split Grammar evaluators for the three focused Castle Wall slides:
 *   - evaluateConstraintsWall(width, height): @rule(constraint=Dimension.X > 9) vs Constraint.ELSE
 *   - evaluateLoopsWall(width, repeatLoop, height): split(Dimension.X, [1, 1], repeat=True) while loop
 *   - evaluateVariantsWall(seed, width, height): weighted probabilistic @rule selection
 *
 * Uses top-down grid coordinates: x in [0..width-1], y in [0..height-1] (y=0 is top row).
 */

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
 * Port of SplitGrammar.make_split(a, b, sizes, Rounding.START, repeat)
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
 * Mode 1: Rules & Constraints
 * @rule(constraint=Dimension.X > 9) opens a 3-wide arched castle gate between [-1, 3, -1];
 * @rule(constraint=Constraint.ELSE) builds a continuous solid stone_bricks wall.
 */
export function evaluateConstraintsWall(width, height = 6) {
  const gateActive = width > 9;
  const cells = [];
  const boxes = [];
  const solidCuts = [];
  const topLabels = [];

  if (gateActive) {
    const [[x0, x1], [gx0, gx1], [x2, x3]] = makeSplit(0, width, [-1, 3, -1], false);
    const leftW = x1 - x0;
    const gateW = gx1 - gx0;
    const rightW = x3 - x2;

    boxes.push(
      { x: 0, y: 0, w: leftW, h: height, scopeTag: 'c_left' },
      { x: gx0, y: 0, w: gateW, h: height, scopeTag: 'c_gate' },
      { x: x2, y: 0, w: rightW, h: height, scopeTag: 'c_right' }
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < gx0) {
          cells.push({ x, y, fg: 'stone_bricks', bg: null, scopeTag: 'c_left' });
        } else if (x >= x2) {
          cells.push({ x, y, fg: 'stone_bricks', bg: null, scopeTag: 'c_right' });
        } else if (y <= 1) {
          cells.push({ x, y, fg: 'stone_bricks', bg: null, scopeTag: 'c_gate' });
        } else {
          // 3-wide arched doorway: oak_planks backdrop framed by cobblestone jambs & arch corners
          const isOuter = x === gx0 || x === gx1 - 1;
          let jamb = null;
          if (isOuter) {
            const side = x === gx0 ? 'left' : 'right';
            jamb = y === 2 ? 'full' : side;
          }
          cells.push({
            x,
            y,
            fg: jamb ? 'cobblestone' : null,
            jambMode: jamb,
            bg: 'oak_planks',
            scopeTag: 'c_gate'
          });
        }
      }
    }

    solidCuts.push(
      { axis: 'V', at: gx0, from: 0, to: height },
      { axis: 'V', at: x2, from: 0, to: height }
    );

    topLabels.push(
      { x: 0, w: leftW, text: `-1 → ${leftW}` },
      { x: gx0, w: gateW, text: '3' },
      { x: x2, w: rightW, text: `-1 → ${rightW}` }
    );

    return {
      mode: 'constraints',
      width,
      height,
      gateActive: true,
      activeRuleGroup: 'rule_gate',
      inactiveRuleGroup: 'rule_else',
      hasCreneledOutline: false,
      boxes,
      cells,
      solidCuts,
      topLabels
    };
  }

  boxes.push({ x: 0, y: 0, w: width, h: height, scopeTag: 'c_else' });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({ x, y, fg: 'stone_bricks', bg: null, scopeTag: 'c_else' });
    }
  }
  topLabels.push({ x: 0, w: width, text: `Width (X) = ${width}` });

  return {
    mode: 'constraints',
    width,
    height,
    gateActive: false,
    activeRuleGroup: 'rule_else',
    inactiveRuleGroup: 'rule_gate',
    hasCreneledOutline: false,
    boxes,
    cells,
    solidCuts,
    topLabels
  };
}

/**
 * Mode 2: Repeating Splits with Loops
 * split(Dimension.Y, [-1, 1]) separates the lower wall_base() from the top row,
 * then split(Dimension.X, [1, 1], repeat=True) tiles stone_bricks / void() across Width (X).
 */
export function evaluateLoopsWall(width, repeatLoop = true, height = 6) {
  const cells = [];
  const boxes = [{ x: 0, y: 1, w: width, h: height - 1, scopeTag: 'l_base' }];
  const solidCuts = [{ axis: 'H', at: 1, from: 0, to: width }];
  const topLabels = [];

  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({ x, y, fg: 'stone_bricks', bg: null, scopeTag: 'l_base' });
    }
  }

  if (repeatLoop) {
    const slices = makeSplit(0, width, [1, 1], true);
    slices.forEach(([x0], idx) => {
      const isMerlon = idx % 2 === 0;
      const scopeTag = isMerlon ? 'l_merlon' : 'l_void';
      boxes.push({ x: x0, y: 0, w: 1, h: 1, isVoid: !isMerlon, scopeTag });
      cells.push({
        x: x0,
        y: 0,
        fg: isMerlon ? 'stone_bricks' : null,
        bg: null,
        isVoid: !isMerlon,
        scopeTag
      });
      if (x0 > 0) {
        solidCuts.push({ axis: 'V', at: x0, from: 0, to: 1 });
      }
      topLabels.push({ x: x0, w: 1, text: '1' });
    });
  } else {
    boxes.push({ x: 0, y: 0, w: width, h: 1, isVoid: false, scopeTag: 'l_flat' });
    for (let x = 0; x < width; x++) {
      cells.push({ x, y: 0, fg: 'stone_bricks', bg: null, scopeTag: 'l_flat' });
    }
    topLabels.push({ x: 0, w: width, text: `Flat (1 × ${width})` });
  }

  return {
    mode: 'loops',
    width,
    height,
    repeatLoop,
    hasCreneledOutline: false,
    boxes,
    cells,
    solidCuts,
    topLabels
  };
}

const VARIANT_RULES = [
  { cutoff: 0.60, material: 'stone_bricks', scopeTag: 'v_bricks' },
  { cutoff: 0.85, material: 'mossy_cobblestone', scopeTag: 'v_mossy' },
  { cutoff: 1.00, material: 'cobblestone', scopeTag: 'v_cobble' }
];

/**
 * Mode 3: Random Variants
 * Samples weighted wall_block() @rules across every solid block of an 11x6 battlemented wall:
 *   0.60 -> stone_bricks, 0.25 -> mossy_cobblestone, 0.15 -> cobblestone
 */
export function evaluateVariantsWall(seed = 7, width = 11, height = 6) {
  const rng = mulberry32(seed);
  const cells = [];
  const counts = { v_bricks: 0, v_mossy: 0, v_cobble: 0 };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y === 0 && x % 2 === 1) continue;
      const r = rng();
      const picked = VARIANT_RULES.find((v) => r < v.cutoff) ?? VARIANT_RULES[2];
      counts[picked.scopeTag] += 1;
      cells.push({
        x,
        y,
        fg: picked.material,
        bg: null,
        scopeTag: picked.scopeTag
      });
    }
  }

  const boxes = cells.map((c) => ({ x: c.x, y: c.y, w: 1, h: 1, scopeTag: c.scopeTag }));

  return {
    mode: 'variants',
    seed,
    width,
    height,
    hasCreneledOutline: true,
    counts,
    boxes,
    cells,
    solidCuts: [],
    topLabels: []
  };
}

/**
 * Advance seed until all 3 weighted variants appear at least once and layout differs from prevSeed.
 */
export function nextDistinctSeed(prevSeed, width = 11, height = 6) {
  const prevSig = evaluateVariantsWall(prevSeed, width, height)
    .cells.map((c) => c.scopeTag)
    .join(',');
  for (let i = 1; i <= 64; i++) {
    const candidateSeed = prevSeed + i;
    const result = evaluateVariantsWall(candidateSeed, width, height);
    const { v_bricks, v_mossy, v_cobble } = result.counts;
    if (v_bricks > 0 && v_mossy > 0 && v_cobble > 0) {
      const nextSig = result.cells.map((c) => c.scopeTag).join(',');
      if (nextSig !== prevSig) return candidateSeed;
    }
  }
  return prevSeed + 1;
}
