/**
 * Handles for looking at the town from outside: the screenshot tours in `review/`, and anybody at
 * the console. `window.town` jumps the clock, opens a place, moves the member, and says what the
 * stage and each place show. Nothing the game does goes through here.
 */

import type { Emote } from "@sequoia-leaf/kit/emotes.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";
import { boardAt, SET_OUT } from "@sequoia-leaf/town/clock.ts";
import type { PlaceId } from "@sequoia-leaf/town/map/rows.ts";

import { openAbout } from "./aboutui.ts";
import { byClock, feet, headOf } from "./actors.ts";
import type { CampScene } from "./campscene.ts";
import type { Visit } from "./doors.ts";
import { cheered } from "./events.ts";
import { type Actor, G, type Going, hooks, type PanelId, SEED, show, toPage } from "./game.ts";
import type { GameId } from "./games.ts";
import type { Grove } from "./grovescene.ts";
import { closePanel } from "./hud.ts";
import { again, town as kept } from "./leaf.ts";
import { emote, leafNow, liveHandles, livePlayers } from "./players.ts";
import type { Stood } from "./stage.ts";
import { crabs, flown, hung, lastTouches, placeCrabs, table } from "./town.ts";
import type { Town } from "./townscene.ts";
import { dismissArrival, openPanel } from "./ui.ts";
import { members, spotsNow, stepVisitors } from "./visitors.ts";

declare global {
  interface Window {
    /** Handles for looking at the town from outside: jump the clock, open a place, move the member. */
    town?: Outside;
  }
}

export interface Outside {
  skip: (seconds: number) => void;
  enter: () => void;
  /** Opens "Who is about". */
  about: () => void;
  /** Whoever was chosen in "Who is about" and is being shown, whether the view went to them, and the seconds left. */
  found: Town["handles"]["found"];
  open: (id: PanelId) => void;
  close: () => void;
  visit: (id: PlaceId) => void;
  tp: (x: number, y: number) => void;
  /** Walks the member to a point in town, round whatever is in the way. */
  walk: (x: number, y: number) => void;
  tap: (x: number, y: number) => void;
  page: (x: number, y: number) => Pt;
  /** Where the prompt by a door is on the page, while it is up. */
  prompt: () => Pt | null;
  who: () => { name: string; x: number; y: number; doing: string }[];
  /** Real members in town just now (on the guild's own server). */
  visitors: () => { name: string; x: number; y: number }[];
  /** Every member drawn this moment: who, where their feet are drawn, how opaque. */
  drawn: Town["handles"]["drawn"];
  /** Where the member is, and where the missing crab is hiding. */
  me: () => Pt;
  lost: () => Pt;
  /** Milliseconds to work out and draw one frame, averaged over a hundred. */
  bench: () => number;
  /** Goes into a game by its door; says where that has got to; comes back out. */
  inside: (id: GameId) => void;
  door: () => "town" | "closing in" | ReturnType<Visit["state"]>;
  leave: () => void;
  /** Stops the town's clock (it is still drawn), so that `skip` alone moves it on. */
  hold: (on: boolean) => void;
  /** What the purse holds as the page shows it: Leaf's numbers. */
  purse: () => { leaf: number; coins: number };
  /** The member's town as the page shows it: Leaf's copy. */
  kept: () => unknown;
  /** Asks Leaf for the town again: for after a tour has staged something. */
  again: () => Promise<void>;
  /** Which place is on the stage, and how dark the walk between two has got (0 for not at all). */
  where: () => { where: "town" | "camp" | "grove"; dark: number };
  /** A camp: go to the member's own, or to somebody's (`of`, their account), and what `campscene.ts` offers besides. */
  camp: CampScene["handles"] & { go: (of?: string) => void };
  /** The Grove: go there, and what `grovescene.ts` offers besides. */
  grove: Grove["handles"] & { go: () => void };
  /** Everybody else in town live (on the guild's own server), as they would be drawn this moment. */
  players: Town["handles"]["players"];
  /** What the town's live room was last told of the member, and when. */
  told: Town["handles"]["told"];
  /** The live connection: its status, what is shown of it, and how many others are in the room. */
  link: Town["handles"]["link"];
  /** The member makes an emote, as if chosen from the plaque over their head. */
  emote: Town["handles"]["emote"];
}

