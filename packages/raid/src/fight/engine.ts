import { chance, mix } from "@sequoia-leaf/core";

/**
 * The fight itself: two parties sit down, and a clock of small steps runs until one side is gone.
 * Everything is decided by the two parties and a seed. `openFight` seats everyone and switches the
 * traits on; `stepFight` moves the clock one step and gives back what happened in it, for a screen;
 * `runFight` goes straight to the end, for the bot and for "skip".
 *
 * A step, in order: things in flight land; once a second burns, regrowth and dusk tick; then every
 * figure still up has its turn (uses its ability if its mana is full, else attacks whoever it is
 * after if they are in reach, else walks a hex toward them).
 */
import { boonNumber } from "../content/boons.ts";
import { abilityNumber, FIGURES, isFigureId, specOf, type Stars, starScale, traitsOf } from "../content/figures.ts";
import { FINISHED, type FinishedId, type ItemId, itemStats } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { TRAIT_IDS, type TraitId, traitNumber } from "../content/traits.ts";
import { backRow, cellAt, CELLS, colOf, distance, HOME_ROWS, seatCell, type Side, stepToward } from "../hex.ts";
import { type Party, type Placed, traitSteps } from "../party.ts";
import { cast } from "./abilities.ts";
import {
  drawnFoe,
  drawOf,
  emit,
  enter,
  flight,
  foesByDraw,
  foesWithin,
  freeNear,
  gainMana,
  heal,
  hurt,
  HZ,
  later,
  leap,
  mostHurt,
  otherSide,
  powered,
  secs,
  shieldUp,
  summon,
  targetable,
} from "./core.ts";
import type { Fight, FightEvent, FightResult, FightSetup, FightSummary, Pending, StatusId, Unit } from "./types.ts";

// ---------- sitting down ----------

/** One of a finished item's numbers. */
const itemNumber = (id: FinishedId, name: string): number => FINISHED[id].n[name] ?? 0;
/** Whether a figure carries a trait. */
const carries = (u: Unit, trait: TraitId): boolean => isFigureId(u.kind) && traitsOf(u.kind).includes(trait);

/** What an item does besides its stats, as numbers on whoever holds it. */
function equip(u: Unit, item: ItemId): void {
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
      break;
  }
}

/** Puts one of a party's figures on its hex, with its stars, its items and its party's boons counted in. */
function seat(f: Fight, side: Side, p: Placed, party: Party): Unit {
  const spec = specOf(p.kind);
  const might = party.might / 100;
  let health = 0;
  let attack = 0;
  let speed = 0;
  let power = 0;
  let armour = 0;
  let ward = 0;
  for (const item of p.items) {
    const s = itemStats(item);
    health += s.health;
    attack += s.attack;
    speed += s.speed;
    power += s.power;
    armour += s.armour;
    ward += s.ward;
  }
  if (p.kind === "greg") health += Math.min(p.fed, traitNumber("greg", "most", 1)) * traitNumber("greg", "grows", 1);
  if (party.boons.includes("smallfry") && isFigureId(p.kind) && FIGURES[p.kind].tier <= 2) {
    health += boonNumber("smallfry", "boost");
    attack += boonNumber("smallfry", "boost");
  }
  const star = starScale(p.stars);
  const home = seatCell(side, p.seat);
  const u = enter(f, {
    side,
    kind: p.kind,
    stars: p.stars,
    cell: f.taken[home] === -1 ? home : freeNear(f, home, 8),
    seat: p.seat,
    summoned: false,
    owner: -1,
    items: p.items.slice(),
    maxHp: spec.hp * star * might * (1 + health / 100),
    attack: spec.attack * star * might * (1 + attack / 100),
    speed: spec.speed * (1 + speed / 100),
    power: (100 + power) * might,
  });
  u.armour += armour;
  u.ward += ward;
  u.draw = drawOf(p.kind, p.items);
  for (const item of p.items) equip(u, item);
  if (party.boons.includes("headstart")) gainMana(u, boonNumber("headstart", "mana"));
  if (party.boons.includes("formation")) {
    const row = Math.floor(p.seat / 7);
    if (row === 0) u.armour += boonNumber("formation", "armour");
    if (row === HOME_ROWS - 1) u.speed *= 1 + boonNumber("formation", "speed") / 100;
  }
  return u;
}

/** Switches a side's traits on, and says so. */
function switchOn(f: Fight, side: Side, party: Party): void {
  const steps = traitSteps(party);
  f.traits[side] = steps;
  const mine = f.units.filter((u) => u.side === side);
  for (const trait of TRAIT_IDS) {
    const step = steps[trait] ?? 0;
    if (step <= 0) continue;
    const v = (name: string): number => traitNumber(trait, name, step);
    const members = mine.filter((u) => carries(u, trait));
    let touched = members;
    switch (trait) {
      case "ember":
        if (v("whole") > 0) touched = mine;
        for (const u of touched) u.ember = v("burn");
        break;
      case "moss":
        touched = mine;
        for (const u of mine) u.regrow += v("regrow");
        break;
      case "mist":
        touched = mine;
        for (const u of mine) {
          u.ward += v("ward");
          u.slip += v("slip");
        }
        break;
      case "burrow":
        for (const u of members) {
          u.armour += v("armour");
          u.digs = true;
          u.digHeal = v("heal");
          u.digLess = v("less");
          u.digFor = v("lasts");
        }
        break;
      case "feather":
        for (const u of members) {
          u.quicken = v("quicken");
          u.quickMost = v("stacks");
        }
        break;
      case "bulwark":
        if (v("party") > 0) touched = mine;
        for (const u of mine) u.armour += carries(u, trait) ? v("armour") : v("party");
        break;
      case "fang":
        for (const u of members) {
          u.attack = Math.round(u.attack * (1 + v("attack") / 100));
          u.crit += v("crit");
        }
        break;
      case "slinger":
        for (const u of members) {
          u.range += v("reach");
          u.focusBy = v("focus");
          u.focusMost = v("most");
        }
        break;
      case "sage":
        for (const u of members) {
          u.power += v("power");
          u.manaMore += v("mana");
        }
        break;
      case "mender":
        for (const u of members) u.mending += v("mending");
        break;
      case "sneak":
        for (const u of members) {
          u.sneakHits = v("hits");
          u.sneakBy = v("extra");
        }
        break;
      case "gnome":
        for (const u of members) {
          u.maxHp = Math.round(u.maxHp * (1 + v("health") / 100));
          u.hp = u.maxHp;
        }
        break;
      case "crab":
      case "greg":
        // Roll call happens once everyone is seated; Greg does his part after the fight.
        break;
    }
    emit(f, { t: "trait", side, trait, step, ids: touched.map((u) => u.id) });
  }
}

