/**
 * The town and the camp as Leaf plays them: what the member keeps (the camp, its mail, a few
 * counters) and what Leaf decides for them (who calls, the mail while they were away, the day), one
 * command for each thing a member does, and what their page is shown. The town is not a simulation:
 * `advance` only sends the next caller when one is due, and hands over trophies won elsewhere.
 *
 * Every draw comes from the state's own stream (`rng`), which the page is never shown. It is not
 * stirred with Leaf's dice for each call, because the page is shown what a caller brings and what
 * the arrival letter will post before either is done, and Leaf must then do the same. Every id (of a
 * thing set out, a caller, a letter, a purchase) is made from one counter (`made`), never used twice.
 */
import {
  chance,
  type CoinChange,
  type Ctx,
  DAILY_CHEST,
  type Done,
  type Game,
  LOGGED,
  type Logged,
  mix,
  pick,
  type Refused,
  utcDay,
} from "@sequoia-leaf/core";

import {
  type Camp,
  campFull,
  canPlace,
  CGH,
  CGW,
  isPet,
  MOST_OWNED,
  MOST_PARCELS,
  newCamp,
  owned,
  type PetId,
  type Placed,
  readCamp,
  type Verdict,
} from "./camp.ts";
import { STALLS } from "./catalogue.ts";
import { type AwayCall, type Caller, CALLERS, capital, FIRST_CALL, folk, GIFTS, NOTES, WHILE_AWAY } from "./folk.ts";
import { isLetter, type Letter, letter, post, tidied } from "./mail.ts";
import { isThing, thingOf, turnsOf } from "./things.ts";

// ---------- the state ----------

/** One of the town's own waiting at the camp: its id, who, and what it brings (a note, a present, both or neither). */
export interface Visit {
  id: number;
  who: Caller;
  note: string;
  gift: string;
}

/** Everything Leaf keeps of one member's town and camp. */
export interface Town {
  /** How often the missing crab has been spotted, and Leaf's clock when it last was. */
  sightings: number;
  spotAt: number;
  /** The UTC days (`utcDay`) the chest last paid and the member was last welcomed; -1 for never. */
  chestDay: number;
  welcomedDay: number;
  /** Leaf's clock when the member was last here; 0 for never. */
  seenAt: number;
  /** The last of the member's own news their page has told them; null for none yet. */
  cursor: number | null;
  /** Whether the member's character stays in town, dozing, for a day after they go. */
  stay: boolean;
  camp: Camp;
  /** The caller waiting at the camp, if any. */
  visit: Visit | null;
  /** When the next caller sets out, by Leaf's clock. */
  nextCall: number;
  /** Leaf's stream, and the counter every id and key is made from. */
  rng: number;
  made: number;
}

/** What the arrival letter says and brings if it is put away now. */
export interface Arrival {
  /** The member's first time here. */
  first: boolean;
  /** The first welcome of a UTC day. */
  newDay: boolean;
  /** How long the member was away, in milliseconds; 0 for a first visit. */
  away: number;
  /** What the town's own did meanwhile, a line each. */
  said: string[];
  /** The letters they left, which putting the letter away posts. */
  mail: Letter[];
}

/** What the member's page is given: the state without its stream, its counter or when the next caller comes, and the arrival letter. */
export type TownView = Omit<Town, "rng" | "made" | "nextCall"> & { arrival: Arrival };

// ---------- commands ----------

/** Where the page proposes a thing goes: a square, and which way round. */
interface At {
  x: number;
  y: number;
  t: number;
}

