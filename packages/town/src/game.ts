/**
 * The town and the camp as Leaf plays them: what the member keeps (the camp, its mail, a few
 * counters) and what Leaf decides for them (who calls, the mail while they were away, the day), one
 * command for each thing a member does, and what their page is shown. The town is not a simulation:
 * `advance` only sends the next caller when one is due, and hands over what was won elsewhere.
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
  readPostcards,
  type Refused,
  type Standing,
  utcDay,
} from "@sequoia-leaf/core";

import {
  type Camp,
  campFull,
  canPlace,
  CGH,
  CGW,
  isPet,
  lookedThrough,
  MOST_NEW,
  MOST_OWNED,
  newCamp,
  type PetId,
  type Placed,
  store,
  type Verdict,
} from "./camp.ts";
import { STALLS } from "./catalogue.ts";
import {
  type AwayCall,
  type Caller,
  CALLERS,
  capital,
  FIRST_CALL,
  folk,
  GIFTS,
  NOTES,
  nowNamed,
  WHILE_AWAY,
} from "./folk.ts";
import { isLetter, type Letter, letter, post, tidied } from "./mail.ts";
import { stretchOf } from "./stretch.ts";
import { figureThing, isThing, thingOf, turnsOf } from "./things.ts";

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
  /** Leaf's stream, and the counter every id and key a command makes is made from. */
  rng: number;
  made: number;
  /**
   * How many callers have set out: a caller's id. It is a counter of its own because a caller sets
   * out by Leaf's clock, between a page's commands: if it took from `made`, the id the page gave a
   * thing it set out would not be the one Leaf gives it.
   */
  called: number;
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

/**
 * What the member's page is given: the state without its stream or when the next caller comes, the
 * arrival letter, and what each of their games tells the town, as Leaf keeps it with the game's
 * state (`doors`: `Ctx.postcards`), for the doors and the letter. The counter is shown, so that the
 * page gives a thing it sets down the id Leaf will give it.
 */
export type TownView = Omit<Town, "rng" | "nextCall" | "called"> & { arrival: Arrival; doors: Ctx["postcards"] };

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
  | { do: "takePresent"; letter: string }
  | { do: "clearLetters" }
  /** The member has looked in the tray, at every arrival up to the `through`th (`camp.looked` and what was new, as their page had them). */
  | { do: "looked"; through: number }
  | ({ do: "setOut"; thing: string } & At)
  /** Moving and turning: the page works out where, the rules check it. */
  | ({ do: "move"; n: number } & At)
  | { do: "putAway"; n: number }
  /** A lantern lit or dark, a colour, a gnome turned. */
  | { do: "toggle"; n: number }
  | { do: "stay"; on: boolean };

/** What a command did besides change the town: the number Leaf gave a thing set out, which whatever is done to it next names. */
export type TownNote = { readonly t: "setOut"; readonly n: number };

/** Why a command may not be done, besides where a thing may not stand (`Verdict`). */
export type Why =
  | Exclude<Verdict, "ok">
  | "opened_today"
  | "too_soon"
  | "not_for_sale"
  | "plenty"
  | "pet_chosen"
  | "no_such_visit"
  | "no_present"
  | "not_in_tray"
  | "cannot_turn"
  | "no_such_thing"
  | "rooted"
  | "nothing_to_toggle";