/** Roll call: a crab nobody counted turns up beside the first of a side's crabs, as starry as the best of them. */
function rollCall(f: Fight, side: Side): void {
  const step = f.traits[side].crab ?? 0;
  if (step <= 0) return;
  const crabs = f.units.filter((u) => u.side === side && isFigureId(u.kind) && FIGURES[u.kind].kin === "crab");
  const anchor = crabs[0] ?? f.units.find((u) => u.side === side);
  if (!anchor) return;
  let stars: Stars = 1;
  for (const u of crabs) if (u.stars > stars) stars = u.stars;
  if (traitNumber("crab", "big", step) > 0) summon(f, "biguncounted", stars, side, freeNear(f, anchor.cell, 4), null);
  if (traitNumber("crab", "small", step) > 0) summon(f, "uncounted", stars, side, freeNear(f, anchor.cell, 4), null);
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

/** Seats both parties and switches everything on. What happened is in `opening`; the clock has not started. */
export function openFight(setup: FightSetup): Fight {
  const [ours, theirs] = setup.sides;
  const seed = setup.seed >>> 0;
  const taken: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) taken.push(-1);
  const opening: FightEvent[] = [];
  const f: Fight = {
    seed,
    rng: mix(seed, 0x51ed),
    tick: 0,
    units: [],
    taken,
    standing: [0, 0],
    over: false,
    result: null,
    opening,
    traits: [{}, {}],
    dusk: 0,
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
  for (const u of f.units) {
    if (u.kind === "crab" || u.kind === "bigcrab") {
      shieldUp(f, u, powered(u, abilityNumber(u.kind, "shell", u.stars)), 0, null);
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
  let more = u.quick * u.quicken;
  if (u.hasteUntil > f.tick) more += u.hasteBy;
  let speed = u.speed * (1 + more / 100);
  if (u.slowUntil > f.tick) speed *= 1 - u.slowBy / 100;
  return speed;
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
      later(f, wait, () => land(f, u, t, false, blow));
    }
  }
  if (u.quicken > 0 && u.quick < u.quickMost) u.quick++;
}

/**
 * Who a figure goes for: whoever is making it, then whoever it is already on if they are still in
 * reach, then the enemy that seems nearest once draw is counted (`drawnFoe`).
 */
function choose(f: Fight, u: Unit): Unit | undefined {
  if (u.tauntUntil > f.tick) {
    const by = f.units[u.tauntBy];
    if (by && targetable(f, by)) return by;
  }
  const current = u.target >= 0 ? f.units[u.target] : undefined;
  if (current && current.side !== u.side && targetable(f, current) && distance(u.cell, current.cell) <= u.range) {
    return current;
  }
  return drawnFoe(f, u);
}

function walk(f: Fight, u: Unit, t: Unit): void {
  if (u.rooted) return;
  let step = stepToward(u.side, f.taken, u.cell, t.cell, u.range);
  if (step < 0) {
    // Boxed in: see whether anyone else can be got at, in the order it would pick them.
    for (const o of foesByDraw(f, u.side, u.cell)) {
      if (o.id === t.id) continue;
      step = stepToward(u.side, f.taken, u.cell, o.cell, u.range);
      if (step >= 0) {
        u.target = o.id;
        break;
      }
    }
  }
  if (step < 0) {
    u.busyUntil = f.tick + 3;
    return;
  }
  const from = u.cell;
  const slowed = u.slowUntil > f.tick ? u.slowBy : 0;
  const ticks = Math.round((FIGHT.walk * 100) / (100 - Math.min(80, slowed)));
  f.taken[from] = -1;
  f.taken[step] = u.id;
  u.cell = step;
  u.busyUntil = f.tick + ticks;
  emit(f, { t: "move", id: u.id, from, to: step, ticks });
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
  if (u.hiddenUntil > now || u.stunUntil > now) return;
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
  if (distance(u.cell, t.cell) <= u.range) {
    if (u.cool <= 0 && u.attack > 0) strike(f, u, t);
    return;
  }
  walk(f, u, t);
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
    if (u.serveEvery > 0 && f.tick % u.serveEvery === 0) {
      const hungry = mostHurt(f, u.side, true)[0];
      if (hungry) {
        emit(f, { t: "item", id: u.id, item: "stewpot" });
        heal(f, hungry, (hungry.maxHp * u.serveHeal) / 100, "item", u);
      }
    }
  }
  if (second > FIGHT.dusk) {
    f.dusk = second - FIGHT.dusk;
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