/** Everything a member does in town and at their camp. Things are named by their id, never by a place in a list. */
export type TownCommand =
  /** The arrival letter is put away: the mail while away is posted, and the member is welcomed and here. */
  | { do: "welcome"; cursor: number | null }
  /** The member is still here; their page has told them their news as far as `cursor`. */
  | { do: "here"; cursor: number | null }
  | { do: "openChest" }
  | { do: "spotCrab" }
  | { do: "buy"; stall: string; thing: string }
  | { do: "choosePet"; pet: PetId }
  /** The caller waiting, by its id. */
  | { do: "greet"; visit: number }
  | { do: "readMail" }
  | ({ do: "takePresent"; letter: string } & At)
  | { do: "clearLetters" }
  /** The first parcel waiting by the trail. */
  | ({ do: "unpack" } & At)
  | ({ do: "setOut"; thing: string } & At)
  /** Moving and turning: the page works out where, the rules check it. */
  | ({ do: "move"; n: number } & At)
  | { do: "putAway"; n: number }
  /** A lantern lit or dark, a colour, a gnome turned. */
  | { do: "toggle"; n: number }
  | { do: "stay"; on: boolean };

/** Where a thing that arrived went: set down as the page proposed, or into the tray. */
export type TownNote = { t: "landed"; thing: string; n: number } | { t: "tray"; thing: string };

/** Why a command may not be done, besides where a thing may not stand (`Verdict`). */
export type Why =
  | Exclude<Verdict, "ok">
  | "opened_today"
  | "too_soon"
  | "not_for_sale"
  | "trail_full"
  | "plenty"
  | "pet_chosen"
  | "no_such_visit"
  | "no_present"
  | "no_parcel"
  | "not_in_tray"
  | "cannot_turn"
  | "no_such_thing"
  | "rooted"
  | "nothing_to_toggle";

/** How often a caller sets out: 46 to 76 seconds after the last. */
export const CALLS = { least: 46_000, more: 30_000 } as const;
/** How soon the missing crab can be spotted again. */
export const SPOT_EVERY = 5000;
const HOUR = 3_600_000;
/** How many colours a paper lantern, a pane of glass or a pennant comes in. */
export const COLOURS = 5;
/** What a touch changes, and keeps, for the things that keep a state: lit or dark, a colour, which way round. */
const TOGGLES: Readonly<Record<string, "lit" | "colour" | "turn">> = {
  "lantern-post": "lit",
  "candle-stump": "lit",
  "paper-lantern": "colour",
  "glass-lantern": "colour",
  pennant: "colour",
  gnome: "turn",
};

// ---------- what Leaf decides ----------

/** The next number of the state's counter. */
const next = (s: { made: number }): number => s.made++;

/** The letter a call leaves, if it brings anything. */
const leftBy = (id: string, c: { who: string; note: string; gift: string }): Letter =>
  letter(id, c.who, c.note || "This is for you.", c.gift);

/** A caller leaves: what they brought goes in the mailbox if there is room, as a letter named by the visit. */
function leave(s: Town, visit: Visit): void {
  if (visit.note !== "" || visit.gift !== "")
    post(s.camp.letters, leftBy(`v-${visit.id}`, { ...visit, who: folk(visit.who).name }));
  s.visit = null;
}

/** The next caller sets out, with today's odds: a present two times in five, a note seven times in ten. */
function call(s: Town, now: number): void {
  if (s.visit) leave(s, s.visit);
  const who = pick(s, CALLERS);
  const r = chance(s);
  s.visit = { id: next(s), who, note: r < 0.7 ? pick(s, NOTES[who]) : "", gift: r < 0.4 ? pick(s, GIFTS) : "" };
  s.nextCall = now + CALLS.least + Math.floor(chance(s) * CALLS.more);
}

/**
 * The arrival letter, drawn from `o` (a copy of the state's stream and counter, which it moves on):
 * a first visit brings Tindra's mushroom; an hour away, a line and a letter from one of the town's
 * own; six hours, a caller's letter with a present too.
 */
function arrivalOf(s: Town, o: { rng: number; made: number }, now: number): Arrival {
  const first = s.seenAt === 0;
  const away = first ? 0 : Math.max(0, now - s.seenAt);
  const said: string[] = [];
  const mail: Letter[] = [];
  const from = (c: AwayCall): void => {
    const name = folk(c.who).name;
    said.push(`${capital(name)} ${c.did}`);
    mail.push(leftBy(`w-${next(o)}`, { who: name, note: c.note, gift: c.gift }));
  };
  if (first) from(FIRST_CALL);
  if (away >= HOUR) from(pick(o, WHILE_AWAY));
  if (away >= 6 * HOUR) {
    const who = pick(o, CALLERS);
    mail.push(leftBy(`w-${next(o)}`, { who: folk(who).name, note: pick(o, NOTES[who]), gift: pick(o, GIFTS) }));
  }
  return { first, newDay: s.welcomedDay !== utcDay(now), away, said, mail };
}

