/**
 * The board: hexes in offset rows, seven across and eight deep in a fight (four rows a side), cut
 * into the rings of the stump. Odd rows sit half a hex to the right.
 *
 * A hex in a fight is one number, a cell: `row * 7 + col`, rows counted from the far side. The
 * party at the table has rows 4 to 7 and the party across has rows 0 to 3, so the two front lines
 * are rows 4 and 3. Turning the board half round (`mirror`) puts every hex exactly on another, so
 * neither seat is better.
 *
 * A place on a party's own half is a number too, a seat: `row * 7 + col` with row 0 its front line
 * and row 3 its back. `seatCell` says where a seat is once the two halves are pushed together.
 */
export const COLS = 7;
export const ROWS = 8;
export const HOME_ROWS = 4;
export const CELLS = COLS * ROWS;
export const SEATS = COLS * HOME_ROWS;

export type Side = 0 | 1;

export const cellAt = (col: number, row: number): number => row * COLS + col;
export const colOf = (cell: number): number => cell % COLS;
export const rowOf = (cell: number): number => Math.floor(cell / COLS);
export const onBoard = (col: number, row: number): boolean => col >= 0 && col < COLS && row >= 0 && row < ROWS;
/** The same hex seen from the other seat: the board turned half round. */
export const mirror = (cell: number): number => CELLS - 1 - cell;
/** Where a seat on a party's own half is in a fight: our front line is row 4, theirs row 3. */
export const seatCell = (side: Side, seat: number): number => (side === 0 ? seat + SEATS : SEATS - 1 - seat);
/** The seat a fight cell is for a side, or -1 if the cell is on the other half. */
export const cellSeat = (side: Side, cell: number): number => {
  const seat = side === 0 ? cell - SEATS : SEATS - 1 - cell;
  return seat >= 0 && seat < SEATS ? seat : -1;
};
/** The back row of a side's half in a fight. */
export const backRow = (side: Side): number => (side === 0 ? ROWS - 1 : 0);

/** The middle of a hex, in hex widths: for drawing, and for the angles of a cone. */
export const centre = (cell: number): { x: number; y: number } => {
  const row = rowOf(cell);
  return { x: colOf(cell) + (row % 2 === 1 ? 0.5 : 0), y: row * 0.8660254037844386 };
};

/** Steps to the six hexes round one, as (col, row), for even rows and for odd rows. */
const AROUND_EVEN = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;
const AROUND_ODD = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
] as const;

/** A hex as cube coordinates, where straight lines and distances are plain sums. */
const cube = (cell: number): [number, number, number] => {
  const row = rowOf(cell);
  const x = colOf(cell) - (row - (row % 2)) / 2;
  return [x, -x - row, row];
};

const neighbourTable: number[][] = [];
const distances = new Uint8Array(CELLS * CELLS);
for (let cell = 0; cell < CELLS; cell++) {
  const col = colOf(cell);
  const row = rowOf(cell);
  const list: number[] = [];
  for (const [dc, dr] of row % 2 === 1 ? AROUND_ODD : AROUND_EVEN) {
    if (onBoard(col + dc, row + dr)) list.push(cellAt(col + dc, row + dr));
  }
  neighbourTable.push(list);
  const [ax, ay, az] = cube(cell);
  for (let other = 0; other < CELLS; other++) {
    const [bx, by, bz] = cube(other);
    distances[cell * CELLS + other] = Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  }
}
/** The same lists, in the order the other seat would have met them, so both sides walk alike. */
const mirroredTable: number[][] = neighbourTable.map((_, cell) =>
  (neighbourTable[mirror(cell)] ?? []).map((n) => mirror(n)),
);
const NONE: readonly number[] = [];

/** The hexes touching one, at most six. */
export const neighbours = (cell: number): readonly number[] => neighbourTable[cell] ?? NONE;
/** The hexes touching one, in the order a side tries them when it walks. */
export const neighboursFor = (side: Side, cell: number): readonly number[] =>
  (side === 0 ? neighbourTable[cell] : mirroredTable[cell]) ?? NONE;
/** How many steps apart two hexes are. */
export const distance = (a: number, b: number): number => distances[a * CELLS + b] ?? 0;
/** Whether two hexes touch. */
export const touching = (a: number, b: number): boolean => distance(a, b) === 1;

/** Every hex within some steps of one, nearest first, itself left out. */
export function within(cell: number, steps: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= steps; d++) {
    for (let other = 0; other < CELLS; other++) if (distance(cell, other) === d) out.push(other);
  }
  return out;
}

