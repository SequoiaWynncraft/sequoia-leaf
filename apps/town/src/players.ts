/**
 * Other players where the member is, live (on the guild's own server; with the made-up guild nobody
 * is here): in town, and in a camp, the member's own or anybody's. The page is in one of Leaf's
 * rooms at a time, the one for the place on the stage (`onStage`, by `motion.ts`'s `liveAt`): the
 * town's, or the camp's own. It tells the room where the member's figure is, as it moves, and draws
 * everybody else in the room exactly where the room says they are, each in their own skin, on the
 * place's ground and as much of them as can be seen there (`stepPlayers`). They are never solid. The
 * room is made once: going from place to place goes from room to room on the same connection, the
 * Grove steps out of every room, and coming back steps in again. Only a game closes it, being a
 * page of its own with a connection of its own (a player is live on one connection at a time), and
 * coming out of it opens one again.
 *
 * Here too: telling the town's room of the member's touches on things in town (`town.ts`'s
 * `touchThing`) and playing everybody else's there, the member's emotes (the plaque over their own
 * figure, and what everybody sees of them), a live player's card with its wave (`meetLive`), the
 * small "Reconnecting…" once the connection has been down a couple of seconds, the kit's cards for
 * a connection Leaf has let go of, and in a camp's room Leaf's word that the owner changed the camp
 * (`leaf.ts`'s `campChanged`). The rules are in `motion.ts`.
 *
 * Somebody away (Leaf's rule, as everything else has it: `where.ts`) has sat down where they are and
 * nodded off: facing us unless they sat on a seat, eyes closed, a "z" now and then, the same moments
 * on every page; the moment they move or do anything, they are up and about again.
 */

import { away } from "@sequoia-leaf/core";
import { builtAt } from "@sequoia-leaf/core/build/moment.ts" with { type: "macro" };
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { type Emote, EMOTES } from "@sequoia-leaf/kit/emotes.ts";
import { type LetGo, letGoCard, member, where } from "@sequoia-leaf/kit/live.ts";
import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import {
  joinLive,
  leafClock,
  leafKnown,
  type LiveEars,
  type LiveMember,
  type LiveRoom,
  type Step,
} from "@sequoia-leaf/kit/realtime.ts";
import { heardLive } from "@sequoia-leaf/kit/report.ts";
import { bake, type Body, lookFor, paintSkin, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, pick, type Pt } from "@sequoia-leaf/kit/util.ts";
import { zAt } from "@sequoia-leaf/town/clock.ts";
import type { Ground } from "@sequoia-leaf/town/map/grid.ts";
import { TOWN } from "@sequoia-leaf/town/map/map.ts";

import { cardLine } from "./about.ts";
import { face, feet, footfall, headOf, hop, makeActor, onScreen, putAs, say, stepActor } from "./actors.ts";
import { unread } from "./board.ts";
import { emoteOver, float } from "./fx.ts";
import { type Actor, G, hooks, ROOM, type Seat, SEED, toPage } from "./game.ts";
import { guild } from "./guild.ts";
import { closeCard, closePanel, showCard } from "./hud.ts";
import { campChanged, campEntered, whoseCamp } from "./leaf.ts";
import { GUEST, rankName } from "./live.ts";
import {
  Company,
  type Fellow,
  linkShown,
  type LiveAt,
  liveAt,
  NAMED_FOR,
  othersIn,
  sameLive,
  stepOf,
} from "./motion.ts";
import { newsMoment } from "./notes.ts";
import type { Place } from "./screen.ts";
import { touchThing } from "./town.ts";
import { dozy, followLive } from "./visitors.ts";
import { inGame, type Where } from "./where.ts";

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
  // Touches on things are the town's alone.
  touch: (name) => {
    if (inTown()) touchThing(name, false);
  },
  status: (s) => {
    heardLive(s);
    if (s === "replaced" || s === "signedout") letGoOf(s);
    showLink();
  },
});
/**
 * The page's room: where the page stands with it is its own state (`room.state()`), down, away or let
 * go of included. Let go of by Leaf, it is kept, shown as let go, until the member says to play here.
 */