/** The furthest of two places in the member's news. */
const further = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * The state at `ctx.now`: the trophies the member has won elsewhere that the camp has not had go
 * by the trail, while there is room there; and when a caller is due, the one waiting leaves and the
 * next sets out. At most one caller each call: time nobody was here for is not made up.
 */
function advance(state: Town, ctx: Ctx): Town {
  const won = ctx.awards.filter((id) => isThing(id) && !state.camp.earned.includes(id));
  const due = ctx.now >= state.nextCall;
  if (!due && (won.length === 0 || state.camp.parcels.length >= MOST_PARCELS)) return state;
  const s = structuredClone(state);
  for (const id of won) {
    if (s.camp.parcels.length >= MOST_PARCELS) break;
    s.camp.earned.push(id);
    // One more of a thing the member has as many of as may be had is won, and simply not added.
    if (owned(s.camp, id) < MOST_OWNED) s.camp.parcels.push(id);
  }
  if (due) call(s, ctx.now);
  return s;
}

// ---------- doing things ----------

type Answer = Done<Town, TownNote> | Refused;
const no = (why: Why): Refused => ({ refused: why });
const done = (s: Town, notes: TownNote[] = [], more: { coins?: CoinChange[]; log?: Logged[] } = {}): Answer => ({
  state: s,
  notes,
  ...more,
});

/** Whether a thing may stand at a square, turned so; `skip` is the thing being moved, by its place in the list. */
function standing(placed: readonly Placed[], id: string, at: At, skip = -1): Verdict | "cannot_turn" {
  const thing = thingOf(id);
  if (!thing || at.t >= turnsOf(thing)) return "cannot_turn";
  return canPlace(placed, id, at.x, at.y, at.t, skip);
}

/** A thing arriving in the camp: set down where the page proposes if it may stand there, else into the tray. */
function land(s: Town, id: string, at: At): TownNote {
  if (!campFull(s.camp.placed) && standing(s.camp.placed, id, at) === "ok") {
    const n = next(s);
    s.camp.placed.push({ n, id, x: at.x, y: at.y, t: at.t, s: 0 });
    return { t: "landed", thing: id, n };
  }
  s.camp.tray[id] = (s.camp.tray[id] ?? 0) + 1;
  return { t: "tray", thing: id };
}

