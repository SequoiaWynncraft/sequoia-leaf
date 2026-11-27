/**
 * An ability that lands later, between going off and landing, in its owner's colours
 * (`livery.ts`): the table goes dark but for a pool of light round whoever it is for; a seal is
 * stamped on the ground round that pool, its studs lighting one after another until it lands, each
 * sending a spark in at them; a ball grows between its owner's hands, held at the hip; and gold
 * corners close round them. As it lands the dark is gone at once, its owner pushes both hands out
 * at them and a beam runs from the hands to them for a moment, and embers fly. What hangs over
 * them lies on the ground, or is no wider than the corners, so the one caught is never out of
 * sight; only the beam crosses them, for as long as it lasts.
 *
 * When it lands is `hung.ts`'s to say, counted from the step it went off. Whoever it is for falling
 * first takes the corners with them; the seal stays, and it still lands where they stood.
 */
import { framesOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx } from "@sequoia-leaf/kit/util.ts";
import type { Fight, UnitKind } from "@sequoia-leaf/raid";

import { handAt } from "./acting.ts";
import { clockNow, fightNow, FOOT, FV } from "./board.ts";
import { burst } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { fateOf, hangs, type Hung, stillCaught } from "./hung.ts";
import { type Livery, liveryOf } from "./livery.ts";
import { V } from "./stage.ts";

interface Spell {
  readonly fight: Fight;
  /** Whose it is and whoever it is for, by their numbers in the fight. */
  readonly by: number;
  readonly to: number;
  readonly hung: Hung;
  readonly livery: Livery;
  /** Where whoever it is for stands (their feet), kept when they fall, and how tall they are. */
  spot: Pt;
  readonly tall: number;
  /** How many of the seal's studs are lit. */
  lit: number;
  /** Whoever it was for fell before it landed: nothing hangs over them any more. */
  free: boolean;
  /** It has landed: only the seal is left, going out. */
  done: boolean;
  /** What happens as it lands. */
  readonly land: () => void;
}
const spells: Spell[] = [];

const UP = -Math.PI / 2;
/** How large the ball between its owner's hands grows (its radius in pixels), and the steps its beam lasts. */
const BALL = 3;
const BEAM = 5;
/** The seal: half its width and its height, how many studs, and the steps it stays after landing. */
const SEAL = { rx: 27, ry: 19 } as const;
const STUDS = 12;
const STAYS = 14;
/** How dark the table goes round a seal while it hangs, and the steps that takes. */
const HUSH = 0.42;
const FALLS = 3;

/** Hangs an ability that went off at step `at` over whoever it is for (`to`), to land `ticks` steps on. */
export function hang(
  kind: UnitKind,
  who: { readonly by: number; readonly to: number },
  at: number,
  ticks: number,
  land: () => void,
): void {
  const fight = fightNow();
  const caught = FV.actors[who.to];
  if (!fight || !caught) return land();
  const hung = hangs(at, ticks);
  const livery = liveryOf(kind);
  const spot = { x: caught.x, y: caught.y };
  const tall = framesOf(caught.unit.kind).tall;
  spells.push({ fight, ...who, hung, livery, spot, tall, lit: 0, free: false, done: false, land });
  caught.dread = { from: at + 1, until: hung.lands };
  burst(spot.x, spot.y - FOOT, 10, [livery.spark[1], livery.core[1]], { speed: 60, grav: 0, ttl: 0.25, above: false });
}

/** Where a stud of a seal is, from the seal's middle: the first at the top, the rest clockwise. */
const studAt = (i: number, grown: number): Pt => {
  const a = UP + (i / STUDS) * Math.PI * 2;
  return { x: Math.round(Math.cos(a) * SEAL.rx * grown), y: Math.round(Math.sin(a) * SEAL.ry * grown) };
};

/** What is seen as it lands where whoever it was for stands, or stood: the ground thrown up in embers of its owner's colours. */
function strikes(s: Spell): void {
  const { main, trim } = s.livery;
  const { x, y } = s.spot;
  burst(x, y - 4, 18, [main[1], main[0], trim[1]], {
    size: 2,
    speed: 70,
    toward: UP,
    spread: 2.6,
    grav: 220,
    ttl: 0.4,
  });
}

/** Whoever it is for is followed while they stand, and the seal's studs light, each sending a spark in along the ground at them. */
function tighten(s: Spell, c: number): void {
  const a = FV.actors[s.to];
  if (a) s.spot = { x: a.x, y: a.y };
  const lit = Math.floor(clamp((c - s.hung.at) / (s.hung.lands - s.hung.at), 0, 1) * STUDS);
  for (; s.lit < lit; s.lit++) {
    const from = studAt(s.lit, 1);
    burst(s.spot.x + from.x, s.spot.y - FOOT + from.y, 2, [s.livery.spark[1], s.livery.core[1]], {
      toward: Math.atan2(-from.y, -from.x),
      spread: 0.2,
      speed: Math.hypot(from.x, from.y) / 0.3,
      grav: 0,
      ttl: 0.3,
      above: false,
    });
  }
}

