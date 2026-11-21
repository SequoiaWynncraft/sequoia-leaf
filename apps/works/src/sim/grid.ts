/** The four ways a thing on the grid can face, and what lies each way: east, south, west, north. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS = [0, 1, 2, 3] as const;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
/** A quarter turn to the right of each way, the way behind it, and a quarter turn to the left. */
export const RIGHT = [1, 2, 3, 0] as const;
export const BACK = [2, 3, 0, 1] as const;
export const LEFT = [3, 0, 1, 2] as const;

export const isDir = (v: unknown): v is Dir => v === 0 || v === 1 || v === 2 || v === 3;