let room: LiveRoom | null = null;
/** Where the stage has the page live: in a room (the town's, a camp's), out of every room for the Grove, or under a game. */
let stage: LiveAt = { at: "shut" };
/** What the room was last told of the member: where their feet were, the step, and when. */
let said: { was: Pt; step: Step; at: number } | null = null;

/** Whether the game is live here, as somebody: only then is there a room. */
const isLive = (): boolean => where().mode === "live" && member() !== null;
/** Whether the page is live in the town's room (and not a camp's). */
const inTown = (): boolean => stage.at === "room" && stage.room === ROOM;

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
    if (name.startsWith("camp:")) void campEntered();
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
  changed(rev) {
    void campChanged(rev);
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
 * Everybody in the town's room with the member, the member too, with their rank as the town shows
 * it, and those awaited back after Leaf restarted, who stand where they were; null while the page is
 * in no room, or in a camp's.
 */
export function roomNow(): { id: string; name: string; rank: string | null }[] | null {
  if (!room || room.you() === null || alone() || !inTown()) return null;
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
  letGoCard(why, () => {
    room = null;
    showLink();
    if (stage.at === "room") enterRoom(stage.room);
  });
}

/** Into a room: on the connection there is, or on a new one if there is none. The member's place is said again, which the room shows as a jump. */
function enterRoom(name: string): void {
  if (!isLive()) return;
  said = null;
  if (room) room.go(name);
  else room = joinLive(name, ears);
}

/**
 * The place on the stage now (null: under a game), and so the room the page is in (`liveAt`), for a
 * camp the one of whoever's camp it is: in a room, the page is in it (unless Leaf let it go); out of
 * every room for the Grove, it keeps the connection; under a game, it closes it. Whoever was drawn
 * from the room before is gone at once, as the places change in the dark between them.
 */
export function onStage(place: Place | null): void {
  const to = liveAt(place, whoseCamp());
  if (sameLive(to, stage)) return;
  stage = to;
  for (const f of company.clear()) f.own.a.away = true;
  closeEmotes();
  if (to.at === "room") enterRoom(to.room);
  else if (to.at === "away") room?.go(null);
  else {
    room?.close();
    room = null;
  }
  showLink();
}

/** Whether the page is in the room just now, or coming back to it (live, on the stage, and not let go of). */
export function inRoom(): boolean {
  const s = room?.state();
  return s !== undefined && s.at !== "away" && s.at !== "gone";
}

/** Leaf's clock now, as far as this page can tell: out of a room, as it last heard. */
export const leafNow = (): number => room?.serverNow() ?? leafClock(Date.now());
/** The moment this page was built, written into it then. */
const BUILT = builtAt();
/** The moment the News tab shows notes at (`newsMoment`): Leaf's clock once known, the page's build before. */
export const newsNow = (): number => newsMoment(leafNow(), leafKnown(), BUILT);
/** Whether there is news out by that moment the member has not opened. */
export const unreadNow = (): boolean => unread(newsNow());

// ---------- each moment ----------

/** What a place lends whoever is drawn live in it: its ground, for their footfalls; and how much of somebody at a point can be seen there (behind the camp's great tree, nothing). */
export interface LivePlace {
  readonly ground: Ground;
  readonly seen: (at: Pt) => number;
}
const IN_TOWN: LivePlace = { ground: TOWN, seen: () => 1 };

/**
 * A moment in a place (`at`, the town's unless said): the room hears where the member's figure is at
 * once, from their own walking (`jumped` when they were put there without walking), and nothing
 * waits for it; then everybody else is drawn where the room says they are now, and those who have
 * gone fade away.
 */
export function stepPlayers(me: Actor, dt: number, jumped: boolean, at: LivePlace = IN_TOWN): void {
  if (room) {
    const step = stepOf(me, jumped ? null : (said?.was ?? null), dt);
    room.move(step, jumped);
    said = { was: { x: me.x, y: me.y }, step, at: Date.now() };
  }
  drawOthers(dt, at);
}

/** Whether somebody in the game by the one account (`where.ts`) is away by Leaf's rule. */
const dozes = (w: Where | undefined, now: number): boolean => w !== undefined && inGame(w) && away(w.acted, now);

function drawOthers(dt: number, at: LivePlace): void {
  // Down a while: the others go, and the place plays on alone until the room welcomes the page again.
  if (alone()) company.goAll();
  if (room?.state().at === "down") showLink();
  const before = new Map(company.all().map((f) => [f, { ...f.fig, walked: f.own.a.walked }]));
  const { came, went } = company.step((id) => room?.sample(id) ?? null, dt);
  const now = leafNow();
  const all = guild.whereabouts();
  for (const f of company.all()) {
    const was = before.get(f);
    // A move somewhere, as the room tells it, is doing something: by Leaf's rule too.
    if (was && was.jump === f.fig.jump && (was.x !== f.fig.x || was.y !== f.fig.y)) stirred.set(f.who.player, now);
    const a = f.own.a;
    // Hops and words; a figure drawn from the room walks nowhere of its own accord.
    stepActor(a, dt);
    dress(f, dozes(all.get(f.who.player), now));
    a.alpha *= at.seen(a);
    if (a.moving) footfall(a, was?.walked ?? a.walked, at.ground);
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

/** Everybody else where the member is, live, as they are to be drawn. */
export const livePlayers = (): Actor[] => company.all().map((f) => f.own.a);

/** Whether somebody where the member is is another player, live. */
export const isLivePlayer = (a: Actor): boolean => company.all().some((f) => f.own.a === a);

/** How many others are in the room, once it has said; null before it has welcomed the page. */
function othersHere(): number | null {
  const you = room?.you() ?? null;
  return room && you !== null && !alone() ? othersIn(room.members(), you) : null;
}

/** How many others are in town, once the town's room has said; null before, and out of it. */
export const othersInTown = (): number | null => (inTown() ? othersHere() : null);

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

/** What somebody's card says they are about, under their rank, as everything else has it (`where.ts`). */
export const aboutLine = (who: Actor) => (): string =>
  cardLine(guild.whereabouts().get(who.id), leafNow(), member()?.id ?? "") ?? "";

/**
 * Somebody touched, if it is the member or another player live here (says whether it was): in a room
 * the member's own figure offers its emotes, a second tap putting them away (`touched`); out of one it
 * hops and says so. Another player is drawn where they really are, so does not turn; their card has a wave.
 */
export function meetLive(who: Actor): boolean {
  if (who.you && inRoom()) {
    if (!plaqueWas) openEmotes();
  } else if (who.you) {
    hop(who);
    say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
  } else if (isLivePlayer(who)) showCard(who, aboutLine(who), () => waveAt(who));
  else return false;
  return true;
}

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
/** Whether the plaque was up when the last touch on the world came (`touched`). */
let plaqueWas = false;

/** A touch on the world: the plaque of emotes goes, and whether it was up is kept for `meetLive`. */
export function touched(): void {
  plaqueWas = plaque !== null;
  closeEmotes();
}

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

/** What the page shows of its room just now: nothing while it is out of every room. */
const shownNow = (): ReturnType<typeof linkShown> => (stage.at === "room" ? linkShown(room?.state() ?? null) : "none");

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

/** For `window.town`: everybody else as they would be drawn this moment, what the room was last told of the member, and the connection and its room. */
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
  told: (): { step: Step; at: number } | null => (said ? { step: said.step, at: said.at } : null),
  link: () => ({
    state: room?.state() ?? null,
    room: stage.at === "room" ? stage.room : null,
    shown: shownNow(),
    you: room?.you() ?? null,
    others: othersHere(),
    rtt: room?.rtt() ?? null,
  }),
};

/**
 * Puts away the newest of what is up over a scene: the emotes, a panel, what the scene has of its
 * own (`own`, which says whether it put anything away), then the card of whoever was tapped. Says
 * whether anything was put away: with nothing, Escape is the settings menu.
 */
export function putAway(own: () => boolean = () => false): boolean {
  if (emotesOpen()) closeEmotes();
  else if (G.panel) closePanel();
  else if (!own()) return closeCard();
  return true;
}
