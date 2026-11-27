/**
 * grammar_spec.js
 * Exact 7-column Box-Split Grammar specification, 84-cell partition data,
 * and single-pane tower.py line definitions for Steps 1..4.
 */

export const TOWER_COLS = 7;
export const TOWER_ROWS = 12;

export const ROOT_BOX = { x: 0, y: 0, w: TOWER_COLS, h: TOWER_ROWS };

export const VERTICAL_CUTS = [1, 2, 3, 4, 5, 6].map((x) => ({
  axis: 'V',
  at: x,
  from: 0,
  to: TOWER_ROWS
}));

const WINDOW_CUT_YS = [2, 3, 5, 6, 8, 9, 11];

export const COLUMN_H_CUTS = {
  0: [{ axis: 'H', at: 8, from: 0, to: 1 }],
  1: [{ axis: 'H', at: 1, from: 1, to: 2 }],
  2: WINDOW_CUT_YS.map((y) => ({ axis: 'H', at: y, from: 2, to: 3 })),
  3: [{ axis: 'H', at: 1, from: 3, to: 4 }],
  4: WINDOW_CUT_YS.map((y) => ({ axis: 'H', at: y, from: 4, to: 5 })),
  5: [{ axis: 'H', at: 1, from: 5, to: 6 }],
  6: [{ axis: 'H', at: 8, from: 6, to: 7 }]
};

export const ALL_H_CUTS = [
  ...COLUMN_H_CUTS[0],
  ...COLUMN_H_CUTS[1],
  ...COLUMN_H_CUTS[2],
  ...COLUMN_H_CUTS[3],
  ...COLUMN_H_CUTS[4],
  ...COLUMN_H_CUTS[5],
  ...COLUMN_H_CUTS[6]
];

export const ALL_CUTS = [...VERTICAL_CUTS, ...ALL_H_CUTS];

function windowColumnSubboxes(col) {
  return [
    { col, x: col, y: 0, w: 1, h: 2, text: '2', filled: false },
    { col, x: col, y: 2, w: 1, h: 1, text: '1', filled: true, material: 'stone_bricks' },
    { col, x: col, y: 3, w: 1, h: 2, text: '2', filled: false },
    { col, x: col, y: 5, w: 1, h: 1, text: '1', filled: true, material: 'stone_bricks' },
    { col, x: col, y: 6, w: 1, h: 2, text: '2', filled: false },
    { col, x: col, y: 8, w: 1, h: 1, text: '1', filled: true, material: 'stone_bricks' },
    { col, x: col, y: 9, w: 1, h: 2, text: '2', filled: false },
    { col, x: col, y: 11, w: 1, h: 1, text: '1', filled: true, material: 'stone_bricks' }
  ];
}

export const ALL_SUBBOXES = [
  // Col 0
  { col: 0, x: 0, y: 0, w: 1, h: 8, text: '8', filled: false },
  { col: 0, x: 0, y: 8, w: 1, h: 4, text: '4', filled: true, material: 'cobblestone_wall' },
  // Col 1
  { col: 1, x: 1, y: 0, w: 1, h: 1, text: '1', filled: true, material: 'cobblestone_wall' },
  { col: 1, x: 1, y: 1, w: 1, h: 11, text: '11', filled: true, material: 'stone_bricks' },
  // Col 2
  ...windowColumnSubboxes(2),
  // Col 3
  { col: 3, x: 3, y: 0, w: 1, h: 1, text: '1', filled: true, material: 'cobblestone_wall' },
  { col: 3, x: 3, y: 1, w: 1, h: 11, text: '11', filled: true, material: 'stone_bricks' },
  // Col 4
  ...windowColumnSubboxes(4),
  // Col 5
  { col: 5, x: 5, y: 0, w: 1, h: 1, text: '1', filled: true, material: 'cobblestone_wall' },
  { col: 5, x: 5, y: 1, w: 1, h: 11, text: '11', filled: true, material: 'stone_bricks' },
  // Col 6
  { col: 6, x: 6, y: 0, w: 1, h: 8, text: '8', filled: false },
  { col: 6, x: 6, y: 8, w: 1, h: 4, text: '4', filled: true, material: 'cobblestone_wall' }
];

export const DRAG_1_REGION = { x: 1, y: 1, w: 1, h: 11, material: 'stone_bricks' };
export const DRAG_2_REGION = { x: 2, y: 2, w: 1, h: 1, material: 'stone_bricks' };

export const ALL_FILLED_REGIONS = ALL_SUBBOXES.filter((b) => b.filled);
export const ALL_VOID_REGIONS = ALL_SUBBOXES.filter((b) => !b.filled);

