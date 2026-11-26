/**
 * What each thing the rules say happened looks like on the table (`ON`, one entry for each kind of
 * event), and the lead-in the table gives it before it happens (`begin`): a figure draws back and
 * lunges so that its blow peaks as the hit lands, winds up before its ability goes off, sets off on
 * a leap so that it comes down as its damage does. What an ability looks like is its entry in
 * `looks.ts`; the marks it leaves are `marks.ts`'s.
 *
 * Big moments have weight: the fight's clock holds a moment (a hit-stop) on a hard hit, an ability
 * that hits two or more and a fall, and the board bumps under a five-acorn ability, a boss's, and a
 * three-star figure's fall.
 */
import { framesOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, EARTH, GOLD, GREEN, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { type FightEvent, HZ, type TraitId, type UnitKind } from "@sequoia-leaf/raid";
import { FIGURES, isBossId, isFigureId } from "@sequoia-leaf/raid/content/figures.ts";
import { TRAITS } from "@sequoia-leaf/raid/content/traits.ts";
import { distance } from "@sequoia-leaf/raid/hex.ts";

import { aimAt, handAt } from "./acting.ts";
import { itemPic, traitPic } from "./art/icons.ts";
import { TRAIT_COLOUR } from "./art/pal.ts";
import { clockNow, colourOf, face, feetAt, fightNow, FV, travel } from "./board.ts";
import { showMark } from "./fightmarks.ts";
import { burst, gather, motes, ring, say } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { ownOf } from "./livery.ts";
import { ATTACK_SHOT, type Look, LOOKS, puffOf, VOICES } from "./looks.ts";
import { arcOf, type At, MARKS, puff, type Shot } from "./marks.ts";
import { type Actor, actorFor, TUMBLE } from "./motion.ts";
import { bumpFor, type Cue, holdFor, type Lead, type Weight } from "./playback.ts";
import { snd } from "./sounds.ts";
import { hang, stepSpells } from "./spells.ts";

/** The kinds of damage, coloured as the cards colour their words: coral, rose, cream. */
const DAMAGE_COL = { physical: "#e67967", magic: "#d88ad0", true: CREAM } as const;
const UP = -Math.PI / 2;

const actor = (id: number): Actor | undefined => FV.actors[id];
const tallOf = (a: Actor): number => framesOf(a.unit.kind).tall;
const chestOf = (a: Actor): Pt => ({ x: a.x, y: a.y - Math.round(tallOf(a) / 2) });

/** Holds the clock a moment for a blow of weight (or for some seconds at 1x). */
function weigh(w: Weight | number): void {
  if (FV.pb) holdFor(FV.pb, w, FV.speed);
}
/** Whether the player has asked their system for less motion. */
const lessMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Bumps the board under a big moment, unless a bigger bump is still going. */
function bump(strength: number): void {
  const px = bumpFor(strength, FV.speed, lessMotion());
  if (px > 0 && (px >= FV.bump.px || clockNow() - FV.bump.at > 5)) FV.bump = { at: clockNow(), px };
}

/** How many of an ability's hits have landed this step, by whose it is: two or more is weight. */
const landed = { at: -1, by: new Map<number, number>() };
function countHit(by: number, at: number): number {
  if (landed.at !== at) {
    landed.at = at;
    landed.by.clear();
  }
  const n = (landed.by.get(by) ?? 0) + 1;
  landed.by.set(by, n);
  return n;
}

/** A blow from `a` toward `t`, `reach` pixels long, drawn back from `from` and landing at `at`. */
function blowAt(a: Actor, t: Actor, from: number, at: number, reach: number, hop = 0): void {
  face(a, t);
  const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
  a.blow = { from, at, bx: ((t.x - a.x) / d) * reach, by: ((t.y - a.y) / d) * reach * 0.8, hop };
}

/** Throws something: from a spot at chest height to whoever it is at, landing at `t0 + dur`. */
function throwAt(
  from: Pt,
  target: number,
  to: Pt,
  t0: number,
  dur: number,
  look: Shot["look"],
  o: Partial<Shot> = {},
): void {
  const at = actor(target);
  const end = at ? chestOf(at) : { x: to.x, y: to.y - 8 };
  FV.shots.push({
    from,
    to: end,
    target,
    t0,
    dur: Math.max(1, dur),
    arc: arcOf(look, Math.hypot(end.x - from.x, end.y - from.y)),
    look,
    col: o.col ?? STONE[3],
    trail: o.trail ?? false,
    land: o.land ?? null,
  });
}

/** Where an ability is seen going off, for its mark: on whoever it is aimed at, where its owner lands or calls something up, or about its owner. */
function atOf(ev: Extract<FightEvent, { t: "cast" }>): At | null {
  const a = actor(ev.id);
  if (!a) return null;
  const aimed = actor(ev.targets[0] ?? -1);
  const first = feetAt(ev.cells[0] ?? a.unit.cell);
  const spot = ev.shape === "bolt" && aimed ? aimed : ev.shape === "leap" || ev.shape === "summon" ? first : a;
  const tall = ev.shape === "bolt" && aimed ? tallOf(aimed) : tallOf(a);
  return {
    x: spot.x,
    y: spot.y,
    tall,
    from: { x: a.x, y: a.y },
    cells: ev.cells.map(feetAt),
    hit: ev.targets.flatMap((id) => {
      const o = actor(id);
      return o ? [{ x: o.x, y: o.y }] : [];
    }),
    col: colourOf(ev.kind),
    own: ownOf(ev.kind),
    shiny: (aimed?.unit.items.length ?? 0) > 0,
  };
}

// ---------- lead-ins ----------

/** Winding up for an ability: the body as its look says, light gathering in, a lunge or what it throws ahead. */
function windUp(l: Lead, ev: Extract<FightEvent, { t: "cast" }>): void {
  const a = actor(ev.id);
  const look = LOOKS[ev.kind];
  if (!a || !look) return;
  const t = actor(ev.targets[0] ?? -1);
  const goes = l.at - (look.leap ?? 0);
  a.wind = { from: l.from, at: goes, body: look.body };
  if (t && t !== a) face(a, t);
  const drawn = coloursOf(ev.kind, look.gather);
  if (drawn) gather(a.x, a.y - Math.round(tallOf(a) / 2), 8, drawn, (goes - l.from) / HZ);
  if (look.body === "dig") burst(a.x, a.y, 6, [EARTH[1], EARTH[2]], { speed: 20, toward: UP, spread: 2, ttl: 0.4 });
  if (look.lunge && t) blowAt(a, t, l.at - 4, l.at, look.lunge, look.lunge >= 6 ? 4 : 0);
  if (look.ahead) throwAhead(l, ev, a, look.ahead);
}

/** Thrown during the wind-up, at whoever it is for (or the hex it is for), landing as the ability goes off. */
function throwAhead(l: Lead, ev: Extract<FightEvent, { t: "cast" }>, a: Actor, what: Shot["look"]): void {
  const fly = Math.min(5, l.at - l.from);
  const to = ev.targets.length > 0 ? ev.targets : [-1];
  for (const id of to) throwAt(chestOf(a), id, feetAt(ev.cells[0] ?? a.unit.cell), l.at - fly, fly, what);
}

/** Begins the lead-in to something about to happen. */
export function begin(l: Lead): void {
  const ev = l.ev;
  if (ev.t === "cast") windUp(l, ev);
  else if (ev.t === "swing") {
    const a = actor(ev.id);
    const t = actor(ev.target);
    if (a && t) blowAt(a, t, l.from, l.at, 5);
  } else if (ev.t === "shot") {
    const a = actor(ev.id);
    const t = actor(ev.target);
    if (a && t) blowAt(a, t, l.from, l.at, 1.5);
  } else if (ev.t === "leap") {
    const a = actor(ev.id);
    const worm = a?.unit.kind === "worm";
    // A worm goes under the board; anyone else leaps, to where it lands as its ability goes off.
    if (a) travel(a, feetAt(ev.to), l.from, l.at - l.from, worm ? 0 : 14, worm);
  }
}

// ---------- what happens ----------

type Events = { [K in FightEvent["t"]]: Extract<FightEvent, { t: K }> };
type On = { [K in keyof Events]: (ev: Events[K], at: number) => void };

const ON: On = {
  move: (ev, at) => {
    const a = actor(ev.id);
    if (a) travel(a, feetAt(ev.to), at, ev.ticks, 2);
  },
  leap: (ev, at) => {
    const a = actor(ev.id);
    if (!a) return;
    const to = feetAt(ev.to);
    if (ev.why === "knocked") {
      travel(a, to, at, 4, 4);
      a.left = !a.left;
      a.landAt = at + 4;
      burst(a.x, a.y - 4, 6, [CREAM, STONE[3]], { speed: 30, ttl: 0.3 });
      return;
    }
    // An ability's leap was begun ahead and comes down now; a Sneak's, as the fight opens, starts now.
    if (ev.why === "sneak") travel(a, to, at, 8, 18);
    else if (!a.move || a.move.t0 + a.move.dur > at + 1) travel(a, to, at - 3, 3, 8);
    a.landAt = ev.why === "sneak" ? at + 8 : at;
    if (a.unit.kind === "worm") snd.dig();
    else snd.leap();
  },
  swing: (ev, at) => {
    const a = actor(ev.id);
    const t = actor(ev.target);
    if (a && t && (!a.blow || a.blow.at !== at)) blowAt(a, t, at - 1, at, 5);
    snd.swing();
  },
  shot: (ev, at) => {
    const a = actor(ev.id);
    if (!a) return;
    const t = actor(ev.target);
    if (t) face(a, t);
    const from = feetAt(ev.from);
    const own = ev.what === "ability" ? LOOKS[a.unit.kind] : undefined;
    const small = ATTACK_SHOT[a.unit.kind];
    const mark = own && t ? markAt(a, t) : null;
    throwAt(handOr(a, at, from), ev.target, feetAt(ev.to), at, ev.ticks, own?.shot ?? small?.shot ?? null, {
      col: coloursOf(a.unit.kind, small?.col)?.[0] ?? STONE[3],
      trail: small?.trail ?? false,
      land: mark,
    });
    snd.shot();
  },
  hit: (ev, at) => hit(ev, at),
  slip: (ev, at) => {
    const a = actor(ev.id);
    if (!a) return;
    a.hurtAt = at;
    a.hard = false;
    a.hx = a.left ? 4 : -4;
    a.hy = 0;
    say(a.x, a.y - tallOf(a) - 2, "dodge", WATER[3], { ttl: 0.6 });
    burst(a.x, a.y - 8, 4, [WATER[3], CREAM], { speed: 20, ttl: 0.3, grav: 0 });
    snd.slip();
  },
  cast: (ev, at) => cast(ev, at),
  heal: (ev) => {
    const a = actor(ev.id);
    if (!a) return;
    const quiet = ev.source === "regrow";
    motes(a.x, a.y - 6, quiet ? 2 : 7, [GREEN[4], "#c9ef9a", CREAM]);
    if (quiet) return;
    say(a.x, a.y - tallOf(a) - 2, `+${ev.amount}`, "#c9ef9a", { ttl: 0.7 });
    snd.heal();
  },
  shield: (ev, at) => {
    const a = actor(ev.id);
    if (a) a.shieldAt = at;
    snd.shield();
  },
  status: (ev, at) => status(ev, at),
  boost: (ev) => {
    const a = actor(ev.id);
    if (!a) return;
    say(a.x, a.y - tallOf(a) - 2, `+${ev.amount} attack`, "#f4a08c", { ttl: 0.9 });
    burst(a.x, a.y - 10, 5, ["#f4a08c", GOLD[2]], { speed: 20, grav: -40, ttl: 0.5, toward: UP, spread: 0.7 });
  },
  fall: (ev, at) => {
    const a = actor(ev.id);
    if (!a) return;
    // Knocked off its base, tumbling away from whoever felled it.
    const by = actor(ev.by);
    a.fallAt = at;
    a.tumble = by && by.x > a.x ? -1 : 1;
    a.castUntil = -99;
    a.wind = null;
    weigh("fall");
    const big = isBossId(a.unit.kind);
    if (big || a.unit.stars === 3) bump(big ? 2 : 1);
    burst(a.x, a.y, 5, ["#cbb894", CREAM], { speed: 22, ttl: 0.3, toward: UP, spread: 2.6 });
    snd.fall(big);
  },
  rise: (ev, at) => {
    const a = actor(ev.id);
    if (!a) return;
    a.fallAt = Infinity;
    a.gone = false;
    a.hopAt = at;
    say(a.x, a.y - tallOf(a) - 6, "Second Wind!", GOLD[2], { ttl: 1.4 });
    motes(a.x, a.y - 6, 10, [GOLD[2], CREAM]);
    snd.rise();
  },
  summon: (ev, at) => summon(ev, at),
  trait: (ev, at) => trait(ev, at),
  item: (ev, at) => {
    const a = actor(ev.id);
    if (a) FV.signs.push({ pic: itemPic(ev.item), id: a.unit.id, t0: at });
  },
  dusk: (ev) => {
    if (FV.dusk === 0) {
      say(75, 40, "Dusk falls.", "#cdb6d8", { big: true, ttl: 1.6 });
      snd.dusk();
    }
    FV.dusk = ev.n;
  },
  end: () => undefined,
  // Drawn by `fightmarks.ts`, which `show` hands them to first.
  telegraph: () => undefined,
  zone: () => undefined,
};

/** The colours a look names: its owner's own (`livery.ts`) for `"own"`. */
function coloursOf(kind: UnitKind, named: string | readonly string[] | undefined): readonly string[] | undefined {
  if (named === "own") return ownOf(kind);
  return typeof named === "string" ? [named] : named;
}

/** Where something leaves whoever throws it: a person's hand, and for anyone else chest height over where they stand. */
const handOr = (a: Actor, at: number, from: Pt): Pt =>
  handAt(a, at, fightNow()?.tick ?? 0) ?? { x: from.x, y: from.y - 11 };

/** The mark a thrown ability leaves where it lands on `t`. */
function markAt(a: Actor, t: Actor): () => void {
  const look = LOOKS[a.unit.kind];
  const col = colourOf(a.unit.kind);
  return () => {
    if (!look) return;
    const spot = { x: t.x, y: t.y };
    MARKS[look.mark]({
      ...spot,
      tall: tallOf(t),
      from: { x: a.x, y: a.y },
      cells: [spot],
      hit: [spot],
      col,
      own: ownOf(a.unit.kind),
      shiny: t.unit.items.length > 0,
    });
  };
}

function hit(ev: Events["hit"], at: number): void {
  const a = actor(ev.id);
  if (!a) return;
  if (ev.source === "attack" || ev.source === "ability" || ev.source === "item") struck(a, ev, at);
  else if (ev.source === "burn") {
    burst(a.x, a.y - 6, 3, ["#e67967", GOLD[1], GOLD[2]], { speed: 14, grav: -40, ttl: 0.4, scatter: 8 });
    say(a.x + 6, a.y - 10, String(ev.amount), "#e67967", { ttl: 0.5, rise: 7 });
    snd.burn();
  } else if (ev.source === "thorns") {
    a.hurtAt = at;
    a.hx = 0;
    a.hy = 0;
    say(a.x - 6, a.y - 12, String(ev.amount), GREEN[4], { ttl: 0.5, rise: 7 });
  } else say(a.x, a.y - 12, String(ev.amount), "#cdb6d8", { ttl: 0.5, rise: 6 });
}

/** Struck by an attack, an ability or an item: knocked back, squashed and flushed, sparks, its number, and weight if it landed hard. */
function struck(a: Actor, ev: Events["hit"], at: number): void {
  const by = actor(ev.by);
  const dx = by ? a.x - by.x : 0;
  const dy = by ? a.y - by.y : -1;
  const d = Math.hypot(dx, dy) || 1;
  a.hurtAt = at;
  a.hard = ev.hard;
  a.hx = (dx / d) * (ev.hard ? 4 : 2.5);
  a.hy = (dy / d) * (ev.hard ? 3 : 2);
  const col = ev.soaked >= ev.amount ? WATER[3] : DAMAGE_COL[ev.kind];
  burst(a.x, a.y - 11, ev.hard ? 9 : 4, [col, CREAM], { speed: ev.hard ? 46 : 30, ttl: 0.3 });
  say(
    a.x + (Math.random() - 0.5) * 8,
    a.y - tallOf(a) - 2,
    ev.hard ? `${ev.amount}!` : String(ev.amount),
    ev.hard ? GOLD[2] : col,
    {
      big: ev.hard,
      ttl: 0.7,
    },
  );
  snd.hit(ev.kind, ev.hard);
  if (ev.hard) weigh("hard");
  if (ev.source === "ability" && countHit(ev.by, at) === 2) weigh("many");
}

function cast(ev: Events["cast"], at: number): void {
  const a = actor(ev.id);
  if (!a) return;
  const col = colourOf(ev.kind);
  const look = LOOKS[ev.kind];
  // A Toadstool says its spores as it falls: it stays fallen.
  if (a.fallAt > at) a.castUntil = at + 9;
  const t = actor(ev.targets[0] ?? -1);
  if (t && t !== a) face(a, t);
  // The hexes it covers light one after another, nearest first: a ring, a cone or a line spreading.
  for (const cell of ev.cells) FV.flashes.push({ cell, t0: at + distance(a.unit.cell, cell) * 1.5, col });
  // Its name, small, so that it never covers what it does.
  if (ev.name) say(a.x, a.y - framesOf(ev.kind).tall - 8, ev.name, col, { small: true, ttl: 0.8, rise: 6 });
  if (look?.lands) hold(ev, look, a, t, at);
  else if (look) goesOff(ev, look);
  snd.ability(VOICES[ev.kind] ?? { n: 12, wave: "triangle" });
}

/**
 * An ability that lands later goes off: its hexes are marked until it lands, its owner holds
 * whoever it is for (a person points at them), and its seal and lance hang on them (`spells.ts`).
 * All of it is counted from the step it went off at, `at`.
 */
function hold(ev: Events["cast"], look: Look, a: Actor, t: Actor | undefined, at: number): void {
  showMark({ t: "telegraph", id: ev.id, cells: ev.cells, ticks: ev.ticks }, MARKED);
  if (t) a.held = { at, lands: at + ev.ticks, aim: aimAt(t.x - a.x, t.y - a.y), left: a.left };
  hang(ev.kind, { by: ev.id, to: ev.targets[0] ?? -1 }, at, ev.ticks, () => {
    for (const cell of ev.cells) FV.flashes.push({ cell, t0: at + ev.ticks, col: colourOf(ev.kind) });
    goesOff(ev, look);
    const landing = VOICES[ev.kind]?.lands;
    if (landing) snd.ability(landing);
  });
}

/** An ability going off: its mark (a thrown one leaves its mark where each thing lands instead), and the weight it lands with. */
function goesOff(ev: Events["cast"], look: Look): void {
  const where = atOf(ev);
  if (where && !look.shot) MARKS[look.mark](where);
  if (look.bump) bump(look.bump);
  const stop = look.stop ?? (look.bump ? "big" : null);
  if (stop !== null) weigh(stop);
}

function status(ev: Events["status"], at: number): void {
  const a = actor(ev.id);
  if (!a) return;
  if (!ev.on) {
    if (ev.status === "shield") burst(a.x, a.y - 9, 8, [WATER[3], CREAM], { speed: 34, ttl: 0.35 });
    else if (ev.status === "hidden") {
      burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 34, ttl: 0.45, toward: UP, spread: 2 });
      a.hopAt = at;
      snd.dig();
    }
    return;
  }
  if (ev.status === "stun") snd.stun();
  else if (ev.status === "burn") burst(a.x, a.y - 4, 6, ["#e67967", GOLD[1]], { speed: 20, grav: -30, ttl: 0.4 });
  else if (ev.status === "slow") burst(a.x, a.y - 2, 5, [WATER[2], WATER[3]], { speed: 14, ttl: 0.5 });
  else if (ev.status === "taunt") say(a.x, a.y - tallOf(a) - 2, "!", "#e67967", { big: true, ttl: 0.6 });
  else if (ev.status === "hidden") {
    burst(a.x, a.y, 10, [EARTH[1], EARTH[2], EARTH[0]], { speed: 30, ttl: 0.45, toward: UP, spread: 2 });
    snd.dig();
  } else if (ev.status === "haste")
    burst(a.x, a.y - 6, 6, [CREAM, GOLD[2]], { speed: 26, grav: -50, ttl: 0.4, toward: UP, spread: 0.6 });
  else if (ev.status === "braced") ring(a.x, a.y, 11, STONE[3], 0.35);
}

