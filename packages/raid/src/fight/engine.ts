import { chance, mix } from "@sequoia-leaf/core";

/**
 * The fight itself: two parties sit down, and a clock of small steps runs until one side is gone.
 * Everything is decided by the two parties and a seed. `openFight` seats everyone and switches the
 * traits on; `stepFight` moves the clock one step and gives back what happened in it, for a screen;
 * `runFight` goes straight to the end, for the bot and for "skip".
 *
 * A step, in order: things in flight land; once a second burns, regrowth, mana by the second and
 * dusk tick; then every figure still up has its turn (uses its ability if its mana is full and it is
 * worth using, else attacks whoever it is after if they are in reach, else walks a hex toward them).
 */
import { boonNumber } from "../content/boons.ts";
import { catalogOf } from "../content/catalog.ts";
import { abilityNumber, figureIn, isFigureId, specOf, type Stars, starScale } from "../content/figures.ts";
import { carries, type ItemId, itemNumber as numberOf, itemStats } from "../content/items.ts";
import { FIGHT, levelBoost } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { backRow, cellAt, colOf, distance, HOME_ROWS, seatCell, type Side, stepToward } from "../hex.ts";
import type { Party, Placed } from "../party.ts";
import { cast } from "./abilities.ts";
import {
  drawOf,
  emit,
  enter,
  flight,
  foesWithin,
  freeNear,
  gainMana,
  heal,
  hurt,
  HZ,
  leap,
  mostHurt,
  otherSide,
  powered,
  secs,
  shieldUp,
  summon,
  targetable,
} from "./core.ts";
import { drawnFoe, fly, foesByDraw, onTarget } from "./mind.ts";
import { slowNow } from "./moves.ts";
import { attackReach, boardFor, ruleSeated, wildsOf } from "./rules.ts";
import { switchOn } from "./switch.ts";
import type { Fight, FightEvent, FightResult, FightSetup, FightSummary, Pending, StatusId, Unit } from "./types.ts";

// ---------- sitting down ----------

/** What an item does besides its stats, as numbers on whoever holds it. */
function equip(f: Fight, u: Unit, item: ItemId): void {
  const itemNumber = (id: ItemId, name: string): number => numberOf(f.cat, id, name);
  switch (item) {
    case "blackthorn":
      u.pierce = itemNumber(item, "pierce");
      break;
    case "wasptail":
      u.twice = itemNumber(item, "every");
      break;
    case "glowthorn":
      u.manaMore += itemNumber(item, "mana");
      break;
    case "hedgehog":
      u.prickle += itemNumber(item, "prickle");
      break;
    case "conker":
      u.clip += itemNumber(item, "clip");
      break;
    case "hummingbird":
      u.range += itemNumber(item, "reach");
      break;
    case "mothlantern":
      if (u.manaFull > 0) u.mana = Math.max(u.mana, Math.round((u.manaFull * itemNumber(item, "head")) / 100));
      break;
    case "quilt":
      u.slip += itemNumber(item, "slip");
      break;
    case "honeycake":
      u.leech += itemNumber(item, "leech");
      break;
    case "fairyring":
      u.powerGrow += itemNumber(item, "grow");
      break;
    case "lichen":
      u.castShield += itemNumber(item, "shield");
      u.castShieldFor = itemNumber(item, "lasts");
      break;
    case "stewpot":
      u.serveEvery = secs(itemNumber(item, "every"));
      u.serveHeal = itemNumber(item, "heal");
      break;
    case "stump":
      u.noHard = true;
      u.stunCut = itemNumber(item, "steady");
      break;
    case "hollowlog":
      u.logUnder = itemNumber(item, "under");
      u.logShield = itemNumber(item, "shield");
      u.logFor = itemNumber(item, "lasts");
      break;
    case "hoard":
      u.regrow += itemNumber(item, "regrow");
      break;
    case "thorn":
    case "plume":
    case "glowcap":
    case "bark":
    case "chestnut":
    // An emblem's trait is in what its holder carries, and its stats are counted with everyone's.
    case "embercharm":
    case "mosscharm":
    case "mistcharm":
    case "burrowcharm":
    case "feathercharm":
    case "crabcharm":
    case "gnomecharm":
      break;
  }
}