/** What the stage lends the handles: its places, its clock and picture, and the way to go somewhere. */
export interface Lent {
  town: Town;
  camp: CampScene;
  grove: Grove;
  /** A moment of the stage's time, and a frame drawn. */
  tick(dt: number): void;
  draw(): void;
  /** Points the camera now. */
  snap(): void;
  stood(): Stood;
  /** Stops the stage's clock (it is still drawn), so that `skip` alone moves it on. */
  readonly hold: (on: boolean) => void;
  /** A touch at a point of the place on the stage, let go of at once. */
  readonly tap: (x: number, y: number) => void;
  go(where: Going): void;
}

/** Puts the handles on the page as `window.town`. */
export function lookFromOutside(o: Lent): void {
  window.town = {
    ...o.town.handles,
    skip(seconds) {
      for (let i = 0; i < seconds * 30 && o.stood().at !== "inside"; i++) o.tick(1 / 30);
      o.snap();
    },
    page(x, y) {
      return toPage(x, y);
    },
    prompt: () => (show.sign ? toPage(show.sign.x + show.sign.w / 2, show.sign.y + show.sign.h / 2) : null),
    bench() {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        o.tick(1 / 60);
        o.draw();
      }
      return (performance.now() - t0) / 100;
    },
    door() {
      const s = o.stood();
      return s.at === "inside" ? s.visit.state() : s.at === "closing" ? "closing in" : "town";
    },
    leave() {
      const s = o.stood();
      if (s.at === "closing" || s.at === "inside") s.visit.leave();
    },
    hold: o.hold,
    purse: () => ({ ...balance() }),
    again,
    where: () => ({ where: G.where, dark: Math.round(G.dark * 100) / 100 }),
    tap: o.tap,
    camp: {
      ...o.camp.handles,
      go(of) {
        o.go(of === undefined ? { to: "camp" } : { to: "camp", of });
      },
    },
    grove: {
      ...o.grove.handles,
      go() {
        o.go({ to: "grove" });
      },
    },
    // In whichever place is on the stage: the member.
    me: (): Pt => (G.player ? { x: Math.round(G.player.x), y: Math.round(G.player.y) } : { x: 0, y: 0 }),
  };
}

/** The town's own handles for looking at it from outside. */
export interface TownHandles {
  enter(): void;
  /** Opens "Who is about". */
  about(): void;
  /** Whoever was chosen in "Who is about" and is being shown, whether the view went to them, and the seconds left. */
  found(): { name: string; glide: boolean; left: number } | null;
  open(id: PanelId): void;
  close(): void;
  visit(id: PlaceId): void;
  inside(id: GameId): void;
  tp(x: number, y: number): void;
  /** Walks the member to a point, round whatever is in the way, as a tap on bare ground there would. */
  walk(x: number, y: number): void;
  /** The town's own, where each is and what it is doing, by Leaf's clock this moment. */
  who(): { name: string; x: number; y: number; doing: string }[];
  /** The crabs by their numbers, where each is by Leaf's clock this moment, and whether it is running off. */
  crabs(): { n: number; x: number; y: number; gone: boolean }[];
  /** Real members in town, visiting or dozing: where each is, what they are doing and how far faded in, by Leaf's clock this moment. */
  visitors(): ReturnType<typeof members>;
  /** Each of the games' spots in town for members busy at them: those laid by hand, then those further out. */
  spots(): ReturnType<typeof spotsNow>;
  /** The stump's board this moment: the hex each carved figure is on, and whether anybody is at it. */
  board(): { on: readonly number[]; played: boolean };
  /** What the guild's raid parties and wars have left: how many lanterns the day has, whose banner flies, and the last cheers played here, each by when (Leaf's clock). */
  moments(): { lanterns: number; banner: string | null; cheered: { what: string; at: number }[] };
  /** Every member drawn this moment (the member, visitors, dozers, live players): who, where their feet are drawn, how tall, how opaque. */
  drawn(): { id: string; name: string; x: number; y: number; tall: number; seated: boolean; alpha: number }[];
  me(): Pt;
  lost(): Pt;
  kept(): unknown;
  /** Everybody else in town live, as they would be drawn this moment. */
  players: (typeof liveHandles)["players"];
  /** What the town's room was last told of the member, and when (milliseconds since 1970). */
  told: (typeof liveHandles)["told"];
  /** The last touches on things in town played here, and whether each was the member's own. */
  touches(): { name: string; own: boolean }[];
  /** The live connection: its status, what is shown of it, the member's number, how many others. */
  link: (typeof liveHandles)["link"];
  /** The member makes an emote, as if chosen from the plaque over their head. */
  emote(kind: Emote): void;
}

