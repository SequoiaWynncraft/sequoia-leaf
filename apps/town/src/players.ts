/**
 * Other players in town, live (on the guild's own server; with the made-up guild nobody is here).
 * While the town's scene is on the stage, the page is in Leaf's room `town` (`joinLive`): it tells
 * the room where the member's figure is, as it moves, and draws everybody else in the room exactly
 * where the room says they are, each in their own skin. They are never solid. The room is made once:
 * going to a camp or the Grove steps out of it on the same connection (`away`), and coming back
 * steps in again. Only a game closes it, being a page of its own with a connection of its own (a
 * player is live on one connection at a time), and coming out of it opens one again.
 *
 * Here too: telling the room of the member's touches on things in town (`town.ts`'s
 * `touchThing`) and playing everybody else's, the member's emotes (the plaque over their own
 * figure, and what everybody sees of them), the wave on a live player's card, the small
 * "Reconnecting…" once the connection has been down a couple of seconds, and the kit's cards for
 * a connection Leaf has let go of. The rules are in `motion.ts`.
 *
 * Somebody away (Leaf's rule, as everything else has it: `where.ts`) has sat down where they are and
 * nodded off: facing us unless they sat on a seat, eyes closed, a "z" now and then, the same moments
 * on every page; the moment they move or do anything, they are up and about again.
 */

import { away } from "@sequoia-leaf/core";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { type Emote, EMOTES } from "@sequoia-leaf/kit/emotes.ts";
import { type LetGo, letGoCard, member, where } from "@sequoia-leaf/kit/live.ts";
import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import {
  joinLive,
  leafClock,
  type LiveEars,
  type LiveMember,
  type LiveRoom,
  type Step,
} from "@sequoia-leaf/kit/realtime.ts";
import { bake, type Body, lookFor, paintSkin, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Pt } from "@sequoia-leaf/kit/util.ts";
import { zAt } from "@sequoia-leaf/town/clock.ts";

import { face, feet, footfall, headOf, hop, makeActor, onScreen, putAs, stepActor } from "./actors.ts";
import { emoteOver, float } from "./fx.ts";
import { type Actor, G, hooks, ROOM, SEED, toPage } from "./game.ts";
import { guild } from "./guild.ts";
import { GUEST, rankName } from "./live.ts";
import { Company, type Fellow, linkShown, NAMED_FOR, othersIn, stepOf } from "./motion.ts";
import { touchThing } from "./town.ts";
import { dozy, followLive } from "./visitors.ts";
import type { Seat } from "./world.ts";

/** After this many milliseconds with the connection down, the others fade away and the town plays on alone. */
const ALONE_AFTER = 5000;

/** What each emote is called, for whoever cannot see its picture. */
export const EMOTE_NAMES: Readonly<Record<Emote, string>> = {
  wave: "Wave",
  cheer: "Cheer",
  laugh: "Laugh",
  heart: "Heart",
};

/**
 * How somebody else in the room is drawn: their actor, a seat of their own for when they sit,
 * wherever they are, their figure with eyes open (a look of their own until their skin arrives) and
 * shut, and the "z" they last breathed while nodded off.
 */
interface Drawn {
  a: Actor;
  seat: Seat;
  open: Body;
  shut: Body | null;
  z: number;
}

/** Everybody else in the room, by their account, each drawn with an actor of their own. */
const company = new Company<Drawn>(drawnOf, {
  emote: (f, kind) => {
    express(f.own.a, kind);
  },
  touch: (name) => {
    touchThing(name, false);
  },
  status: (s) => {
    if (s === "replaced" || s === "signedout") letGoOf(s);
    showLink();
  },
});
/**
 * The town's room: where the page stands with it is its own state (`room.state()`), down, away or let
 * go of included. Let go of by Leaf, it is kept, shown as let go, until the member says to play here.
 */
let room: LiveRoom | null = null;
/** Where the stage has the town: on it (in the room), off it for a camp or the Grove (away), or under a game (no room). */
let stage: TownStage = "shut";
/** Where the member's feet were the last time the room was told, and what it was told, when. */
let was: Pt | null = null;
let told: { step: Step; at: number } | null = null;

/** Where the stage has the town: on it, off it for a camp or the Grove, or under a game. */
export type TownStage = "on" | "away" | "shut";

/** Whether the game is live here, as somebody: only then is there a room. */
const isLive = (): boolean => where().mode === "live" && member() !== null;