/** Puts one of a party's figures on its hex, with its stars, its level, its items and its party's boons counted in. */
function seat(f: Fight, side: Side, p: Placed, party: Party): Unit {
  const spec = specOf(f.cat, p.kind);
  const might = party.might / 100;
  let health = 0;
  let attack = 0;
  let speed = 0;
  let power = 0;
  let armour = 0;
  let ward = 0;
  for (const item of p.items) {
    const s = itemStats(f.cat, item);
    health += s.health;
    attack += s.attack;
    speed += s.speed;
    power += s.power;
    armour += s.armour;
    ward += s.ward;
  }
  // What Greg has eaten: percent of his health, for good.
  if (p.kind === "greg") health += Math.min(p.fed, traitNumber(f.cat, "greg", "most", 1));
  if (party.boons.includes("smallfry") && isFigureId(p.kind) && figureIn(f.cat, p.kind).tier <= 2) {
    health += boonNumber(f.cat, "smallfry", "boost");
    attack += boonNumber(f.cat, "smallfry", "boost");
  }
  const star = starScale(p.stars) * (1 + levelBoost(p.level ?? 0) / 100);
  const u = enter(f, {
    side,
    kind: p.kind,
    stars: p.stars,
    // Its seat, or (should a rule have closed it) the nearest free hex.
    cell: freeNear(f, seatCell(side, p.seat), 8),
    seat: p.seat,
    summoned: false,
    owner: -1,
    items: p.items.slice(),
    grown: star * might,
    maxHp: spec.hp * star * might * (1 + health / 100),
    attack: spec.attack * star * might * (1 + attack / 100),
    speed: spec.speed * (1 + speed / 100),
    power: (100 + power) * might,
  });
  u.armour += armour;
  u.ward += ward;
  u.draw = drawOf(f.cat, p.kind, p.items);
  for (const item of p.items) equip(f, u, item);
  if (party.boons.includes("headstart")) gainMana(u, boonNumber(f.cat, "headstart", "mana"));
  if (party.boons.includes("formation")) {
    const row = Math.floor(p.seat / 7);
    if (row === 0) u.armour += boonNumber(f.cat, "formation", "armour");
    if (row === HOME_ROWS - 1) u.speed *= 1 + boonNumber(f.cat, "formation", "speed") / 100;
  }
  return u;
}

/**
 * Roll call: a crab nobody counted turns up beside the first of a side's crabs (whoever carries Crab,
 * a Crab emblem's holder too), as starry as the best of them.
 */
function rollCall(f: Fight, side: Side): void {
  const step = f.traits[side].crab ?? 0;
  if (step <= 0) return;
  const crabs = f.units.filter((u) => u.side === side && carries(f.cat, u.kind, u.items, "crab"));
  const anchor = crabs[0] ?? f.units.find((u) => u.side === side);
  if (!anchor) return;
  const stars = crabs.reduce<Stars>((most, u) => (u.stars > most ? u.stars : most), 1);
  if (traitNumber(f.cat, "crab", "big", step) > 0)
    summon(f, "biguncounted", stars, side, freeNear(f, anchor.cell, 4), null);
  if (traitNumber(f.cat, "crab", "small", step) > 0)
    summon(f, "uncounted", stars, side, freeNear(f, anchor.cell, 4), null);
}

/** Sneaks with their trait on, and magpies always, start by getting round the back. */
function leaps(f: Fight): void {
  for (const u of f.units.slice()) {
    const sneaks = u.sneakBy > 0 || u.kind === "magpie";
    if (!sneaks || !u.alive || u.rooted) continue;
    const to = freeNear(f, cellAt(colOf(u.cell), backRow(otherSide(u.side))), 3);
    if (to >= 0) leap(f, u, to, "sneak");
    u.busyUntil = 0;
  }
}

/**
 * Seats both parties and switches everything on, by the catalogue of the setup's era (a test may
 * hand it a made-up one). What happened is in `opening`; the clock has not started.
 */
