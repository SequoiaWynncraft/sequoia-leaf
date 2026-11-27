/**
 * A Graid figure's true form rising, on the table, in five beats (`risetime.ts` says when): it lies
 * a second where it fell; the table dims to its hex; its raid's ring (`rings.ts`) draws round it one
 * gold stud at a time while friends lean away; it stands in its new shape, the ring snaps shut, the
 * board bumps and a low horn sounds; and the ring stays, faint, under it until it falls again.
 *
 * It is begun by the rules' `fall` that says `back`, and stood up only by their `rise`. If the fight
 * ends first, or goes on past that step without it (nowhere free to stand), it is down for good: it
 * goes in its puff as anyone does, and its ring, half drawn, goes out.
 */
import { GOLD, STONE } from "@sequoia-leaf/kit/palette.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, FightEvent } from "@sequoia-leaf/raid";
import { hasTrueForm, TRUE_FORMS, type TrueFormId } from "@sequoia-leaf/raid/content/graid.ts";

import { clockNow, feetAt, fightNow, FOOT, FV, travel } from "./board.ts";
import { burst, ring, say } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import type { Actor } from "./motion.ts";
import { drawRing, RING } from "./rings.ts";
import { beatOf, dimAt, fateOf, GOES_OUT, quartersAt, type Rising, risingAt } from "./risetime.ts";
import { snd } from "./sounds.ts";
import { dimRound } from "./spells.ts";
import { V } from "./stage.ts";
import { bump, weigh } from "./weight.ts";

interface Riser {
  readonly fight: Fight;
  readonly id: number;
  readonly kind: TrueFormId;
  readonly when: Rising;
  /** Where it fell (its feet), from the board's corner. */
  readonly spot: Pt;
  /** The rules have stood it up (`rise`), on this cell. */
  risen: number | null;
  /** Friends near it have been told to lean away. */
  leant: boolean;
  /** It has been seen to stand: its ring lies faint under it from then, until it falls again. */
  stood: number | null;
  /** It stays down: its ring, as far as it was drawn, goes out from then. */
  out: number | null;
}
const risers: Riser[] = [];

/** The horn as a true form stands. */
const HORN = { n: -17, wave: "triangle", two: 7, hiss: 220, slide: 1.02, vol: 0.11 } as const;
/** How far friends lean away from it: those within this many pixels. */
const NEAR = 30;

const actor = (id: number): Actor | undefined => FV.actors[id];

/** A figure fell, and says it will get back up (`back`): it lies there until it does, and the beats begin. */
export function fallsToRise(ev: Extract<FightEvent, { t: "fall" }>, at: number): void {
  const a = actor(ev.id);
  const fight = fightNow();
  // One that falls a second time, for good, takes its ring with it.
  for (let i = risers.length - 1; i >= 0; i--) if (risers[i]?.id === ev.id) risers.splice(i, 1);
  if (!a || !fight || !ev.back || !hasTrueForm(a.unit.kind)) return;
  a.rising = true;
  const spot = { x: a.x, y: a.y };
  risers.push({
    fight,
    id: ev.id,
    kind: a.unit.kind,
    when: risingAt(at, ev.back),
    spot,
    risen: null,
    leant: false,
    stood: null,
    out: null,
  });
}

/** The rules stood it up, on a cell: it stands now, there. */
export function risesUp(ev: Extract<FightEvent, { t: "rise" }>, at: number): void {
  const r = risers.find((x) => x.id === ev.id && x.fight === fightNow() && x.stood === null);
  if (!r) return;
  r.risen = ev.cell;
  stand(r, at);
}