function summon(ev: Events["summon"], at: number): void {
  const u = FV.pb?.fight.units[ev.id];
  if (!u) return;
  const from = actor(ev.by);
  const spot = feetAt(ev.cell);
  let a = actor(ev.id);
  if (!a) {
    a = actorFor(u, from ? { x: from.x, y: from.y } : spot, at);
    FV.actors[ev.id] = a;
  }
  a.bornAt = at;
  // A bit of somebody comes off them; anyone else just turns up.
  if (from && ev.kind === "glorplet") {
    a.x = from.x;
    a.y = from.y;
    travel(a, spot, at, 5, 8);
    a.landAt = at + 5;
  } else {
    a.x = spot.x;
    a.y = spot.y;
    a.move = null;
  }
  burst(spot.x, spot.y - 4, 10, [colourOf(ev.kind), CREAM], { speed: 28, ttl: 0.4 });
  if (ev.kind === "uncounted" || ev.kind === "biguncounted")
    say(spot.x, spot.y - 16, "Nobody counted this one.", CREAM, { ttl: 1.3 });
  snd.summon();
}

function trait(ev: Events["trait"], at: number): void {
  const col = TRAIT_COLOUR[ev.trait];
  ev.ids.forEach((id, i) => {
    const a = actor(id);
    if (!a) return;
    a.hopAt = at + i * 0.8;
    burst(a.x, a.y - 10, 4, [col, GOLD[2]], { speed: 18, ttl: 0.45, grav: -10 });
  });
  const first = actor(ev.ids[0] ?? -1);
  if (first) {
    FV.signs.push({ pic: traitPic(ev.trait), id: first.unit.id, t0: at });
    say(first.x, first.y - tallOf(first) - 14, `${TRAITS[ev.trait].name}${ev.step > 1 ? ` ${ev.step}` : ""}`, col, {
      ttl: 1,
    });
  }
  if (ev.side === 0) {
    FV.woke?.(ev.trait);
    snd.trait(ev.step);
  }
}