export function openFight(setup: FightSetup, cat = catalogOf(setup)): Fight {
  const [ours, theirs] = setup.sides;
  const seed = setup.seed >>> 0;
  const taken = boardFor(setup);
  const opening: FightEvent[] = [];
  const f: Fight = {
    seed,
    cat,
    rng: mix(seed, 0x51ed),
    tick: 0,
    units: [],
    taken,
    zones: taken.map(() => null),
    standing: [0, 0],
    over: false,
    result: null,
    opening,
    traits: [{}, {}],
    dusk: 0,
    falls: 0,
    wilds: wildsOf(setup),
    out: opening,
    pending: [],
    boons: [ours.boons, theirs.boons],
    might: [ours.might, theirs.might],
    wind: [ours.boons.includes("secondwind"), theirs.boons.includes("secondwind")],
  };
  // Seated turn and turn about, starting with a side the seed picks, so neither always moves first.
  const first: Side = (seed & 1) === 0 ? 0 : 1;
  const order: readonly Side[] = [first, otherSide(first)];
  const lists = [ours, theirs].map((party) => party.figures.toSorted((a, b) => a.seat - b.seat));
  const longest = Math.max(ours.figures.length, theirs.figures.length);
  for (let i = 0; i < longest; i++) {
    for (const side of order) {
      const p = lists[side]?.[i];
      if (p) seat(f, side, p, setup.sides[side]);
    }
  }
  for (const side of order) switchOn(f, side, setup.sides[side]);
  ruleSeated(f, setup);
  for (const u of f.units) {
    if (u.kind === "crab" || u.kind === "bigcrab") {
      shieldUp(f, u, powered(u, abilityNumber(f.cat, u.kind, "shell", u.stars)), 0, null);
    }
  }
  for (const side of order) rollCall(f, side);
  leaps(f);
  for (const u of f.units) {
    u.attack0 = u.attack;
    u.busyUntil = 0;
  }
  judge(f);
  f.out = [];
  return f;
}

// ---------- the clock ----------

/** Attacks a second, with everything timed counted in. */
export function speedNow(f: Fight, u: Unit): number {
  const more = u.quick * u.quicken + (u.hasteUntil > f.tick ? u.hasteBy : 0);
  return u.speed * (1 + more / 100) * (1 - slowNow(f, u) / 100);
}

/**
 * What an attack takes with it from the moment it is made: how hard its maker hit then, and how
 * likely it was to land hard. A shot in the air is not made stronger, or weaker, by what happens to
 * its maker before it arrives, and it still arrives if its maker has fallen.
 */
interface Blow {
  readonly attack: number;
  readonly crit: number;
}
const blowOf = (u: Unit): Blow => ({ attack: u.attack, crit: u.crit });

/**
 * An attack arrives, as strong as it was made (`blow`). Whether it slips and whether it lands hard
 * are rolled as it arrives, in that order, so a fight draws its chances in the order it always has;
 * the odds of landing hard are its maker's when it was made.
 */
function land(f: Fight, u: Unit, t: Unit, upClose: boolean, blow: Blow): void {
  if (!targetable(f, t)) return;
  if (t.slip > 0 && chance(f) * 100 < t.slip) {
    emit(f, { t: "slip", id: t.id, by: u.id });
    return;
  }
  let amount = blow.attack;
  let hard = false;
  if (u.sneakHits > 0) {
    // A Sneak's first hits land hard, unless what they land on cannot be hit hard.
    u.sneakHits--;
    if (!t.noHard) {
      hard = true;
      amount *= 1 + u.sneakBy / 100;
    }
  } else if (blow.crit > 0 && !t.noHard && chance(f) * 100 < blow.crit) {
    hard = true;
    amount *= 1 + FIGHT.hard / 100;
  }
  if (u.focusBy > 0) {
    // A Slinger's aim builds while it keeps to one target.
    if (u.focusOn !== t.id) {
      u.focusOn = t.id;
      u.focus = 0;
    } else if (u.focus < u.focusMost) u.focus++;
    amount *= 1 + (u.focus * u.focusBy) / 100;
  }
  const dealt = hurt(f, t, amount, "physical", "attack", u, hard);
  if (dealt <= 0) return;
  if (u.leech > 0) heal(f, u, (dealt * u.leech) / 100, "leech", null);
  if (u.clip > 0) {
    const beside = foesWithin(f, u.side, t.cell, 1).find((o) => o.id !== t.id);
    if (beside) hurt(f, beside, (amount * u.clip) / 100, "physical", "item", u);
  }
  if (upClose && u.alive) {
    const back = t.thorns + (t.bracedUntil > f.tick ? t.stub : 0);
    if (back > 0) hurt(f, u, back, "physical", "thorns", t);
    if (t.prickle > 0 && u.alive) hurt(f, u, (t.maxHp * t.prickle) / 100, "magic", "thorns", t);
  }
}

function strike(f: Fight, u: Unit, t: Unit): void {
  u.cool += HZ / speedNow(f, u);
  u.target = t.id;
  u.attacks++;
  gainMana(u, FIGHT.manaAttack + u.manaMore);
  const twice = u.twice > 0 && u.attacks % u.twice === 0;
  if (twice) emit(f, { t: "item", id: u.id, item: "wasptail" });
  if (distance(u.cell, t.cell) <= 1) {
    emit(f, { t: "swing", id: u.id, target: t.id });
    land(f, u, t, true, blowOf(u));
    if (twice) land(f, u, t, true, blowOf(u));
  } else {
    // Thrown now, with the strength it has now, however long it is in the air.
    const blow = blowOf(u);
    const ticks = flight(u.cell, t.cell);
    for (let n = 0; n < (twice ? 2 : 1); n++) {
      const wait = ticks + n * 2;
      emit(f, { t: "shot", id: u.id, target: t.id, from: u.cell, to: t.cell, ticks: wait, what: "attack" });
      fly(f, t, blow.attack, "physical", wait, () => land(f, u, t, false, blow));
    }
  }
  if (u.quicken > 0 && u.quick < u.quickMost) u.quick++;
}

