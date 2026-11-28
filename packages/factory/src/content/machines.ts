/**
 * The numbers every kind of piece shares: how long gathering, burning and studying take, the grades,
 * how far power reaches, and what a machine, a boiler and a Study keep by them. What each kind is,
 * costs and does is its own module's (`kinds/<kind>.ts`), numbered in `kinds/list.ts`.
 */

/**
 * Ticks for a gatherer to gather one thing, for a boiler to burn one piece, and for a Study to take
 * in one folio, at grade 1; a belt at grade 1 carries a thing across a tile in 4. A gatherer is a
 * little slower than the mill it feeds (see the recipes), so at first it is the gatherer that sets a
 * line's pace; gatherers and machines of higher grades then take turns at being what holds a line back.
 */
export const TICKS = { gather: 15, burn: 20, study: 50 } as const;
/** Eighths of a tile across: a thing on a belt has crossed its tile at so many. */
export const ACROSS = 8;

/**
 * Grades 1 to 4, against grade 1: how fast a piece that works works and what it costs (`pace`,
 * `price`), how fast a piece of a line carries and what it costs (`carry`, `linePrice`: a belt,
 * tunnel, splitter, joiner or sorter), and the power it draws. Grade 4 is for lines and gatherers
 * alone: nothing unlocks it for a machine. Its line carries a tile a tick, the fastest a line can
 * go, as a line carries 600 a minute over the whole ticks a thing takes across a tile (`carried`).
 */
export const GRADES = [
  { pace: 1, price: 1, carry: 1, linePrice: 1, draw: 1 },
  { pace: 1.5, price: 3, carry: 1.5, linePrice: 3, draw: 1.5 },
  { pace: 2, price: 8, carry: 2, linePrice: 8, draw: 2 },
  { pace: 2.5, price: 20, carry: 4, linePrice: 40, draw: 3 },
] as const;
/** How far power reaches from the depot and from a pylon, and how far apart two joined pylons may stand, in hundredths of a tile. */
export const REACH = { depot: 660, pylon: 460, link: 810 } as const;
/** How many recipes' worth of each part a machine keeps by it, how much fuel a boiler holds, and how many of each folio a Study holds. */
export const BUFFER = 4;
export const FUEL = 8;
export const STUDY_HOLDS = 20;
/** The most tiles across and down a blueprint holds. */
export const BLUEPRINT = { w: 32, h: 24 } as const;
/** The most pieces one `stand` command carries: Leaf reads a command of at most 16 KiB. */
export const STAND_MOST = 160;