/** It stands in its new shape: off the ground, the ring snapping shut, a bump, its name, the horn. */
function stand(r: Riser, c: number): void {
  const a = actor(r.id);
  r.stood = c;
  if (!a) return;
  a.fallAt = Infinity;
  a.gone = false;
  a.rising = false;
  a.form = "true";
  a.hopAt = c;
  a.castUntil = c + 6;
  if (r.risen !== null) {
    const to = feetAt(r.risen);
    if (Math.hypot(to.x - a.x, to.y - a.y) > 1) travel(a, to, c, 4, 6);
  }
  bump(2);
  weigh("big");
  const x = a.x;
  const y = a.y - FOOT;
  ring(x, y, RING.rx + 6, GOLD[2], 0.4);
  burst(x, y - 8, 16, [GOLD[2], GOLD[1], "#ffffff"], { speed: 40, ttl: 0.5, grav: 30 });
  say(x, y - 34, TRUE_FORMS[r.kind].name, GOLD[2], { small: true, ttl: 1.2, rise: 6 });
  snd.ability(HORN);
}

/** Friends near where it lies lean away while its ring draws. */
function leanAway(r: Riser, c: number): void {
  r.leant = true;
  const me = actor(r.id);
  for (const a of FV.actors) {
    if (!a || a === me || !a.unit.alive || a.unit.side !== me?.unit.side) continue;
    const dx = a.x - r.spot.x;
    if (Math.hypot(dx, a.y - r.spot.y) > NEAR) continue;
    a.shy = { from: c, until: r.when.up + 2, dir: dx < 0 ? -1 : 1 };
  }
}

/** Now and then a pebble falls off the Rock's ring, the strata of a cliff. */
function crumble(r: Riser, c: number): void {
  const a = actor(r.id);
  if (r.kind !== "rock" || !a || Math.floor(c) % 37 !== 0 || Math.floor(c) === Math.floor(c - 0.4)) return;
  burst(a.x + RING.rx - 2, a.y - FOOT + 2, 1, [STONE[2]], {
    speed: 8,
    grav: 90,
    ttl: 0.5,
    toward: Math.PI / 2,
    spread: 0.4,
  });
}

/** It is down for good: it goes in its puff, friends stand up straight, and its ring goes out. */
function staysDown(r: Riser, c: number): void {
  r.out = c;
  const a = actor(r.id);
  if (a) a.rising = false;
  for (const o of FV.actors) if (o?.shy) o.shy = null;
}

/** Moves each true form on its way up through its beats at the fight's clock `c`. */
export function stepRisings(c: number): void {
  const fight = fightNow();
  for (let i = risers.length - 1; i >= 0; i--) {
    const r = risers[i];
    if (!r) continue;
    if (r.fight !== fight || (r.out !== null && c >= r.out + GOES_OUT)) {
      risers.splice(i, 1);
      continue;
    }
    if (r.stood !== null) {
      crumble(r, c);
      continue;
    }
    if (r.out !== null || !fight) continue;
    const fate = fateOf(r.when, fight, r.risen !== null);
    if (fate === "stays down") staysDown(r, c);
    else if (!r.leant && beatOf(r.when, c) === "draws") leanAway(r, c);
  }
}

/** What lies on the table for each true form: the dark round its hex and its ring as it draws, and then its faint ring under it. */
export function drawRisings(g: Ctx): void {
  const c = clockNow();
  for (const r of risers) {
    if (r.fight !== fightNow()) continue;
    const a = actor(r.id);
    if (r.stood === null) {
      const x = Math.round(V.bx + r.spot.x);
      const y = Math.round(V.by + r.spot.y) - FOOT;
      if (r.out === null) dimRound(g, x, y, RING.rx + 5, RING.ry + 4, dimAt(r.when, c));
      const quarters = quartersAt(r.when, r.out ?? c);
      g.globalAlpha = r.out === null ? 1 : clamp(1 - (c - r.out) / GOES_OUT, 0, 1);
      if (quarters > 0) drawRing(g, r.kind, x, y, quarters, c);
      g.globalAlpha = 1;
      continue;
    }
    if (!a || a.gone || c >= a.fallAt) continue;
    const since = c - r.stood;
    g.globalAlpha = since < 3 ? 1 : 0.5;
    drawRing(g, r.kind, Math.round(V.bx + a.x), Math.round(V.by + a.y) - FOOT, 4, c, since < 2 ? 1.25 : 1);
    g.globalAlpha = 1;
  }
}

/** Whether a figure is down only for a moment, lying there until its true form rises. */
export const isRising = (a: Actor): boolean => a.rising;