/**
 * Who a figure goes for: whoever is making it, then whoever it is already on if they are still in
 * reach and not already done for (`onTarget`), then the enemy it would pick anew (`drawnFoe`).
 */
function choose(f: Fight, u: Unit): Unit | undefined {
  if (u.tauntUntil > f.tick) {
    const by = f.units[u.tauntBy];
    if (by && targetable(f, by)) return by;
  }
  return onTarget(f, u) ?? drawnFoe(f, u);
}

/**
 * Takes a step toward a hex it can attack from. It makes for whoever it is after, if there is a way;
 * else whoever it was on its way to already; else whoever else it can get at, in the order it would
 * pick them, so that it neither queues behind one it cannot get at nor turns about between two.
 * If that one is in its reach already (it was made to go for somebody out of the way), it takes no
 * step and gives them back to be attacked.
 */
function walk(f: Fight, u: Unit, t: Unit): Unit | undefined {
  if (u.rooted) return undefined;
  const range = attackReach(f, u);
  const foes = foesByDraw(f, u);
  const cells = foes.map((o) => o.cell);
  const way = (o: Unit, reach = range): number => stepToward(u.side, f.taken, u.cell, o.cell, reach, cells);
  let step = -1;
  for (const o of [t, foes.find((h) => h.id === u.target), ...foes]) {
    if (o === undefined) continue;
    if (distance(u.cell, o.cell) <= range) return o;
    step = way(o);
    if (step < 0) continue;
    if (o !== t) u.target = o.id;
    break;
  }
  // With no way to anybody it closes up on the one it is after, and then stands.
  for (let reach = range + 1; step < 0 && reach < distance(u.cell, t.cell); reach++) step = way(t, reach);
  if (step < 0) {
    u.busyUntil = f.tick + 3;
    return undefined;
  }
  const from = u.cell;
  const ticks = Math.round((FIGHT.walk * 100) / (100 - Math.min(80, slowNow(f, u))));
  f.taken[from] = -1;
  f.taken[step] = u.id;
  u.cell = step;
  u.busyUntil = f.tick + ticks;
  emit(f, { t: "move", id: u.id, from, to: step, ticks });
  return undefined;
}

function off(f: Fight, u: Unit, status: StatusId): void {
  emit(f, { t: "status", id: u.id, status, on: false, ticks: 0, amount: 0, by: -1 });
}
/** Statuses that run out at this step say so. */
function expire(f: Fight, u: Unit): void {
  const now = f.tick;
  if (u.stunUntil === now) off(f, u, "stun");
  if (u.slowUntil === now) off(f, u, "slow");
  if (u.burnUntil === now) off(f, u, "burn");
  if (u.tauntUntil === now) off(f, u, "taunt");
  if (u.hasteUntil === now) off(f, u, "haste");
  if (u.bracedUntil === now) off(f, u, "braced");
  if (u.shieldUntil === now && u.shield > 0) {
    u.shield = 0;
    off(f, u, "shield");
  }
  if (u.hiddenUntil === now) off(f, u, "hidden");
}

function act(f: Fight, u: Unit): void {
  const now = f.tick;
  // Hidden or stunned: nothing until it ends.
  if (Math.max(u.hiddenUntil, u.stunUntil) > now) return;
  if (u.cool > 0) u.cool -= 1;
  if (u.busyUntil > now) return;
  if (u.manaFull > 0 && u.mana >= u.manaFull && cast(f, u)) {
    u.mana = 0;
    u.casts++;
    u.busyUntil = Math.max(u.busyUntil, now + FIGHT.cast);
    if (u.powerGrow > 0) {
      u.power += u.powerGrow;
      emit(f, { t: "item", id: u.id, item: "fairyring" });
    }
    if (u.castShield > 0 && u.alive) {
      emit(f, { t: "item", id: u.id, item: "lichen" });
      shieldUp(f, u, (u.maxHp * u.castShield) / 100, u.castShieldFor, null);
    }
    return;
  }
  const t = choose(f, u);
  if (!t) return;
  const at = distance(u.cell, t.cell) <= attackReach(f, u) ? t : walk(f, u, t);
  if (at && u.cool <= 0 && u.attack > 0) strike(f, u, at);
}