function apply(state: Town, c: TownCommand, ctx: Ctx): Answer {
  const s = structuredClone(state);
  const { camp } = s;
  const { now } = ctx;
  const at = (n: number): number => camp.placed.findIndex((p) => p.n === n);
  switch (c.do) {
    case "welcome": {
      for (const l of arrivalOf(s, s, now).mail) post(camp.letters, l);
      s.welcomedDay = utcDay(now);
      s.seenAt = now;
      s.cursor = further(s.cursor, c.cursor);
      return done(s);
    }
    case "here":
      s.seenAt = now;
      s.cursor = further(s.cursor, c.cursor);
      return done(s);
    case "openChest": {
      const day = utcDay(now);
      if (s.chestDay === day) return no("opened_today");
      s.chestDay = day;
      return done(s, [], {
        coins: [{ amount: DAILY_CHEST, reason: "The chest by the Treasury", key: `chest:${day}`, free: true }],
      });
    }
    case "spotCrab":
      if (now - s.spotAt < SPOT_EVERY) return no("too_soon");
      s.sightings = Math.min(1e6, s.sightings + 1);
      s.spotAt = now;
      return done(s);
    case "buy": {
      const sold = STALLS.find((st) => st.id === c.stall)?.stock.find((k) => k.thing === c.thing);
      if (!sold) return no("not_for_sale");
      if (camp.parcels.length >= MOST_PARCELS) return no("trail_full");
      if (owned(camp, sold.thing) >= MOST_OWNED) return no("plenty");
      camp.parcels.push(sold.thing);
      return done(s, [], {
        coins: [{ amount: -sold.price, reason: "A thing for the camp", key: `buy:${next(s)}` }],
        log: [{ kind: LOGGED.townBought, data: { thing: sold.thing, price: sold.price } }],
      });
    }
    case "choosePet":
      if (camp.first !== "") return no("pet_chosen");
      camp.first = c.pet;
      return done(s, [], { log: [{ kind: LOGGED.townPet, data: { pet: c.pet } }] });
    case "greet":
      if (s.visit?.id !== c.visit) return no("no_such_visit");
      camp.greeted = Math.min(999, camp.greeted + 1);
      leave(s, s.visit);
      return done(s);
    case "readMail":
      for (const l of camp.letters) l.read = true;
      return done(s);
    case "takePresent": {
      const l = camp.letters.find((m) => m.id === c.letter);
      if (!l || l.gift === "" || l.taken) return no("no_present");
      if (owned(camp, l.gift) >= MOST_OWNED) return no("plenty");
      l.taken = true;
      return done(s, [land(s, l.gift, c)]);
    }
    case "clearLetters":
      camp.letters = tidied(camp.letters);
      return done(s);
    case "unpack": {
      const id = camp.parcels.shift();
      if (id === undefined) return no("no_parcel");
      const log: Logged[] = thingOf(id)?.kind === "trophies" ? [{ kind: LOGGED.townTrophy, data: { thing: id } }] : [];
      return done(s, [land(s, id, c)], { log });
    }
    case "setOut": {
      if ((camp.tray[c.thing] ?? 0) < 1) return no("not_in_tray");
      if (campFull(camp.placed)) return no("full");
      const v = standing(camp.placed, c.thing, c);
      if (v !== "ok") return no(v);
      const left = (camp.tray[c.thing] ?? 0) - 1;
      if (left > 0) camp.tray[c.thing] = left;
      else delete camp.tray[c.thing];
      camp.placed.push({ n: next(s), id: c.thing, x: c.x, y: c.y, t: c.t, s: 0 });
      return done(s);
    }
    case "move": {
      const i = at(c.n);
      const p = camp.placed[i];
      if (!p) return no("no_such_thing");
      const v = standing(camp.placed, p.id, c, i);
      if (v !== "ok") return no(v);
      p.x = c.x;
      p.y = c.y;
      p.t = c.t;
      return done(s);
    }
    case "putAway": {
      const i = at(c.n);
      const p = camp.placed[i];
      if (!p) return no("no_such_thing");
      if (thingOf(p.id)?.rooted) return no("rooted");
      camp.placed.splice(i, 1);
      camp.tray[p.id] = (camp.tray[p.id] ?? 0) + 1;
      return done(s);
    }
    case "toggle": {
      const p = camp.placed[at(c.n)];
      if (!p) return no("no_such_thing");
      const what = TOGGLES[p.id];
      if (what === "lit") p.s = p.s === 0 ? 1 : 0;
      else if (what === "colour") p.s = (p.s + 1) % COLOURS;
      else if (what === "turn") p.t = (p.t + 1) % 2;
      else return no("nothing_to_toggle");
      return done(s);
    }
    case "stay":
      s.stay = c.on;
      return done(s);
  }
}

// ---------- what the page is shown ----------

/** The state as the member's page is given it. Each field is named, so nothing new is shown by accident. */
export const townView = (s: Town, now: number): TownView => ({
  sightings: s.sightings,
  spotAt: s.spotAt,
  chestDay: s.chestDay,
  welcomedDay: s.welcomedDay,
  seenAt: s.seenAt,
  cursor: s.cursor,
  stay: s.stay,
  camp: s.camp,
  visit: s.visit,
  // Drawn from a copy of the stream: what `welcome` will post, without moving it on.
  arrival: arrivalOf(s, { rng: s.rng, made: s.made }, now),
});

