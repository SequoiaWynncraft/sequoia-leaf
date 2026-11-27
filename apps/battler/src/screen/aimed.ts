import type { Swing } from "@sequoia-leaf/figures/tools.ts";
/**
 * The five beats (`LOOK-BAR.md`) of an ability the rules use at once, with nothing held back, so
 * that its catch and its dread come in the lead-in the table gives it (`LOOKS[kind].wind` steps
 * before the rules say it goes off; `AIMED` has when each beat begins):
 *
 * Unc's Knock On Wood (`drum`):
 * 1. Wind-up: it leans back on its post (the `lean` body).
 * 2. The catch: one peck alone. A ring appears on the wood under its target, gold corners on that hex.
 * 3. Dread: the table dims to that hex, the ring widens, its head cocked back (its cast picture).
 * 4. Release (the step it goes off): the roll. A new ring from the edge of the last with every peck
 *    (`rings`, left by each hit); the clock held and a bump on the last.
 * 5. Aftermath: the hex keeps its rings for the fight (`woodwork.ts`); one feather comes down.
 *
 * Leetanns' Gathering Run (`swing`), one table, the tool changing only the release:
 * 1. Wind-up: it reaches back and draws the tool (`swinging` in the figures' `acts.ts`).
 * 2. The catch: it points it. Gold corners on what it is for: the target's hex; for the rod the
 *    far enemy, with a one-pixel line from the rod's tip; for the scythe the ring of hexes round it.
 * 3. Dread: the table dims to those hexes, the tool at the top of its swing, the line tight.
 * 4. Release: axe and pickaxe a crescent; the rod brings the enemy along the line; the scythe a
 *    crescent all the way round. The clock held, a bump (its look's).
 * 5. Aftermath: the tool goes over the shoulder; a chip of what was gathered lies on the hex a second.
 *
 * Which tool it has in hand is the one its last swing used, and the next once that is over
 * (`toolNow`). Everything is counted from the step it goes off, on the fight's clock.
 */