/** Once a second: burns bite, the regrowing regrow, the Stewpot goes round, and after dusk everyone hurts. */
function everySecond(f: Fight): void {
  const second = f.tick / HZ;
  for (const u of f.units) {
    if (!u.alive) continue;
    if (u.burnUntil >= f.tick && u.burnBy > 0) {
      hurt(f, u, (u.maxHp * u.burnBy) / 100, "true", "burn", f.units[u.burnFrom] ?? null);
      if (!u.alive) continue;
    }
    if (u.regrow > 0) heal(f, u, (u.maxHp * u.regrow) / 100, "regrow", null);
    if (u.manaRate > 0) gainMana(u, u.manaRate);
    if (u.serveEvery > 0 && f.tick % u.serveEvery === 0) {
      const hungry = mostHurt(f, u.side, true)[0];
      if (hungry) {
        emit(f, { t: "item", id: u.id, item: "stewpot" });
        heal(f, hungry, (hungry.maxHp * u.serveHeal) / 100, "item", u);
      }
    }
  }
  if (second > f.wilds.dusk) {
    f.dusk = second - f.wilds.dusk;
    emit(f, { t: "dusk", n: f.dusk });
    for (const u of f.units) {
      if (u.alive) hurt(f, u, (u.maxHp * FIGHT.duskGrows * f.dusk) / 100, "true", "dusk", null);
    }
  }
}

function judge(f: Fight): void {
  if (f.over) return;
  const [ours, theirs] = f.standing;
  let result: FightResult | null = null;
  if (ours <= 0 && theirs <= 0) result = "draw";
  else if (theirs <= 0) result = "win";
  else if (ours <= 0) result = "loss";
  else if (f.tick >= FIGHT.cap * HZ) result = "draw";
  if (result === null) return;
  f.over = true;
  f.result = result;
  emit(f, { t: "end", result, tick: f.tick, standing: [Math.max(0, ours), Math.max(0, theirs)] });
}

function advance(f: Fight): void {
  f.tick++;
  if (f.pending.length > 0) {
    const due: Pending[] = [];
    const rest: Pending[] = [];
    for (const p of f.pending) (p.at <= f.tick ? due : rest).push(p);
    f.pending = rest;
    for (const p of due) p.land();
  }
  if (f.tick % HZ === 0) everySecond(f);
  for (const u of f.units) {
    if (!u.alive) continue;
    expire(f, u);
    act(f, u);
  }
  judge(f);
}

/** Moves the clock one step and gives back what happened in it, in order. Nothing, once the fight is over. */
export function stepFight(f: Fight): FightEvent[] {
  if (f.over) return [];
  const out: FightEvent[] = [];
  f.out = out;
  advance(f);
  return out;
}

/** How a fight stands, or ended: who is up, and what everyone did. */
export function summarise(f: Fight): FightSummary {
  return {
    result: f.result ?? "draw",
    ticks: f.tick,
    seconds: f.tick / HZ,
    standing: [Math.max(0, f.standing[0]), Math.max(0, f.standing[1])],
    dusk: f.dusk > 0,
    units: f.units.map((u) => ({
      id: u.id,
      side: u.side,
      kind: u.kind,
      stars: u.stars,
      summoned: u.summoned,
      alive: u.alive,
      hp: Math.max(0, u.hp),
      maxHp: u.maxHp,
      dealt: u.dealt,
      taken: u.taken,
      healed: u.healed,
      casts: u.casts,
    })),
  };
}

/** Runs a fight on to its end without keeping what happened on the way. */
export function runFight(f: Fight): FightSummary {
  const scratch: FightEvent[] = [];
  f.out = scratch;
  while (!f.over) {
    scratch.length = 0;
    advance(f);
  }
  f.out = [];
  return summarise(f);
}

/** A whole fight from its setup, in one call. */
export const resolveFight = (setup: FightSetup): FightSummary => runFight(openFight(setup));

/** A whole fight from its setup, with everything that happened: the opening, then one list for each step. */
export function recordFight(setup: FightSetup): {
  opening: FightEvent[];
  steps: FightEvent[][];
  summary: FightSummary;
} {
  const f = openFight(setup);
  const steps: FightEvent[][] = [];
  while (!f.over) steps.push(stepFight(f));
  return { opening: f.opening, steps, summary: summarise(f) };
}