// ---------- off the wire ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, least: number, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most;
const ID = /^[a-z0-9-]{1,40}$/;

/** A place in the member's news off the wire: a whole number, or none. */
const cursorOf = (v: unknown): number | null | undefined =>
  v === undefined || v === null ? null : whole(v, 0, 1e15) ? v : undefined;
/** A square and a turn off the wire. */
const atOf = (v: Record<string, unknown>): At | null =>
  whole(v.x, 0, CGW) && whole(v.y, 0, CGH) && whole(v.t, 0, 3) ? { x: v.x, y: v.y, t: v.t } : null;

/** A command off the wire, every field checked, or null. Fields it does not use (the command's own id) are let be. */
export function readCommand(v: unknown): TownCommand | null {
  if (!isRecord(v)) return null;
  const spot = atOf(v);
  switch (v.do) {
    case "welcome":
    case "here": {
      const cursor = cursorOf(v.cursor);
      return cursor === undefined ? null : { do: v.do, cursor };
    }
    case "openChest":
    case "spotCrab":
    case "readMail":
    case "clearLetters":
      return { do: v.do };
    case "buy":
      return typeof v.stall === "string" && isThing(v.thing) ? { do: "buy", stall: v.stall, thing: v.thing } : null;
    case "choosePet":
      return isPet(v.pet) ? { do: "choosePet", pet: v.pet } : null;
    case "greet":
      return whole(v.visit, 0, 1e9) ? { do: "greet", visit: v.visit } : null;
    case "takePresent":
      return spot && typeof v.letter === "string" && ID.test(v.letter)
        ? { do: "takePresent", letter: v.letter, ...spot }
        : null;
    case "unpack":
      return spot && { do: "unpack", ...spot };
    case "setOut":
      return spot && isThing(v.thing) ? { do: "setOut", thing: v.thing, ...spot } : null;
    case "move":
      return spot && whole(v.n, 0, 1e9) ? { do: "move", n: v.n, ...spot } : null;
    case "putAway":
    case "toggle":
      return whole(v.n, 0, 1e9) ? { do: v.do, n: v.n } : null;
    case "stay":
      return typeof v.on === "boolean" ? { do: "stay", on: v.on } : null;
    default:
      return null;
  }
}

// ---------- keeping it ----------

const GAME = "town";
export const TOWN_VERSION = 1;

export const encodeTown = (s: Town): string =>
  JSON.stringify({
    game: GAME,
    v: TOWN_VERSION,
    sightings: s.sightings,
    spotAt: s.spotAt,
    chestDay: s.chestDay,
    welcomedDay: s.welcomedDay,
    seenAt: s.seenAt,
    cursor: s.cursor,
    stay: s.stay,
    camp: s.camp,
    visit: s.visit,
    nextCall: s.nextCall,
    rng: s.rng,
    made: s.made,
  });

const TIME = 8.64e15;

function placedOf(v: unknown): Placed | null {
  if (!isRecord(v) || !whole(v.n, 0, 1e9) || !isThing(v.id)) return null;
  const { n, id, x, y, t, s } = v;
  return whole(x, 0, CGW) && whole(y, 0, CGH) && whole(t, 0, 3) && whole(s, 0, 7) ? { n, id, x, y, t, s } : null;
}

/** A list read whole, or null if any of it does not read. */
function all<T>(v: unknown, one: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const read = one(x);
    if (read === null) return null;
    out.push(read);
  }
  return out;
}

/** A camp as Leaf stored it. It is trusted to stand as it was kept: the rules checked every change to it. */
function storedCamp(v: unknown): Camp | null {
  if (!isRecord(v) || !isRecord(v.tray) || !(v.first === "" || isPet(v.first)) || !whole(v.greeted, 0, 999))
    return null;
  const placed = all(v.placed, placedOf);
  const parcels = all(v.parcels, (p) => (isThing(p) ? p : null));
  const letters = all(v.letters, (l) => (isLetter(l) ? l : null));
  const earned = all(v.earned, (p) => (isThing(p) ? p : null));
  const tray: Record<string, number> = {};
  for (const [id, n] of Object.entries(v.tray)) {
    if (!isThing(id) || !whole(n, 1, MOST_OWNED)) return null;
    tray[id] = n;
  }
  if (!placed || !parcels || !letters || !earned) return null;
  return { first: v.first, placed, tray, parcels, letters, greeted: v.greeted, earned };
}