/** What the town lends its handles: the member, Cinfy, everybody drawn, and its own ways to move the member. */
export interface TownLent {
  readonly player: Actor;
  readonly cinfy: Actor;
  readonly visit: (id: PlaceId) => void;
  halt(): void;
  putAt(x: number, y: number): void;
  walk(x: number, y: number): void;
  snap(): void;
  everyone(): Actor[];
}

/** The town's handles, over what it lends them. */
export function townHandles(t: TownLent): TownHandles {
  return {
    enter() {
      dismissArrival();
    },
    about() {
      openAbout();
    },
    found() {
      const f = show.found;
      return f ? { name: f.a.who.name, glide: f.glide === true, left: Math.round((f.until - G.t) * 10) / 10 } : null;
    },
    open: openPanel,
    close: closePanel,
    visit: t.visit,
    inside(id) {
      hooks.go({ to: "game", game: id });
    },
    tp(x, y) {
      t.halt();
      t.putAt(x, y);
      t.snap();
    },
    walk(x, y) {
      t.walk(x, y);
    },
    who() {
      G.now = leafNow();
      return [t.cinfy, ...G.folk].map((a) => {
        byClock(a);
        return { name: a.who.name, x: Math.round(a.x), y: Math.round(a.y), doing: a.doing };
      });
    },
    crabs() {
      G.now = leafNow();
      placeCrabs();
      return crabs.map((c) => ({ n: c.n, x: Math.round(c.x), y: Math.round(c.y), gone: c.bolt > 0 }));
    },
    visitors() {
      G.now = leafNow();
      stepVisitors(0, [t.player, ...livePlayers(), ...G.folk]);
      return members();
    },
    spots: spotsNow,
    board() {
      G.now = leafNow();
      return { on: table.played ? boardAt(SEED, G.now).on : SET_OUT, played: table.played };
    },
    moments() {
      G.now = leafNow();
      return { lanterns: hung(), banner: flown()?.land ?? null, cheered: [...cheered] };
    },
    drawn: () =>
      t
        .everyone()
        .flatMap((a) =>
          a.away || a.alpha <= 0.02
            ? []
            : [{ id: a.id, name: a.who.name, ...feet(a), tall: headOf(a), seated: a.seat !== null, alpha: a.alpha }],
        ),
    me() {
      return { x: Math.round(t.player.x), y: Math.round(t.player.y) };
    },
    lost() {
      const c = crabs.find((k) => k.lost);
      return c ? { x: Math.round(c.x), y: Math.round(c.y) } : { x: 0, y: 0 };
    },
    kept: () => kept(),
    players: liveHandles.players,
    told: liveHandles.told,
    touches: () => [...lastTouches],
    link: liveHandles.link,
    emote,
  };
}