export const REST_FILLED_REGIONS = ALL_FILLED_REGIONS.filter(
  (b) =>
    !(b.x === DRAG_1_REGION.x && b.y === DRAG_1_REGION.y) &&
    !(b.x === DRAG_2_REGION.x && b.y === DRAG_2_REGION.y)
);

const kw = (s) => `<span class="kw">${s}</span>`;
const fn = (s) => `<span class="fn">${s}</span>`;
const dim = (s) => `<span class="dim">${s}</span>`;
const num = (s) => `<span class="num">${s}</span>`;
const con = (s) => `<span class="const">${s}</span>`;
const cmt = (s) => `<span class="cmt">${s}</span>`;
const sp = (n) => '&nbsp;'.repeat(n);

const VOID_CALL = `${fn('void')}()`;
const FILL_BRICKS = `<span class="drag-snippet">${fn('fill')}(${con('STONE_BRICKS')})</span>`;
const FILL_WALL = `${fn('fill')}(${con('COBBLESTONE_WALL')})`;

/**
 * Step 1: 3 lines (@rule, def tower():, void())
 * Step 2: 9 lines (@rule, def tower():, split(X, [1..1]): + 7 void() lines)
 * Steps 3 & 4: 22 lines (expanded per-slice Dimension.Y splits)
 */
export const CODE_STEP_1 = [
  { id: 's1-dec', html: kw('@rule'), boxes: [ROOT_BOX] },
  { id: 's1-def', html: `${kw('def')} ${fn('tower')}():`, boxes: [ROOT_BOX] },
  { id: 's1-void', html: `${sp(2)}${VOID_CALL}`, boxes: [ROOT_BOX] }
];

export const CODE_STEP_2 = [
  { id: 's2-dec', html: kw('@rule'), boxes: [ROOT_BOX] },
  { id: 's2-def', html: `${kw('def')} ${fn('tower')}():`, boxes: [ROOT_BOX] },
  {
    id: 's2-split',
    html: `${sp(2)}${kw('with')} ${fn('split')}(${dim('Dimension.X')}, [${[1, 1, 1, 1, 1, 1, 1].map(() => num('1')).join(', ')}]):`,
    boxes: [ROOT_BOX]
  },
  ...[0, 1, 2, 3, 4, 5, 6].map((col) => ({
    id: `s2-col-${col}`,
    html: `${sp(4)}${VOID_CALL}`,
    boxes: [{ x: col, y: 0, w: 1, h: 12 }]
  }))
];