function visitOf(v: unknown): Visit | null {
  if (!isRecord(v) || !whole(v.id, 0, 1e9) || typeof v.who !== "string" || typeof v.note !== "string") return null;
  const who = CALLERS.find((c) => c === v.who);
  return who && (v.gift === "" || isThing(v.gift)) ? { id: v.id, who, note: v.note, gift: v.gift } : null;
}

/** A town from the text Leaf stored, or null for anything this version could not have made. */
export function decodeTown(text: string): Town | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.game !== GAME || raw.v !== TOWN_VERSION) return null;
  const { sightings, spotAt, chestDay, welcomedDay, seenAt, stay, nextCall, rng, made } = raw;
  const cursor = cursorOf(raw.cursor);
  const camp = storedCamp(raw.camp);
  const visit = raw.visit === null ? null : visitOf(raw.visit);
  if (
    !whole(sightings, 0, 1e6) ||
    !whole(spotAt, 0, TIME) ||
    !whole(chestDay, -1, 1e9) ||
    !whole(welcomedDay, -1, 1e9) ||
    !whole(seenAt, 0, TIME) ||
    typeof stay !== "boolean" ||
    !whole(nextCall, 0, TIME) ||
    !whole(rng, 0, 0xffffffff) ||
    !whole(made, 0, 1e9) ||
    cursor === undefined ||
    !camp ||
    (raw.visit !== null && !visit)
  )
    return null;
  return { sightings, spotAt, chestDay, welcomedDay, seenAt, cursor, stay, camp, visit, nextCall, rng, made };
}

/** A new member's town: the camp every member starts with, nothing welcomed, and the first caller on the way. */
export function newTown(ctx: Pick<Ctx, "seed" | "now">): Town {
  const s: Town = {
    sightings: 0,
    spotAt: 0,
    chestDay: -1,
    welcomedDay: -1,
    seenAt: 0,
    cursor: null,
    stay: true,
    camp: newCamp(),
    visit: null,
    nextCall: 0,
    rng: mix(ctx.seed >>> 0, 0x70a1),
    made: 0,
  };
  s.made = s.camp.placed.length;
  s.nextCall = ctx.now + CALLS.least + Math.floor(chance(s) * CALLS.more);
  return s;
}

/**
 * A town from the record the browser kept (`town.save.v1`), for bringing a member's camp over once:
 * the camp read with every check the page makes, each thing standing given an id of its own; the
 * crab's sightings, the news told and whether their character stays; and when they were last here,
 * by the browser's clock (never after `ctx.now`). The rest is a new member's. Null for nonsense.
 */
export function adopt(text: string, ctx: Pick<Ctx, "seed" | "now">): Town | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1) return null;
  const s = newTown(ctx);
  s.camp = readCamp(raw.camp) ?? newCamp();
  s.made = s.camp.placed.length;
  if (whole(raw.sightings, 0, Infinity)) s.sightings = Math.min(1e6, raw.sightings);
  if (whole(raw.lastSeen, 1, Infinity)) s.seenAt = Math.min(ctx.now, raw.lastSeen);
  s.cursor = whole(raw.cursor, 0, 1e15) ? raw.cursor : null;
  s.stay = raw.stay !== false;
  return s;
}

/** The town and the camp, for Leaf's play service. */
export const TOWN: Game<Town, TownCommand, TownView, TownNote> = {
  id: "town",
  create: newTown,
  advance,
  apply,
  view: (s, ctx) => townView(s, ctx.now),
  decode: decodeTown,
  encode: encodeTown,
  command: readCommand,
};