/** One that hangs, at the clock `c`: tightened while whoever it is for is under it, let go of when they are not, and landed when it is due. */
function step(s: Spell, c: number, fate: "hangs" | "lands"): void {
  const a = FV.actors[s.to];
  const under = !s.free && stillCaught(s.hung, a?.fallAt ?? -1, c);
  if (under && fate === "hangs") return tighten(s, c);
  if (a) a.dread = null;
  s.free = true;
  if (fate === "hangs") return;
  strikes(s);
  s.done = true;
  s.land();
}

/** Lands what is due, lets go of whoever fell from under theirs, and forgets what will never land or has gone out. */
export function stepSpells(c: number): void {
  for (const s of spells.splice(0)) {
    const fate = s.fight === fightNow() ? fateOf(s.hung, c, s.fight) : "never";
    if (fate === "never" && !s.done) {
      const a = FV.actors[s.to];
      if (a) a.dread = null;
      continue;
    }
    if (s.done && (fate === "never" || c >= s.hung.lands + STAYS)) continue;
    spells.push(s);
    if (!s.done && fate !== "never") step(s, c, fate);
  }
}

/** Half of a ring lying flat, a pixel thick: the half nearer us (`near` 1) or the far half (-1). */
function arc(g: Ctx, x: number, y: number, rx: number, ry: number, near: 1 | -1, col: string): void {
  const n = Math.max(8, Math.round(rx * 2.5));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    R(g, Math.round(x + Math.cos(a) * rx), Math.round(y + near * Math.sin(a) * ry), 1, 1, col);
  }
}

/** A seal on the ground: stamped down larger than it settles, its studs lit so far; after landing only its ring, going out. */
function seal(g: Ctx, s: Spell, c: number): void {
  const since = c - s.hung.at;
  const grown = since < 1 ? 1.3 : since < 2 ? 1.12 : 1;
  const x = Math.round(V.bx + s.spot.x);
  const y = Math.round(V.by + s.spot.y) - FOOT;
  if (s.done) g.globalAlpha = clamp(1 - (c - s.hung.lands) / STAYS, 0, 1) * 0.8;
  for (const near of [1, -1] as const)
    for (const [inside, col] of [
      [0, INK],
      [1, s.livery.trim[1]],
      [2, s.livery.trim[0]],
      [3, INK],
    ] as const)
      arc(g, x, y, SEAL.rx * grown - inside, SEAL.ry * grown - inside, near, col);
  for (let i = 0; i < STUDS && !s.done; i++) {
    const at = studAt(i, grown);
    R(g, x + at.x - 3, y + at.y - 2, 7, 5, INK);
    R(g, x + at.x - 2, y + at.y - 1, 5, 3, i < s.lit ? s.livery.core[1] : s.livery.main[0]);
  }
  g.globalAlpha = 1;
}

/**
 * The table dark all round a pool of light lying on it, `rx` and `ry` round the screen point `x`,
 * `y`, the dark `k` of the way in (0 none, 1 as dark as a big moment goes). Drawn under everyone
 * standing on it, so nobody is darkened.
 */
export function dimRound(g: Ctx, x: number, y: number, rx: number, ry: number, k: number): void {
  if (k <= 0) return;
  g.fillStyle = INK;
  g.globalAlpha = HUSH * clamp(k, 0, 1);
  g.fillRect(0, 0, V.w, y - ry);
  g.fillRect(0, y + ry + 1, V.w, V.h);
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
    g.fillRect(0, y + dy, x - half, 1);
    g.fillRect(x + half + 1, y + dy, V.w, 1);
  }
  g.globalAlpha = 1;
}

/** The table goes dark all round a seal while it hangs, a row at a time, and is as it was the moment it lands. */
function hush(g: Ctx, s: Spell, c: number): void {
  const x = Math.round(V.bx + s.spot.x);
  const y = Math.round(V.by + s.spot.y) - FOOT;
  dimRound(g, x, y, SEAL.rx, SEAL.ry, (c - s.hung.at) / FALLS);
}

/** The seals, on the ground under everyone standing on it, and the dark round the first of them. */
export function drawSeals(g: Ctx): void {
  const c = clockNow();
  const live = spells.filter((s) => s.fight === fightNow());
  const first = live.find((s) => !s.done);
  if (first) hush(g, first, c);
  for (const s of live) seal(g, s, c);
}

/** A round spot of a colour, `r` pixels out from the pixel at its middle. */
function disc(g: Ctx, x: number, y: number, r: number, col: string): void {
  if (r < 0) return;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) ** 2 - dy * dy));
    R(g, x - half, y + dy, half * 2 + 1, 1, col);
  }
}