const rankOf = (m: LiveMember): string => (m.guest ? GUEST : m.rank === null ? "" : rankName(m.rank));

// ---------- the room ----------

/** Everybody's rank as the room last showed it, by their account, for those other lists do not say it of. */
export const knownRanks = new Map<string, string>();
/**
 * When this page last saw each of the others do something in the room, by Leaf's clock and their
 * account: a move somewhere, an emote, a touch, which is what Leaf counts as doing something too.
 */
export const stirred = new Map<string, number>();
const learn = (m: LiveMember): void => {
  const rank = rankOf(m);
  if (rank === "") knownRanks.delete(m.player);
  else knownRanks.set(m.player, rank);
};

/** What the page hears from the room: the company's, and the welcome ends any drop. */
const ears: LiveEars = {
  ...company.ears,
  welcome(you, name, roster, restarted) {
    company.ears.welcome?.(you, name, roster, restarted);
    for (const m of roster) learn(m);
    showLink();
  },
  joined(m) {
    company.ears.joined?.(m);
    learn(m);
  },
  act(id, kind, arg) {
    const f = company.byId(id);
    if (f) stirred.set(f.who.player, leafNow());
    company.ears.act?.(id, kind, arg);
  },
};

/**
 * Whether the connection has been down long enough that the room's last roster is no longer who is
 * here: the same moment everybody's figure goes (`ALONE_AFTER`). The room keeps its old roster
 * until its next welcome, so nothing may read it as current after this.
 */
function alone(): boolean {
  const s = room?.state();
  return s?.at === "down" && s.ms > ALONE_AFTER;
}

/**
 * Everybody in the room with the member, the member too, with their rank as the town shows it, and
 * those awaited back after Leaf restarted, who stand where they were; null while the page is in no
 * room.
 */
export function roomNow(): { id: string; name: string; rank: string | null }[] | null {
  if (!room || room.you() === null || alone()) return null;
  return [...room.members().values(), ...company.awaited().map((f) => f.who)].map((m) => {
    const rank = rankOf(m);
    return { id: m.player, name: m.name, rank: rank === "" ? null : rank };
  });
}

const seatAt = (x: number, y: number, dir: Actor["dir"]): Seat => ({
  x,
  y,
  dir,
  from: { x, y },
  at: "fire",
  taken: false,
});

/** Somebody's figure: a look of their own at first, and their own skin once it has arrived. */
function drawnOf(m: LiveMember): Drawn {
  const open = bake(paintSkin(lookFor(m.name)));
  const a = makeActor({ name: m.name, rank: rankOf(m), level: 0, voice: 0 }, open, 0, 0);
  a.id = m.player;
  a.alpha = 0;
  a.doing = "walk";
  const d: Drawn = { a, seat: seatAt(0, 0, 0), open, shut: null, z: 0 };
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      d.open = bake(img);
      d.shut = null;
    } catch {
      // A picture that cannot be read: the look of their own stays.
    }
  });
  img.src = skinOf(m.player);
  return d;
}

/** The connection is let go of for good: everybody fades away, and the kit's card says why; playing here starts a room afresh. */
function letGoOf(why: LetGo): void {
  company.goAll();
  closeEmotes();
  const w = where();
  letGoCard(why, w.mode === "live" ? w.signIn : "", () => {
    room = null;
    showLink();
    if (stage === "on") enterRoom();
  });
}

/** Into the room: on the connection there is, or on a new one if there is none. The member's place is said again, which the room shows as a jump. */
function enterRoom(): void {
  if (!isLive()) return;
  was = null;
  if (room) room.away(false);
  else room = joinLive(ROOM, ears);
}

/**
 * Where the stage has the town now: on it, the page is in the room (unless Leaf let it go); off it
 * for a camp or the Grove, it steps out of the room and keeps the connection; under a game, it
 * closes the room. Off the stage, nobody else is drawn.
 */
export function townOnStage(at: TownStage): void {
  stage = at;
  if (at === "on") {
    enterRoom();
    return;
  }
  if (at === "away") room?.away(true);
  else {
    room?.close();
    room = null;
  }
  for (const f of company.clear()) f.own.a.away = true;
  closeEmotes();
  showLink();
}

/** Whether the page is in the room just now, or coming back to it (live, on the stage, and not let go of). */
export function inRoom(): boolean {
  const s = room?.state();
  return s !== undefined && s.at !== "away" && s.at !== "gone";
}