/** How often a caller sets out: 46 to 76 seconds after the last. */
export const CALLS = { least: 46_000, more: 30_000 } as const;
const HOUR = 3_600_000;
/** How many colours a paper lantern, a pane of glass or a pennant comes in. */
export const COLOURS = 5;
/** What a touch changes, and keeps, for the things that keep a state: lit or dark (lit at 0), a colour, which way round. */
export const TOGGLES: Readonly<Record<string, "lit" | "colour" | "turn">> = {
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
  s.visit = { id: s.called++, who, note: r < 0.7 ? pick(s, NOTES[who]) : "", gift: r < 0.4 ? pick(s, GIFTS) : "" };
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
 * The camp thing an award brings: a trophy is named as its thing, a pull's `figure:` prize is that
 * figure's thing, a banner's headliner is that banner's statue, and a `thing:` prize of earlier
 * pulls is that thing.
 */
const thingWon = (award: string): string =>
  award
    .replace(/^pull:figure:/, figureThing(""))
    .replace(/^pull:headliner:/, "statue-")
    .replace(/^pull:thing:/, "");

/**
 * The state at `ctx.now`: the things the member has won elsewhere (trophies, a pull's prizes) that
 * the camp has not had go into the tray, each once; and when a caller is due, the one waiting
 * leaves and the next sets out. At most one caller each call: time nobody was here for is not made up.
 */
function advance(state: Town, ctx: Ctx): Town {
  const won = ctx.awards.map(thingWon).filter((id) => isThing(id) && !state.camp.earned.includes(id));
  const due = ctx.now >= state.nextCall;
  if (!due && won.length === 0) return state;
  const s = structuredClone(state);
  for (const id of won) {
    s.camp.earned.push(id);
    // One more of a thing the member has as many of as may be had is won, and simply not kept.
    store(s.camp, id);
  }
  if (due) call(s, ctx.now);
  return s;
}

// ---------- doing things ----------

type Answer = Done<Town, TownNote> | Refused;
const no = (why: Why): Refused => ({ refused: why });
const done = (s: Town, more: { coins?: CoinChange[]; log?: Logged[]; notes?: TownNote[] } = {}): Answer => ({
  state: s,
  notes: [],
  ...more,
});

/** Whether a thing may stand at a square, turned so; `skip` is the thing being moved, by its place in the list. */
function standing(placed: readonly Placed[], id: string, at: At, skip = -1): Verdict | "cannot_turn" {
  const thing = thingOf(id);
  if (!thing || at.t >= turnsOf(thing)) return "cannot_turn";
  return canPlace(placed, id, at.x, at.y, at.t, skip);
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
      return done(s, {
        coins: [{ amount: DAILY_CHEST, reason: "The chest by the Treasury", key: `chest:${day}`, free: true }],
      });
    }
    case "spotCrab":
      // Once for each place it hides: the stretch is the clock's, the same as the page works out.
      if (stretchOf(now) === stretchOf(s.spotAt)) return no("too_soon");
      s.sightings = Math.min(1e6, s.sightings + 1);
      s.spotAt = now;
      return done(s, { log: [{ kind: LOGGED.townCrab, data: {} }] });
    case "buy": {
      const sold = STALLS.find((st) => st.id === c.stall)?.stock.find((k) => k.thing === c.thing);
      if (!sold) return no("not_for_sale");
      if (!store(camp, sold.thing)) return no("plenty");
      return done(s, {
        coins: [{ amount: -sold.price, reason: "A thing for the camp", key: `buy:${next(s)}` }],
        log: [{ kind: LOGGED.townBought, data: { thing: sold.thing, price: sold.price } }],
      });
    }
    case "choosePet":
      if (camp.first !== "") return no("pet_chosen");
      camp.first = c.pet;
      return done(s, { log: [{ kind: LOGGED.townPet, data: { pet: c.pet } }] });
    case "greet":
      if (s.visit?.id !== c.visit) return no("no_such_visit");
      camp.greeted = Math.min(999, camp.greeted + 1);
      const by = s.visit.who;
      leave(s, s.visit);
      return done(s, { log: [{ kind: LOGGED.townGreeted, data: { by } }] });
    case "readMail":
      for (const l of camp.letters) l.read = true;
      return done(s);
    case "takePresent": {
      const l = camp.letters.find((m) => m.id === c.letter);
      if (!l || l.gift === "" || l.taken) return no("no_present");
      if (!store(camp, l.gift)) return no("plenty");
      l.taken = true;
      return done(s);
    }
    case "clearLetters":
      camp.letters = tidied(camp.letters);
      return done(s);
    case "looked":
      lookedThrough(camp, c.through);
      return done(s);
    case "setOut": {
      if ((camp.tray[c.thing] ?? 0) < 1) return no("not_in_tray");
      if (campFull(camp.placed)) return no("full");
      const v = standing(camp.placed, c.thing, c);
      if (v !== "ok") return no(v);
      const left = (camp.tray[c.thing] ?? 0) - 1;
      if (left > 0) camp.tray[c.thing] = left;
      else delete camp.tray[c.thing];
      const n = next(s);
      camp.placed.push({ n, id: c.thing, x: c.x, y: c.y, t: c.t, s: 0 });
      return done(s, { notes: [{ t: "setOut", n }] });
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

/** The state as the member's page is given it, but the arrival letter. Each field is named, so nothing new is shown by accident. */
const shown = (s: Omit<Town, "rng" | "nextCall" | "called">): Omit<TownView, "arrival" | "doors"> => ({
  sightings: s.sightings,
  spotAt: s.spotAt,
  chestDay: s.chestDay,
  welcomedDay: s.welcomedDay,
  seenAt: s.seenAt,
  cursor: s.cursor,
  stay: s.stay,
  camp: s.camp,
  visit: s.visit,
  made: s.made,
});

export const townView = (s: Town, now: number, doors: Ctx["postcards"] = {}): TownView => ({
  ...shown(s),
  // Drawn from a copy of the stream: what `welcome` will post, without moving it on.
  arrival: arrivalOf(s, { rng: s.rng, made: s.made }, now),
  doors,
});

/**
 * What a visitor is given of somebody's camp: what stands there, each thing in its own state, and
 * the pet they chose; nothing else of theirs (no letters, tray or caller, every counter at
 * 0, an arrival letter that says nothing, none of their games' postcards), in the shape the page
 * draws a camp from.
 */
export const visitView = (s: Town): TownView => ({
  sightings: 0,
  spotAt: 0,
  chestDay: -1,
  welcomedDay: -1,
  seenAt: 0,
  cursor: null,
  stay: false,
  camp: {
    first: s.camp.first,
    placed: s.camp.placed.map((p) => ({ ...p })),
    tray: {},
    fresh: [],
    looked: 0,
    letters: [],
    greeted: 0,
    earned: [],
  },
  visit: null,
  made: 0,
  arrival: { first: false, newDay: false, away: 0, said: [], mail: [] },
  doors: {},
});

/** What a guess on the page's copy is told besides the moment: nothing of Leaf's (`predict`). */
const ON_THE_PAGE: Omit<Ctx, "now"> = { player: { id: "", guest: false }, seed: 0, room: 0, awards: [], postcards: {} };

/** Commands only Leaf can answer: what they post or cost is Leaf's to say. The page waits for these. */
export const ASKED: ReadonlySet<TownCommand["do"]> = new Set(["welcome", "greet", "openChest", "buy"]);

/**
 * A command done to the page's copy with the same rules Leaf uses, at the page's reckoning of Leaf's
 * clock: the copy after it and its notes, or the refusal. Null for a command only Leaf can answer.
 */
export function predict(
  view: TownView,
  c: TownCommand,
  now: number,
): { view: TownView; notes: TownNote[] } | Refused | null {
  if (ASKED.has(c.do)) return null;
  const { arrival, doors, ...rest } = view;
  // Nothing done here draws from the stream, or reads when the next caller comes.
  const answer = apply({ ...rest, rng: 0, nextCall: 0, called: 0 }, c, { ...ON_THE_PAGE, now });
  if ("refused" in answer) return answer;
  return { view: { ...shown(answer.state), arrival, doors }, notes: [...answer.notes] };
}

/** Where a camp stands among everyone's: the things set out, with how many callers were greeted and how often the crab was spotted. */
const standingOf = (s: Town): Standing => ({
  score: s.camp.placed.length,
  also: { greeted: s.camp.greeted, sightings: s.sightings },
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
    case "looked":
      return whole(v.through, 0, 1e9) ? { do: "looked", through: v.through } : null;
    case "buy":
      return typeof v.stall === "string" && isThing(v.thing) ? { do: "buy", stall: v.stall, thing: v.thing } : null;
    case "choosePet":
      return isPet(v.pet) ? { do: "choosePet", pet: v.pet } : null;
    case "greet":
      return whole(v.visit, 0, 1e9) ? { do: "greet", visit: v.visit } : null;
    case "takePresent":
      return typeof v.letter === "string" && ID.test(v.letter) ? { do: "takePresent", letter: v.letter } : null;
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
    called: s.called,
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

/** How many of each thing, as stored; null if any of it does not read. */
function counts(v: unknown): Record<string, number> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(v)) {
    if (!isThing(id) || !whole(n, 1, MOST_OWNED)) return null;
    out[id] = n;
  }
  return out;
}

/**
 * A camp as Leaf stored it. It is trusted to stand as it was kept: the rules checked every change
 * to it. One kept from before everything went into the tray has no `fresh`, and may have parcels
 * waiting by its trail (`parcels`): they are in the tray now, and new.
 */
function storedCamp(v: unknown): Camp | null {
  if (!isRecord(v) || !(v.first === "" || isPet(v.first)) || !whole(v.greeted, 0, 999)) return null;
  const placed = all(v.placed, placedOf);
  const parcels = all(v.parcels ?? [], (p) => (isThing(p) ? p : null));
  const letters = all(v.letters, (l) => (isLetter(l) ? { ...l, from: nowNamed(l.from) } : null));
  const earned = all(v.earned, (p) => (isThing(p) ? p : null));
  const tray = counts(v.tray);
  const fresh = all(v.fresh ?? [], (p) => (isThing(p) ? p : null));
  const looked = v.looked ?? 0;
  if (!placed || !parcels || !letters || !earned || !tray || !fresh || !whole(looked, 0, 1e9)) return null;
  if (fresh.length > MOST_NEW) return null;
  const camp: Camp = { first: v.first, placed, tray, fresh, looked, letters, greeted: v.greeted, earned };
  for (const id of parcels) store(camp, id);
  return camp;
}

function visitOf(v: unknown): Visit | null {
  if (!isRecord(v) || !whole(v.id, 0, 1e9) || typeof v.who !== "string" || typeof v.note !== "string") return null;
  const who = CALLERS.find((c) => c === v.who);
  return who && (v.gift === "" || isThing(v.gift)) ? { id: v.id, who, note: v.note, gift: v.gift } : null;
}

/** What the stored state and the page's view both hold, every field's type checked; null if any does not read. */
function heldIn(raw: Record<string, unknown>): Omit<TownView, "arrival" | "doors"> | null {
  const { sightings, spotAt, chestDay, welcomedDay, seenAt, stay, made } = raw;
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
    !whole(made, 0, 1e9) ||
    cursor === undefined ||
    !camp ||
    (raw.visit !== null && !visit)
  )
    return null;
  return { sightings, spotAt, chestDay, welcomedDay, seenAt, cursor, stay, camp, visit, made };
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
  const held = heldIn(raw);
  const { nextCall, rng, called } = raw;
  if (!held || !whole(nextCall, 0, TIME) || !whole(rng, 0, 0xffffffff) || !whole(called, 0, 1e9)) return null;
  return { ...held, nextCall, rng, called };
}

const lines = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= 8 && v.every((l) => typeof l === "string" && l.length <= 240) ? v : null;

/** The page's view off the wire, or null for anything these rules could not have made. */
export function readView(v: unknown): TownView | null {
  if (!isRecord(v) || !isRecord(v.arrival)) return null;
  const held = heldIn(v);
  const { first, newDay, away } = v.arrival;
  const said = lines(v.arrival.said);
  const mail = all(v.arrival.mail, (l) => (isLetter(l) ? l : null));
  if (!held || typeof first !== "boolean" || typeof newDay !== "boolean" || !whole(away, 0, TIME) || !said || !mail)
    return null;
  // A Leaf from before the doors sends none: the town says its own lines.
  return { ...held, arrival: { first, newDay, away, said, mail }, doors: readPostcards(v.doors) };
}

/** What a command answered off the wire: nothing, or the number of a thing set out; null for anything else. */
export function readNotes(v: unknown): TownNote[] | null {
  if (!Array.isArray(v)) return null;
  const notes: TownNote[] = [];
  for (const note of v) {
    if (!isRecord(note) || note.t !== "setOut" || !whole(note.n, 0, 1e9)) return null;
    notes.push({ t: "setOut", n: note.n });
  }
  return notes;
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
    called: 0,
  };
  s.made = s.camp.placed.length;
  s.nextCall = ctx.now + CALLS.least + Math.floor(chance(s) * CALLS.more);
  return s;
}

/** The town and the camp, for Leaf's play service. */
export const TOWN: Game<Town, TownCommand, TownView, TownNote> = {
  id: "town",
  create: newTown,
  advance,
  apply,
  // The doors to the Works and the table say what Leaf keeps of each (`Ctx.postcards`).
  view: (s, ctx) => townView(s, ctx.now, ctx.postcards),
  visit: visitView,
  decode: decodeTown,
  encode: encodeTown,
  command: readCommand,
  // The page says the member is here every five minutes, and as it goes.
  chore: (c) => c.do === "here",
  standing: standingOf,
};