/** A ball of its owner's colours, edged dark and brightest in the middle, `r` pixels out. */
function orb(g: Ctx, l: Livery, x: number, y: number, r: number, hot: boolean): void {
  disc(g, x, y, r + 1, INK);
  disc(g, x, y, r, l.main[0]);
  disc(g, x, y, r - 1, l.main[1]);
  disc(g, x, y, r - 2, l.core[1]);
  if (hot) R(g, x, y, 1, 1, CREAM);
}

/** Where its owner's leading hand is at the clock `c` (`both`: halfway between their hands), on the screen; null once they have fallen. */
function handsOf(s: Spell, c: number, both: boolean): Pt | null {
  const owner = FV.actors[s.by];
  const hands = owner && c < owner.fallAt ? handAt(owner, c, s.fight.tick, both) : null;
  return hands && { x: Math.round(V.bx + hands.x), y: Math.round(V.by + hands.y) };
}

/** The ball growing between its owner's hands while it hangs, flickering as it comes, with sparks wheeling in to it. */
function ball(g: Ctx, s: Spell, c: number): void {
  const at = handsOf(s, c, true);
  if (!at) return;
  const k = clamp((c - s.hung.at) / (s.hung.lands - s.hung.at), 0, 1);
  const flicker = k > 0.6 && Math.floor(c) % 2 === 0 ? 1 : 0;
  const r = 1 + Math.floor(k * BALL) + flicker;
  orb(g, s.livery, at.x, at.y, r, k > 0.5);
  for (let i = 0; i < 3; i++) {
    const turn = c * 0.6 + (i * Math.PI * 2) / 3;
    const out = r + 2 + ((c * 0.5 + i) % 3);
    R(g, Math.round(at.x + Math.cos(turn) * out), Math.round(at.y + Math.sin(turn) * out), 1, 1, s.livery.spark[1]);
  }
}

/**
 * As it lands: a beam from just past its owner's leading hand to where whoever it was for stands
 * (or stood), white-hot and widest at first, so that the hands pushing it are seen at its foot.
 */
function beam(g: Ctx, s: Spell, c: number): void {
  const since = c - s.hung.lands;
  const hand = since >= 0 && since < BEAM ? handsOf(s, c, false) : null;
  if (!hand) return;
  const to = { x: Math.round(V.bx + s.spot.x), y: Math.round(V.by + s.spot.y - s.tall / 2) };
  const w = since < 2 ? 3 : since < 4 ? 2 : 1;
  const far = Math.hypot(to.x - hand.x, to.y - hand.y);
  const gap = w + 3;
  if (far <= gap) return;
  const at = (d: number): Pt => ({
    x: Math.round(hand.x + ((to.x - hand.x) * d) / far),
    y: Math.round(hand.y + ((to.y - hand.y) * d) / far),
  });
  const layers: readonly (readonly [number, string])[] = [
    [w + 1, INK],
    [w, s.livery.main[1]],
    [w - 1, s.livery.core[1]],
    [since < 2 ? 0 : -1, CREAM],
  ];
  for (const [r, col] of layers)
    for (let d = gap; d <= far; d++) {
      const p = at(d);
      disc(g, p.x, p.y, r, col);
    }
  if (since >= 2) return;
  orb(g, s.livery, hand.x, hand.y, 1, true);
  orb(g, s.livery, to.x, to.y, w + 2, true);
}

/** The corners marking whoever is caught: they close in, then stay, blinking as it comes. */
function corners(g: Ctx, s: Spell, c: number): void {
  if (s.hung.lands - c < 6 && Math.floor(c) % 2 === 0) return;
  const out = Math.max(0, 4 - Math.floor(c - s.hung.at)) * 2;
  const x = Math.round(V.bx + s.spot.x);
  const y = Math.round(V.by + s.spot.y);
  for (const sx of [-1, 1] as const)
    for (const sy of [-1, 1] as const) {
      const cx = x + sx * (9 + out) - (sx === 1 ? 1 : 0);
      const cy = y - 10 + sy * (14 + out) - (sy === 1 ? 1 : 0);
      const lx = cx - (sx === 1 ? 5 : 0);
      const ty = cy - (sy === 1 ? 5 : 0);
      R(g, lx - 1, cy - 1 - (sy === 1 ? 1 : 0), 8, 4, INK);
      R(g, cx - 1 - (sx === 1 ? 1 : 0), ty - 1, 4, 8, INK);
      R(g, lx, cy - (sy === 1 ? 1 : 0), 6, 2, GOLD[2]);
      R(g, cx - (sx === 1 ? 1 : 0), ty, 2, 6, GOLD[2]);
    }
}

/** What is drawn over everyone standing on the table: each ball and the corners round whoever is caught, and each beam as it lands. */
export function drawSpells(g: Ctx): void {
  const c = clockNow();
  for (const s of spells) {
    if (s.fight !== fightNow()) continue;
    if (s.done) beam(g, s, c);
    else ball(g, s, c);
    if (!s.free && !s.done) corners(g, s, c);
  }
}