/** Leaf's clock now, as far as this page can tell: out of a room, as it last heard. */
export const leafNow = (): number => room?.serverNow() ?? leafClock(Date.now());

// ---------- each moment ----------

/** Tells the room where the member's figure is this moment, `jumped` when it was put there without walking. */
export function tellRoom(a: Actor, dt: number, jumped: boolean): void {
  if (!room) return;
  const step = stepOf(a, jumped ? null : was, dt);
  room.move(step, jumped);
  was = { x: a.x, y: a.y };
  told = { step, at: Date.now() };
}

/** Draws everybody else where the room says they are now, and lets those who have gone fade away. */
export function stepPlayers(dt: number): void {
  // Down a while: the others go, and the town plays on alone until the room welcomes the page again.
  if (alone()) company.goAll();
  if (room?.state().at === "down") showLink();
  const walked = new Map(company.all().map((f) => [f, f.own.a.walked]));
  const stood = new Map(company.all().map((f) => [f, { x: f.fig.x, y: f.fig.y, jump: f.fig.jump }]));
  const { came, went } = company.step((id) => room?.sample(id) ?? null, dt);
  const now = leafNow();
  for (const f of company.all()) {
    // A move somewhere, as the room tells it, is doing something: by Leaf's rule too.
    const before = stood.get(f);
    if (before && before.jump === f.fig.jump && (before.x !== f.fig.x || before.y !== f.fig.y))
      stirred.set(f.who.player, now);
  }
  const all = guild.whereabouts();
  for (const f of company.all()) {
    const a = f.own.a;
    // Hops and words; a figure drawn from the room walks nowhere of its own accord.
    stepActor(a, dt);
    const w = all.get(f.who.player);
    dress(f, w?.state === "live" && away(w.acted, now));
    if (a.moving) footfall(a, walked.get(f) ?? a.walked);
  }
  for (const f of came) f.own.a.named = G.t + NAMED_FOR;
  for (const f of went) f.own.a.away = true;
  if (plaque && G.player?.moving) closeEmotes();
  placeEmotes();
}

/** Puts somebody's actor where their figure is: on their feet, or seated where they are; `idle`, nodded off there. */
function dress(f: Fellow<Drawn>, idle: boolean): void {
  const { fig, own } = f;
  const a = own.a;
  a.who =
    a.who.name === f.who.name && a.who.rank === rankOf(f.who)
      ? a.who
      : { ...a.who, name: f.who.name, rank: rankOf(f.who) };
  a.away = false;
  a.x = fig.x;
  a.y = fig.y;
  a.dir = fig.dir;
  a.walked = fig.walked;
  a.alpha = fig.alpha;
  a.moving = fig.moving;
  if (fig.seated || idle) {
    // Nodded off on their feet, they sit down where they are, facing us.
    const dir = fig.seated ? fig.dir : 0;
    Object.assign(own.seat, { x: fig.x, y: fig.y, dir, from: { x: fig.x, y: fig.y } });
    putAs(a, own.seat);
    a.dir = dir;
    // Already sitting: not drawn on the way into the seat.
    a.sat = -9;
  } else putAs(a, null);
  a.body = idle ? (own.shut ??= dozy(own.open)) : own.open;
  if (!idle) return;
  // A "z" now and then, at the same moments on every page.
  const z = zAt(SEED, a.id, G.now);
  if (z === own.z) return;
  own.z = z;
  if (a.alpha > 0.5 && onScreen(fig.x, fig.y)) float(fig.x + 4, fig.y - 20, "z", CREAM, 1.4);
}

/** Everybody else in town, live, as they are to be drawn. */
export const livePlayers = (): Actor[] => company.all().map((f) => f.own.a);

/** Whether somebody in town is another player, live. */
export const isLivePlayer = (a: Actor): boolean => company.all().some((f) => f.own.a === a);

/** How many others are in the room, once it has said; null before it has welcomed the page. */
export function othersInTown(): number | null {
  const you = room?.you() ?? null;
  return room && you !== null && !alone() ? othersIn(room.members(), you) : null;
}

// Real members drawn live, fading away too, are not visitors or dozers as well.
followLive({
  ids: () => new Set(company.all().map((f) => f.who.player)),
  actor: (id) => company.all().find((f) => f.who.player === id && !f.fig.gone)?.own.a ?? null,
});