export const CODE_LINES = [
  {
    id: 'dec',
    html: kw('@rule'),
    boxes: [ROOT_BOX],
    blockLines: ['def', 'split-x', 'c0-split', 'c0-air', 'c0-wall', 'c1-split', 'c1-top', 'c1-bricks', 'c2-split', 'c2-gap-0', 'c2-lintel-0', 'c2-gap-1', 'c2-lintel-1', 'c2-gap-2', 'c2-lintel-2', 'c2-gap-3', 'c2-lintel-3', 'c3-split', 'c3-top', 'c3-bricks', 'slices-mirror']
  },
  {
    id: 'def',
    html: `${kw('def')} ${fn('tower')}():`,
    boxes: [ROOT_BOX],
    blockLines: ['split-x', 'c0-split', 'c0-air', 'c0-wall', 'c1-split', 'c1-top', 'c1-bricks', 'c2-split', 'c2-gap-0', 'c2-lintel-0', 'c2-gap-1', 'c2-lintel-1', 'c2-gap-2', 'c2-lintel-2', 'c2-gap-3', 'c2-lintel-3', 'c3-split', 'c3-top', 'c3-bricks', 'slices-mirror']
  },
  {
    id: 'split-x',
    html: `${sp(2)}${kw('with')} ${fn('split')}(${dim('Dimension.X')}, [${[1, 1, 1, 1, 1, 1, 1].map(() => num('1')).join(', ')}]):`,
    boxes: [ROOT_BOX],
    blockLines: ['c0-split', 'c0-air', 'c0-wall', 'c1-split', 'c1-top', 'c1-bricks', 'c2-split', 'c2-gap-0', 'c2-lintel-0', 'c2-gap-1', 'c2-lintel-1', 'c2-gap-2', 'c2-lintel-2', 'c2-gap-3', 'c2-lintel-3', 'c3-split', 'c3-top', 'c3-bricks', 'slices-mirror']
  },
  {
    id: 'c0-split',
    html: `${sp(4)}${kw('with')} ${fn('split')}(${dim('Dimension.Y')}, [${num('8')}, ${num('4')}]): ${cmt('# slice 1')}`,
    boxes: [{ x: 0, y: 0, w: 1, h: 12 }],
    blockLines: ['c0-air', 'c0-wall']
  },
  {
    id: 'c0-air',
    html: `${sp(6)}${VOID_CALL}`,
    boxes: [{ x: 0, y: 0, w: 1, h: 8 }]
  },
  {
    id: 'c0-wall',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_WALL}`,
    boxes: [{ x: 0, y: 8, w: 1, h: 4 }]
  },
  {
    id: 'c1-split',
    html: `${sp(4)}${kw('with')} ${fn('split')}(${dim('Dimension.Y')}, [${num('1')}, ${num('11')}]): ${cmt('# slice 2')}`,
    boxes: [{ x: 1, y: 0, w: 1, h: 12 }],
    blockLines: ['c1-top', 'c1-bricks']
  },
  {
    id: 'c1-top',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_WALL}`,
    boxes: [{ x: 1, y: 0, w: 1, h: 1 }]
  },
  {
    id: 'c1-bricks',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_BRICKS}`,
    dragPhase: 1,
    boxes: [DRAG_1_REGION]
  },
  {
    id: 'c2-split',
    html: `${sp(4)}${kw('with')} ${fn('split')}(${dim('Dimension.Y')}, [${[2, 1, 2, 1, 2, 1, 2, 1].map((n) => num(String(n))).join(', ')}]):`,
    boxes: [{ x: 2, y: 0, w: 1, h: 12 }],
    blockLines: ['c2-gap-0', 'c2-lintel-0', 'c2-gap-1', 'c2-lintel-1', 'c2-gap-2', 'c2-lintel-2', 'c2-gap-3', 'c2-lintel-3']
  },
  { id: 'c2-gap-0', html: `${sp(6)}${VOID_CALL}`, boxes: [{ x: 2, y: 0, w: 1, h: 2 }] },
  {
    id: 'c2-lintel-0',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_BRICKS}`,
    dragPhase: 2,
    boxes: [DRAG_2_REGION]
  },
  { id: 'c2-gap-1', html: `${sp(6)}${VOID_CALL}`, boxes: [{ x: 2, y: 3, w: 1, h: 2 }] },
  { id: 'c2-lintel-1', html: `${sp(6)}${VOID_CALL}`, filledHtml: `${sp(6)}${FILL_BRICKS}`, boxes: [{ x: 2, y: 5, w: 1, h: 1 }] },
  { id: 'c2-gap-2', html: `${sp(6)}${VOID_CALL}`, boxes: [{ x: 2, y: 6, w: 1, h: 2 }] },
  { id: 'c2-lintel-2', html: `${sp(6)}${VOID_CALL}`, filledHtml: `${sp(6)}${FILL_BRICKS}`, boxes: [{ x: 2, y: 8, w: 1, h: 1 }] },
  { id: 'c2-gap-3', html: `${sp(6)}${VOID_CALL}`, boxes: [{ x: 2, y: 9, w: 1, h: 2 }] },
  { id: 'c2-lintel-3', html: `${sp(6)}${VOID_CALL}`, filledHtml: `${sp(6)}${FILL_BRICKS}`, boxes: [{ x: 2, y: 11, w: 1, h: 1 }] },
  {
    id: 'c3-split',
    html: `${sp(4)}${kw('with')} ${fn('split')}(${dim('Dimension.Y')}, [${num('1')}, ${num('11')}]): ${cmt('# slice 4')}`,
    boxes: [{ x: 3, y: 0, w: 1, h: 12 }],
    blockLines: ['c3-top', 'c3-bricks']
  },
  {
    id: 'c3-top',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_WALL}`,
    boxes: [{ x: 3, y: 0, w: 1, h: 1 }]
  },
  {
    id: 'c3-bricks',
    html: `${sp(6)}${VOID_CALL}`,
    filledHtml: `${sp(6)}${FILL_BRICKS}`,
    boxes: [{ x: 3, y: 1, w: 1, h: 11 }]
  },
  {
    id: 'slices-mirror',
    html: `${sp(4)}${cmt('# ... slices 5–7 mirror slices 3–1')}`,
    boxes: [
      { x: 4, y: 0, w: 1, h: 12 },
      { x: 5, y: 0, w: 1, h: 12 },
      { x: 6, y: 0, w: 1, h: 12 }
    ]
  }
];
