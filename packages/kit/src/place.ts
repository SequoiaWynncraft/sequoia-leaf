/**
 * Where a card goes: the one rule every card and tip in every game is placed by, with no page in
 * it. A box beside a thing never overlaps the thing and stays inside the window: above it where it
 * fits whole, else below, else to a side (with `side`, a side first), staying on the side it was on
 * when it is drawn again (`was`). Where it fits whole nowhere, it takes the largest room beside the
 * thing, no taller than that room (it scrolls). Under a finger the box is a sheet the window's
 * width, along the bottom (above the game's bar, `floor`), or along the top (under what hangs from
 * the game's top bar, `ceiling`) where the bottom would cover the thing.
 *
 * Only a thing covering the window so that no room is left beside it is ever overlapped.
 */

/** A box on the page, in CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The window, in CSS pixels; for a sheet, the height of the game's bar along its bottom, and where what hangs from its top ends. */
export interface Room {
  readonly w: number;
  readonly h: number;
  readonly floor?: number;
  readonly ceiling?: number;
}

/** Which side of the thing a box went to. */
export type Side = "above" | "below" | "right" | "left";

/** Where a box goes: its corner, the side it is on, and the most it may be tall there (the room on that side). */
export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly side: Side;
  readonly most: number;
}

/** Where a sheet goes: along the bottom or the top, and the most it may be tall there. */
export interface Sheeted {
  readonly edge: "top" | "bottom";
  readonly most: number;
}

/** From the window's edge to any box. */
export const EDGE = 4;
/** From a thing to the box beside it. */
export const GAP = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/** The thing as much as is inside the window: a thing partly off it is beside only what shows. */
function within(at: Box, room: Room): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = clamp(at.x, 0, room.w);
  const y0 = clamp(at.y, 0, room.h);
  return { x0, y0, x1: clamp(at.x + at.w, x0, room.w), y1: clamp(at.y + at.h, y0, room.h) };
}

/** How wide and tall the room on each side of a thing is, for a box. */
function rooms(t: ReturnType<typeof within>, room: Room): Record<Side, { w: number; h: number }> {
  const across = room.w - 2 * EDGE;
  const down = room.h - 2 * EDGE;
  return {
    above: { w: across, h: t.y0 - GAP - EDGE },
    below: { w: across, h: room.h - EDGE - (t.y1 + GAP) },
    right: { w: room.w - EDGE - (t.x1 + GAP), h: down },
    left: { w: t.x0 - GAP - EDGE, h: down },
  };
}

/** The order the sides are tried in: the one it was on first, then a side first with `side`, else above first. */
function order(side: boolean, was: Side | undefined): Side[] {
  const sides: Side[] = side ? ["right", "left", "above", "below"] : ["above", "below", "right", "left"];
  return was ? [was, ...sides.filter((s) => s !== was)] : sides;
}

/** A box of `size` on `s` of the thing, `h` tall at most: its corner, inside the window. */
function put(s: Side, size: { w: number; h: number }, t: ReturnType<typeof within>, room: Room, top: boolean): Placed {
  const space = rooms(t, room)[s].h;
  const h = Math.min(size.h, space);
  const xMid = clamp((t.x0 + t.x1) / 2 - size.w / 2, EDGE, room.w - EDGE - size.w);
  // Beside the thing, level with its top where asked to go to a side, else level with its middle.
  const ySide = clamp(top ? t.y0 : (t.y0 + t.y1) / 2 - h / 2, EDGE, room.h - EDGE - h);
  const corner: Record<Side, { x: number; y: number }> = {
    above: { x: xMid, y: t.y0 - GAP - h },
    below: { x: xMid, y: t.y1 + GAP },
    right: { x: t.x1 + GAP, y: ySide },
    left: { x: t.x0 - GAP - size.w, y: ySide },
  };
  // The most it may be is all the room there is on that side: a box whose words come late (a font) still fits.
  return { x: Math.round(corner[s].x), y: Math.round(corner[s].y), side: s, most: Math.floor(space) };
}

/**
 * Where a box of `size` goes beside `thing` in `room`. With `side`, to a side first; with `was`,
 * on the side it was on, where it still fits.
 */
export function beside(
  size: { readonly w: number; readonly h: number },
  thing: Box,
  room: Room,
  opts: { readonly side?: boolean; readonly was?: Side } = {},
): Placed {
  const t = within(thing, room);
  const space = rooms(t, room);
  const tried = order(opts.side ?? false, opts.was);
  const top = opts.side ?? false;
  const whole = tried.find((s) => space[s].w >= size.w && space[s].h >= size.h);
  if (whole) return put(whole, size, t, room, top);
  // Nowhere whole: the side with the most room that is wide enough, as tall as that room.
  const wide = tried.filter((s) => space[s].w >= size.w && space[s].h > 0);
  const most = wide.toSorted((a, b) => space[b].h - space[a].h)[0];
  if (most) return put(most, size, t, room, top);
  // No room beside it at all (it covers the window): inside the window, over it.
  return {
    x: Math.round(clamp(t.x0, EDGE, room.w - EDGE - size.w)),
    y: EDGE,
    side: "below",
    most: Math.floor(room.h - 2 * EDGE),
  };
}

/** Whether a box placed at `corner`, `size` big, is inside the window and clear of the thing. */
export function clear(
  corner: { x: number; y: number },
  size: { w: number; h: number },
  thing: Box,
  room: Room,
): boolean {
  const t = within(thing, room);
  const inside =
    corner.x >= EDGE - 0.5 &&
    corner.y >= EDGE - 0.5 &&
    corner.x + size.w <= room.w - EDGE + 0.5 &&
    corner.y + size.h <= room.h - EDGE + 0.5;
  const apart = corner.x >= t.x1 || corner.x + size.w <= t.x0 || corner.y >= t.y1 || corner.y + size.h <= t.y0;
  return inside && apart;
}

/**
 * Where a sheet `h` tall goes for `thing` (none: a thing with no place, the bottom): along the
 * bottom unless that covers the thing, then along the top unless that does, and else on whichever
 * leaves it the more room, no taller than that.
 */
export function sheet(h: number, thing: Box | null, room: Room): Sheeted {
  const floor = room.floor ?? 0;
  const ceiling = room.ceiling ?? 0;
  const full = room.h - floor - EDGE;
  if (!thing) return { edge: "bottom", most: Math.floor(full) };
  const t = within(thing, room);
  const under = room.h - floor - (t.y1 + GAP);
  const over = t.y0 - GAP - ceiling;
  if (h <= under) return { edge: "bottom", most: Math.floor(Math.min(full, under)) };
  if (h <= over) return { edge: "top", most: Math.floor(Math.min(full, over)) };
  return under >= over
    ? { edge: "bottom", most: Math.floor(Math.max(0, under)) }
    : { edge: "top", most: Math.floor(over) };
}