// ---------- emotes ----------

/** Somebody makes an emote: they hop once, with its picture floating up from their head. */
function express(a: Actor, kind: Emote): void {
  hop(a);
  emoteOver(a, kind);
  if (!a.you && !onScreen(a.x, a.y)) return;
  if (kind === "cheer") sfx.cheer();
  else if (kind === "laugh") sfx.boing();
  else if (kind === "heart") sfx.twinkle();
  else sfx.pop();
}

hooks.tell = (name) => room?.act("touch", name);

/** The member makes an emote, and everybody in the room sees them make it. */
export function emote(kind: Emote): void {
  const p = G.player;
  if (!p) return;
  express(p, kind);
  room?.act("emote", kind);
}

/** The member waves to another player from their card: they turn to face them, and wave. */
export function waveAt(a: Actor): void {
  const p = G.player;
  if (p && !p.seat) face(p, a.x, a.y);
  emote("wave");
}

let plaque: HTMLElement | null = null;

/** The small plaque of emotes over the member's own figure, for choosing one. */
export function openEmotes(): void {
  closeEmotes();
  const buttons = EMOTES.map((kind) => {
    const b = el("button", "k-btn wood icon", { type: "button", "aria-label": EMOTE_NAMES[kind] }, icon(kind));
    b.addEventListener("click", () => {
      closeEmotes();
      emote(kind);
    });
    return b;
  });
  plaque = el("div", "k-plaque", { id: "emotes", role: "group", "aria-label": "Emotes" }, ...buttons);
  document.body.append(plaque);
  placeEmotes();
  buttons[0]?.focus({ preventScroll: true });
}

export function closeEmotes(): void {
  plaque?.remove();
  plaque = null;
}

/** Whether the plaque of emotes is open. */
export const emotesOpen = (): boolean => plaque !== null;

/** Keeps the plaque over the member's head as the view moves, inside the page. */
function placeEmotes(): void {
  const p = G.player;
  if (!plaque || !p) return;
  const at = feet(p);
  const top = toPage(at.x, at.y - headOf(p) - 3);
  const half = plaque.offsetWidth / 2 + 4;
  plaque.style.left = `${Math.round(clamp(top.x, half, Math.max(half, window.innerWidth - half)))}px`;
  plaque.style.top = `${Math.round(Math.max(plaque.offsetHeight + 4, top.y))}px`;
}

// ---------- the connection, shown ----------

let link: HTMLElement | null = null;

/** What the town shows of its room just now: nothing while the town is off the stage. */
const shownNow = (): ReturnType<typeof linkShown> => (stage === "on" ? linkShown(room?.state() ?? null) : "none");

/**
 * The small "Reconnecting…" under the purse, once the connection has been down a couple of seconds and
 * the page is not let go of. Looked at again each frame while it is down.
 */
function showLink(): void {
  const shown = shownNow();
  if (shown === "reconnecting" && !link) {
    link = el("div", "", { id: "link", role: "status" }, el("span", "k-plaque", {}, "Reconnecting…"));
    (document.getElementById("top") ?? document.body).append(link);
  }
  const hidden = shown !== "reconnecting";
  if (link && link.hidden !== hidden) link.hidden = hidden;
}

// ---------- looking at it from outside ----------

/** For `window.town`: everybody else as they would be drawn this moment, what the room was last told of the member, and the connection. */
export const liveHandles = {
  players: (): {
    name: string;
    player: string;
    x: number;
    y: number;
    moving: boolean;
    seated: boolean;
    facing: number;
    alpha: number;
  }[] =>
    company
      .all()
      .filter((f) => !f.fig.gone)
      .map((f) => {
        // Where a frame drawn now would put them: the room's sample this moment, as `stepPlayers` takes it.
        const m = room?.sample(f.id) ?? null;
        return {
          name: f.who.name,
          player: f.who.player,
          x: m?.x ?? f.fig.x,
          y: m?.y ?? f.fig.y,
          moving: f.fig.moving,
          seated: f.fig.seated,
          facing: f.fig.dir,
          alpha: Math.round(f.fig.alpha * 100) / 100,
        };
      }),
  told: (): { step: Step; at: number } | null => told,
  link: () => ({
    state: room?.state() ?? null,
    shown: shownNow(),
    you: room?.you() ?? null,
    others: othersInTown(),
    rtt: room?.rtt() ?? null,
  }),
};