import { CREAM, GOLD, GREEN, INK, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import { type Fight, type FightEvent, type Tool, TOOLS } from "@sequoia-leaf/raid";

import { handAt } from "./acting.ts";
import { clockNow, feetAt, fightNow, FOOT, FV } from "./board.ts";
import { hexCorners } from "./call.ts";
import { burst } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { AIMED, LOOKS } from "./looks.ts";
import type { Actor } from "./motion.ts";
import type { Lead } from "./playback.ts";
import { snd } from "./sounds.ts";
import { dimRounds, hushing } from "./spells.ts";
import { V } from "./stage.ts";
import { bump, weigh } from "./weight.ts";
import { type Gathered, leave } from "./woodwork.ts";

interface Aim {
  readonly fight: Fight;
  readonly by: number;
  readonly how: "drum" | "swing";
  readonly tool: Tool | null;
  /** The hexes it is for and who stands on them, as the cast says. */
  readonly cells: readonly number[];
  readonly to: readonly number[];
  /** The step it goes off, how many hits it lands in all (a drum's pecks), and the steps between them. */
  readonly at: number;
  readonly pulses: number;
  readonly every: number;
  /** The catch's peck given; the pecks landed since. */
  pecked: boolean;
  landed: number;
}
const aims: Aim[] = [];
/** The tool each Leetanns last swung, by its id, for the fight on show. */
const swung: { fight: Fight | null; by: Map<number, number> } = { fight: null, by: new Map() };

/** The dread's pools: half the width and height of the light round each hex. */
const POOL = { rx: 12, ry: 8 } as const;

/** Begins the beats: from the lead-in to the cast, which says who and where it is for. */
export function aimAhead(l: Lead, ev: Extract<FightEvent, { t: "cast" }>): void {
  const fight = fightNow();
  if (!fight || !FV.actors[ev.id]) return;
  const how = ev.kind === "unc" ? "drum" : "swing";
  aims.push({
    fight,
    by: ev.id,
    how,
    tool: ev.tool ?? null,
    cells: ev.cells,
    to: ev.targets,
    at: l.at,
    pulses: ev.pulses ?? 1,
    every: ev.every ?? 1,
    pecked: false,
    landed: 0,
  });
}

/** The tool a Leetanns has in hand at the clock `c`, as an index of `TOOLS`: the one it swings now, else the next after its last. */
export function toolNow(a: Actor, c: number): number {
  const now = aims.find((x) => x.by === a.unit.id && x.fight === fightNow() && x.tool && c < x.at + AIMED.swing.after);
  if (now?.tool) return TOOLS.indexOf(now.tool);
  if (swung.fight !== fightNow()) return 0;
  const last = swung.by.get(a.unit.id);
  return last === undefined ? 0 : (last + 1) % TOOLS.length;
}

/**
 * The beat of its swing one that swings a tool (Leetanns) is at, at the clock `c`, from its wind-up
 * (`Actor.wind`): drawing the tool back, pointing it, holding it at the top, bringing it down and
 * through until the aftermath is over; null while it is not swinging.
 */
export function swingNow(a: Actor, c: number): Swing | null {
  const w = a.wind;
  const beats = AIMED.swing;
  if (LOOKS[a.unit.kind]?.aimed !== "swing" || !w || c < w.from || c >= w.at + beats.after) return null;
  if (c < w.at - beats.catch) return "draw";
  if (c < w.at - beats.dread) return "point";
  return c < w.at ? "top" : "down";
}

/** Steps the catch's one peck holds its head down on the wood. */
const CATCH_PECK = 3;
/**
 * The picture one that drums (Unc) is in at the clock `c`: its head down on the wood for the catch's
 * one peck, back (`peck`) through the dread, then down and back by turns every step for the roll, a
 * blur; nothing while it is not drumming.
 */
export function drumNow(a: Actor, c: number): { pose: "cast"; peck: boolean } | null {
  const aim = aims.find((x) => x.by === a.unit.id && x.how === "drum" && x.fight === fightNow());
  if (!aim) return null;
  const beats = AIMED.drum;
  const ends = aim.at + aim.every * (aim.pulses - 1) + 2;
  if (c < aim.at - beats.catch || c >= ends) return null;
  if (c < aim.at - beats.catch + CATCH_PECK) return { pose: "cast", peck: false };
  if (c < aim.at) return c >= aim.at - beats.dread ? { pose: "cast", peck: true } : null;
  return { pose: "cast", peck: Math.floor(c) % 2 === 1 };
}

/** A peck of a drum lands on somebody: the last of them has the weight. */
export function pecked(by: number): void {
  const aim = aims.find((x) => x.by === by && x.fight === fightNow() && x.how === "drum" && clockNow() >= x.at);
  if (!aim) return;
  aim.landed++;
  snd.ability({ n: -2 + (aim.landed % 2) * 3, wave: "square", hiss: 1500, vol: 0.05 });
  if (aim.landed !== aim.pulses) return;
  bump(1);
  weigh(0.12);
  // One feather comes down off it.
  const a = FV.actors[by];
  if (a) burst(a.x - 4, a.y - 22, 1, [INK, CREAM], { speed: 6, grav: 10, ttl: 1.2, toward: Math.PI / 2, spread: 0.4 });
}

/** The chip a tool leaves of what it gathered: wood, stone, a drop, a stalk. */
const GATHERED: Readonly<Record<Tool, Gathered>> = {
  axe: "wood",
  pickaxe: "stone",
  rod: "drop",
  scythe: "stalk",
};

/** Moves every aim on to the clock `c`: the catch's peck, the swing remembered, the chip left; forgets what is over. */
export function stepAims(c: number): void {
  const fight = fightNow();
  if (swung.fight !== fight) {
    swung.fight = fight;
    swung.by.clear();
  }
  for (const aim of aims.splice(0)) {
    if (aim.fight !== fight) continue;
    const beats = AIMED[aim.how];
    const a = FV.actors[aim.by];
    if (!a || c >= aim.at + beats.after + (aim.how === "drum" ? aim.every * aim.pulses : 0)) continue;
    aims.push(aim);
    if (aim.how === "drum") drumOn(aim, c);
    else swingOn(aim, c);
  }
}

/** A drum at the clock `c`: its head cocked back through the dread, and the catch's one peck. */
function drumOn(aim: Aim, c: number): void {
  if (aim.pecked || c < aim.at - AIMED.drum.catch) return;
  aim.pecked = true;
  snd.ability({ n: -2, wave: "square", hiss: 1500, vol: 0.05 });
  const p = feetAt(aim.cells[0] ?? -1);
  burst(p.x, p.y - 1, 3, [PAPER[1], CREAM], { speed: 14, ttl: 0.25 });
}

/** A swing at the clock `c`: once it has gone off, the tool remembered and a chip of what it gathered left on the hex. */
function swingOn(aim: Aim, c: number): void {
  if (!aim.tool || aim.pecked || c < aim.at) return;
  aim.pecked = true;
  swung.by.set(aim.by, TOOLS.indexOf(aim.tool));
  const p = feetAt(aim.tool === "scythe" ? (FV.actors[aim.by]?.unit.cell ?? -1) : (aim.cells[0] ?? -1));
  leave(GATHERED[aim.tool], p);
}

/** Whether any aim has the table dark now. */
export const aiming = (): boolean =>
  aims.some((x) => x.fight === fightNow() && clockNow() >= x.at - AIMED[x.how].dread && clockNow() < x.at);

/** Where the dread's light lies: each hex it is for, as screen points. */
const poolsOf = (aim: Aim): Pt[] =>
  aim.cells.map((cell) => {
    const p = feetAt(cell);
    return { x: Math.round(V.bx + p.x), y: Math.round(V.by + p.y) - FOOT };
  });

/** A ring on the wood of the table round a screen point, `r` across, in the board's slant. */
export function woodRing(g: Ctx, x: number, y: number, r: number, col: string): void {
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    R(g, Math.round(x + Math.cos(t) * r), Math.round(y + Math.sin(t) * r * 0.5), 1, 1, col);
  }
}

