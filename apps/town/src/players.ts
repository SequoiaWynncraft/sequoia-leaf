/**
 * Other players in town, live (on the guild's own server; with the made-up guild nobody is here).
 * While the town's scene is on the stage, the page is in Leaf's room `town` (`joinLive`): it tells
 * the room where the member's figure is, as it moves, and draws everybody else in the room exactly
 * where the room says they are, each in their own skin. They are never solid. Leaving the scene,
 * for the camp or into a game, leaves the room; coming back joins it again.
 *
 * Here too: telling the room of the member's touches on things in town (`town.ts`'s
 * `touchThing`) and playing everybody else's, the member's emotes (the plaque over their own
 * figure, and what everybody sees of them), the wave on a live player's card, the small
 * "Reconnecting…" once the connection has been down a couple of seconds, and the kit's cards for
 * a connection Leaf has let go of. The rules are in `motion.ts`.
 */

import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { type Emote, EMOTES } from "@sequoia-leaf/kit/emotes.ts";
import { type LetGo, letGoCard, member, where } from "@sequoia-leaf/kit/live.ts";
import {
  joinLive,
  leafClock,
  type LiveEars,
  type LiveMember,
  type LiveRoom,
  type LiveStatus,
  type Step,
} from "@sequoia-leaf/kit/realtime.ts";
import { bake, lookFor, paintSkin, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Pt } from "@sequoia-leaf/kit/util.ts";

import { face, feet, footfall, headOf, hop, makeActor, onScreen, stepActor } from "./actors.ts";
import { emoteOver } from "./fx.ts";
import { type Actor, G, hooks, ROOM, toPage } from "./game.ts";
import { GUEST, rankName } from "./live.ts";
import { Company, type Fellow, linkShown, NAMED_FOR, othersIn, stepOf } from "./motion.ts";
import { touchThing } from "./town.ts";
import { followLive } from "./visitors.ts";
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

/** How somebody else in the room is drawn: their actor, and a seat of their own for when they sit, wherever they are. */
interface Drawn {
  a: Actor;
  seat: Seat;
}

/** Everybody else in the room, by their account, each drawn with an actor of their own. */
const company = new Company<Drawn>((m) => ({ a: figureOf(m), seat: seatAt(0, 0, 0) }), {
  emote: (f, kind) => {
    express(f.own.a, kind);
  },
  touch: (name) => {
    touchThing(name, false);
  },
  status: (s) => {
    status = s;
    if (s === "closed") downAt ??= performance.now();
    if (s === "replaced" || s === "signedout") letGoOf(s);
    showLink();
  },
});
let room: LiveRoom | null = null;
let status: LiveStatus | null = null;
/** The connection dropped and the room has not welcomed the page again yet; since when (`performance.now()`). */
let downAt: number | null = null;
/** The connection was let go of for good, and why: the page stays out of the room until told to play here. */
let letGo: LetGo | null = null;
/** Whether the town is on the stage, and so in the room. */
let onStage = false;
/** Where the member's feet were the last time the room was told, and what it was told, when. */
let was: Pt | null = null;
let told: { step: Step; at: number } | null = null;

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
    downAt = null;
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
const alone = (): boolean => downAt !== null && performance.now() - downAt > ALONE_AFTER;

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
function figureOf(m: LiveMember): Actor {
  const a = makeActor({ name: m.name, rank: rankOf(m), level: 0, voice: 0 }, bake(paintSkin(lookFor(m.name))), 0, 0);
  a.id = m.player;
  a.alpha = 0;
  a.doing = "walk";
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      a.body = bake(img);
    } catch {
      // A picture that cannot be read: the look of their own stays.
    }
  });
  img.src = skinOf(m.player);
  return a;
}

/** The connection is let go of for good: everybody fades away, and the kit's card says why. */
function letGoOf(why: LetGo): void {
  letGo = why;
  room = null;
  downAt = null;
  company.goAll();
  closeEmotes();
  const w = where();
  letGoCard(why, w.mode === "live" ? w.signIn : "", () => {
    letGo = null;
    status = null;
    showLink();
    if (onStage) enterRoom();
  });
}

function enterRoom(): void {
  if (room || letGo || !isLive()) return;
  was = null;
  status = null;
  downAt = null;
  room = joinLive(ROOM, ears);
}

/**
 * The town is on the stage, or off it: on, the page is in the room (unless the connection was let
 * go of), and the member's place is said again on the new connection, which the room shows as a
 * jump; off, it leaves the room and nobody else is drawn.
 */
export function townOnStage(on: boolean): void {
  onStage = on;
  if (on) {
    enterRoom();
    return;
  }
  room?.close();
  room = null;
  status = null;
  downAt = null;
  for (const f of company.clear()) f.own.a.away = true;
  closeEmotes();
  showLink();
}

/** Whether the page is in the room just now (live, on the stage, and not let go of). */
export const inRoom = (): boolean => room !== null;

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
  if (downAt !== null && performance.now() - downAt > ALONE_AFTER) company.goAll();
  if (downAt !== null) showLink();
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
  for (const f of company.all()) {
    const a = f.own.a;
    // Hops and words; a figure drawn from the room walks nowhere of its own accord.
    stepActor(a, dt);
    dress(f);
    if (a.moving) footfall(a, walked.get(f) ?? a.walked);
  }
  for (const f of came) f.own.a.named = G.t + NAMED_FOR;
  for (const f of went) f.own.a.away = true;
  if (plaque && G.player?.moving) closeEmotes();
  placeEmotes();
}

/** Puts somebody's actor where their figure is: on their feet, or seated where they are. */
function dress(f: Fellow<Drawn>): void {
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
  if (fig.seated) {
    Object.assign(own.seat, { x: fig.x, y: fig.y, dir: fig.dir, from: { x: fig.x, y: fig.y } });
    a.seat = own.seat;
    // Already sitting: not drawn on the way into the seat.
    a.sat = -9;
  } else a.seat = null;
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

/** How long the connection has been down, in milliseconds; null while it is not. */
const downFor = (): number | null => (downAt === null ? null : performance.now() - downAt);

/**
 * The small "Reconnecting…" under the purse, once the connection has been down a couple of seconds and
 * the page is not let go of. Looked at again each frame while it is down.
 */
function showLink(): void {
  const shown = onStage ? linkShown(status, downFor()) : "none";
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
    status,
    shown: onStage ? linkShown(status, downFor()) : "none",
    you: room?.you() ?? null,
    others: othersInTown(),
    rtt: room?.rtt() ?? null,
  }),
};