/** Shows one thing the rules say happened, at the step it happened. */
export function show(cue: Cue): void {
  FV.seen.push(cue.ev);
  // Zones, marked lines and pulls are drawn by their own file, which reads the fight as it goes on.
  if (showMark(cue.ev, MARKED)) return;
  on(cue.ev.t, cue.ev, cue.at);
}
/** The fight as the marks see it: always the one on show, at its clock. */
const MARKED = {
  get fight() {
    return fightNow();
  },
  get actors() {
    return FV.actors;
  },
  get clock() {
    return clockNow();
  },
};
function on<K extends keyof Events>(t: K, ev: Events[K], at: number): void {
  ON[t](ev, at);
}

// ---------- every moment ----------

/** Things thrown follow whoever they are thrown at, and land; a fallen figure, its tumble over, goes in a puff. */
export function stepShown(c: number): void {
  stepSpells(c);
  FV.shots = FV.shots.filter((s) => {
    const t = actor(s.target);
    if (t && t.unit.alive) s.to = chestOf(t);
    if (c < s.t0 + s.dur) return true;
    if (s.land) s.land();
    else if (s.look === null) burst(s.to.x, s.to.y, 3, [s.col, CREAM], { speed: 22, ttl: 0.25 });
    return false;
  });
  for (const a of FV.actors) {
    if (!a || a.gone || c < a.fallAt + TUMBLE) continue;
    a.gone = true;
    const big = isBossId(a.unit.kind) || (isFigureId(a.unit.kind) && FIGURES[a.unit.kind].tier === 5);
    puff(a.x + a.tumble * 6, a.y, puffOf(a.unit.kind), big);
  }
}

export function onTraitWoke(fn: (trait: TraitId) => void): void {
  FV.woke = fn;
}