/** Under everyone: the dark round the hexes through the dread, and the drum's first ring. */
export function drawAimsUnder(g: Ctx): void {
  const c = clockNow();
  for (const aim of aims) {
    if (aim.fight !== fightNow()) continue;
    const beats = AIMED[aim.how];
    const pools = poolsOf(aim);
    if (c >= aim.at - beats.dread && c < aim.at && !hushing())
      dimRounds(g, pools, POOL.rx, POOL.ry, (c - (aim.at - beats.dread)) / 3);
    // The drum's ring under its target, from the catch until the roll's own rings take over, widening through the dread.
    if (aim.how === "drum" && c >= aim.at - beats.catch && c < aim.at) {
      const p = pools[0];
      const wide = clamp((c - (aim.at - beats.dread)) / beats.dread, 0, 1);
      if (p) woodRing(g, p.x, p.y + FOOT, 9 + Math.round(wide * 2), INK);
    }
  }
}

/** Over everyone: the gold corners from the catch through the dread, and the rod's line, tight. */
export function drawAims(g: Ctx): void {
  const c = clockNow();
  for (const aim of aims) {
    if (aim.fight !== fightNow()) continue;
    const beats = AIMED[aim.how];
    if (c < aim.at - beats.catch || c >= aim.at + 2) continue;
    for (const p of poolsOf(aim)) hexCorners(g, p.x, p.y, c - (aim.at - beats.catch));
    if (aim.tool === "rod" && c < aim.at) line(g, aim, c);
  }
}

/** One pixel of line from the rod's tip to whoever it is for, tight. */
function line(g: Ctx, aim: Aim, c: number): void {
  const a = FV.actors[aim.by];
  const t = FV.actors[aim.to[0] ?? -1];
  const hand = a ? handAt(a, c, aim.fight.tick) : null;
  if (!a || !t || !hand) return;
  // The rod's tip is a little past the hand, up and out.
  const from = { x: Math.round(V.bx + hand.x + (a.left ? -3 : 3)), y: Math.round(V.by + hand.y - 6) };
  const to = { x: Math.round(V.bx + t.x), y: Math.round(V.by + t.y - 8) };
  const n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  for (let i = 0; i <= n; i++)
    R(g, Math.round(from.x + ((to.x - from.x) * i) / n), Math.round(from.y + ((to.y - from.y) * i) / n), 1, 1, CREAM);
  R(g, to.x - 1, to.y - 1, 3, 3, GOLD[2]);
}

/** The scythe's crescent all the way round, as it goes off: green numbers come with the heal. */
export function reaped(a: Actor): void {
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    burst(a.x + Math.cos(t) * 10, a.y - 4 + Math.sin(t) * 5, 1, [CREAM, GREEN[4]], {
      toward: t + Math.PI / 2,
      spread: 0.2,
      speed: 30,
      grav: 0,
      ttl: 0.25,
    });
  }
}