/** The hexes exactly some steps from one: a ring. */
export function ring(cell: number, steps: number): number[] {
  const out: number[] = [];
  for (let other = 0; other < CELLS; other++) if (distance(cell, other) === steps) out.push(other);
  return out;
}

/**
 * A straight line of hexes from one hex toward another and on past it: up to `length` hexes,
 * starting with the one after `from`, stopping at the edge of the board.
 */
export function line(from: number, toward: number, length: number): number[] {
  const n = distance(from, toward);
  if (n === 0) return [];
  const [ax, ay, az] = cube(from);
  const [bx, by, bz] = cube(toward);
  // A nudge off the exact middle, so a line that runs along the edge between two hexes always picks the same one.
  const dx = (bx - ax + 1e-6) / n;
  const dy = (by - ay + 2e-6) / n;
  const dz = (bz - az - 3e-6) / n;
  const out: number[] = [];
  for (let k = 1; k <= length; k++) {
    const x = ax + dx * k;
    const y = ay + dy * k;
    const z = az + dz * k;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const ex = Math.abs(rx - x);
    const ey = Math.abs(ry - y);
    const ez = Math.abs(rz - z);
    if (ex > ey && ex > ez) rx = -ry - rz;
    else if (ey > ez) ry = -rx - rz;
    else rz = -rx - ry;
    const col = rx + (rz - (((rz % 2) + 2) % 2)) / 2;
    if (!onBoard(col, rz)) break;
    out.push(cellAt(col, rz));
  }
  return out;
}

/** cos² of the half-angle of a cone: a little over thirty degrees either side of where it points. */
const CONE = 0.72;
/**
 * A cone of hexes opening from one hex toward another, `depth` hexes deep: one hex wide where it
 * starts, three wide at two deep, three again at three.
 */
export function cone(from: number, toward: number, depth: number): number[] {
  if (from === toward) return [];
  const a = centre(from);
  const b = centre(toward);
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const tt = tx * tx + ty * ty;
  const out: number[] = [];
  for (let d = 1; d <= depth; d++) {
    for (let other = 0; other < CELLS; other++) {
      if (distance(from, other) !== d) continue;
      const c = centre(other);
      const ox = c.x - a.x;
      const oy = c.y - a.y;
      const dot = ox * tx + oy * ty;
      if (dot > 0 && dot * dot >= CONE * tt * (ox * ox + oy * oy)) out.push(other);
    }
  }
  return out;
}

/**
 * The first step of the shortest way from `from` to any free hex within `reach` of `goal`, walking
 * round hexes that are taken. If nothing that close can be reached, the first step toward the free
 * hex that gets nearest; if nothing gets nearer than standing still, -1.
 *
 * `taken` has one entry a cell: -1 where the hex is free.
 */
const seen = new Int32Array(CELLS);
const queue = new Uint8Array(CELLS);
const first = new Uint8Array(CELLS);
let stamp = 0;
export function stepToward(side: Side, taken: readonly number[], from: number, goal: number, reach: number): number {
  stamp++;
  seen[from] = stamp;
  queue[0] = from;
  let head = 0;
  let tail = 1;
  let best = -1;
  let bestAway = distance(from, goal);
  while (head < tail) {
    const here = queue[head++] ?? 0;
    for (const next of neighboursFor(side, here)) {
      if (seen[next] === stamp || taken[next] !== -1) continue;
      seen[next] = stamp;
      const step = here === from ? next : (first[here] ?? next);
      first[next] = step;
      const away = distance(next, goal);
      if (away <= reach) return step;
      if (away < bestAway) {
        bestAway = away;
        best = step;
      }
      queue[tail++] = next;
    }
  }
  return best;
}

/** How many steps it is from one hex to another walking round hexes that are taken; -1 if there is no way. */
export function walkLength(taken: readonly number[], from: number, to: number): number {
  if (from === to) return 0;
  stamp++;
  seen[from] = stamp;
  queue[0] = from;
  first[from] = 0;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const here = queue[head++] ?? 0;
    for (const next of neighbours(here)) {
      if (seen[next] === stamp) continue;
      seen[next] = stamp;
      first[next] = (first[here] ?? 0) + 1;
      if (next === to) return first[next] ?? -1;
      if (taken[next] !== -1) continue;
      queue[tail++] = next;
    }
  }
  return -1;
}
