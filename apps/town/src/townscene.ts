/**
 * The town as a scene: who is here, what a touch does, how the member gets about and into the
 * places, and the letter at the gate. `main.ts` drives it through `Scene` and knows nothing else
 * about it.
 */

import type { Emote } from "@sequoia-leaf/kit/emotes.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import { bake, type Body, type Look, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Ctx, dist, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";
import { FOLK, folk, KEEPER } from "@sequoia-leaf/town/folk.ts";
import { BOX_FULL, roomInBox } from "@sequoia-leaf/town/mail.ts";

import { initAbout, openAbout } from "./aboutui.ts";
import {
  face,
  feet,
  freeSeat,
  goToSeat,
  headOf,
  hop,
  makeActor,
  makeFolk,
  peopleOn,
  placeFolk,
  release,
  rouse,
  say,
  seatFree,
  stepActor,
  stepFolk,
  walkTo,
} from "./actors.ts";
import { apart, ease, stood, stoodAt } from "./apart.ts";
import type { CampArt } from "./campart.ts";
import { drawPicture, drawWords, type Picture, sizeBuffers } from "./draw.ts";
import { beginEvents, stepEvents } from "./events.ts";
import { flights, stepFlights } from "./flights.ts";
import { initFolkArt } from "./folkart.ts";
import { updateFx } from "./fx.ts";
import { type Actor, after, changed, G, hooks, type PanelId, show } from "./game.ts";
import { type GameId, isGame, worksWaiting } from "./games.ts";
import { GROUND, NEAR, paintBackdrop, paintGround, paintNear, SKYLINE } from "./ground.ts";
import { guild } from "./guild.ts";
import { closeCard, closePanel, refreshFace, setFace, setHammer, showCard } from "./hud.ts";
import { ask, mine, town as kept } from "./leaf.ts";
import { compose } from "./letter.ts";
import { inTownLine } from "./news.ts";
import {
  closeEmotes,
  emote,
  emotesOpen,
  inRoom,
  isLivePlayer,
  liveHandles,
  livePlayers,
  openEmotes,
  othersInTown,
  stepPlayers,
  tellRoom,
  townOnStage,
  waveAt,
} from "./players.ts";
import type { Sprites } from "./sprites.ts";
import type { Scene, Stage } from "./stage.ts";
import { type Door, makeTouch } from "./touch.ts";
import {
  allLights,
  buildTown,
  crabAt,
  crabs,
  crabsStanding,
  drawGlows,
  drawStrings,
  drawWater,
  lightTable,
  openDoor,
  props,
  stepTown,
  table,
  tapCrab,
  tapSky,
  tapString,
  tapWater,
  twinkleAll,
} from "./town.ts";
import { dismissArrival, initUI, openPanel, showArrival, townDock } from "./ui.ts";
import { isVisitor, members, stepVisitors } from "./visitors.ts";
import { H, hedgeY, place, type PlaceId, PLACES, pondD, SEATS, TOWN, W } from "./world.ts";

/** Where the view closes in when the member goes into each game, and where they stand to go in. */
const DOORWAY: Readonly<Record<GameId, Pt>> = {
  works: { x: 373, y: 104 },
  table: { x: table.x, y: table.y - 19 },
};
/** The Works' threshold: the member fades into the dark between its stand and here. */
const THRESHOLD = 121;
const STROLL = 64;
const STEP_IN = 15;

const bodyOf = (look: Look): Body => bake(paintSkin(look));

/** How far the camera may go: the town, a little of the forest above it, and a strip below. */
const BOUNDS = { w: W, top: -72, bottom: H + 24 } as const;
/** Where in this tab the town keeps where the member stood, for the next page (`stoodAt`). */
const STOOD = "town.stood.v1";
const HOME: Pt = { x: 0, y: 0 };

/** How long somebody chosen in "Who is about" is shown where they are, in seconds. */
export const FOUND_FOR = 3;

/**
 * Somebody chosen in "Who is about": a ring at their feet and their name over them for a few
 * seconds. The view stays where it is, unless they would be out of it once it is back on the
 * member; then it glides to them, and back when the time is up.
 */
function locate(a: Actor): void {
  // Whether the view goes to them is decided at the next step, with everybody where they are then.
  show.found = { a, until: G.t + FOUND_FOR, glide: null };
}

/**
 * Whether a point of the town would be in view, a little way inside its edges (more at the bottom,
 * where the dock is), with the camera settled on `focus` and no panel open.
 */
function inView(p: Pt, focus: Pt): boolean {
  const { w: vw, h: vh } = G.view;
  const { w, top, bottom } = BOUNDS;
  const x = vw > w ? (w - vw) / 2 : clamp(focus.x - vw / 2, 0, w - vw);
  const y = vh > bottom - top ? top + (bottom - top - vh) / 2 : clamp(focus.y - vh / 2, top, bottom - vh);
  return p.x > x + 10 && p.x < x + vw - 10 && p.y > y + 16 && p.y < y + vh - 28;
}

/** The member's face in the corner opens what the town knows of them, and shuts it again. */
function openProfile(): void {
  if (G.panel === "profile") closePanel();
  else openPanel("profile");
}

export interface Town extends Scene {
  /**
   * Begins the visit: the member walks in through the gate (or, soon after a page in the same tab
   * went, is back where they stood), to a letter if there is one to read.
   */
  arrive(): void;
  /** The member is back from a camp: they walk in through the gate, and the town's own buttons are put back. */
  cameFromCamp(): void;
  /** The town's painted sky and near ferns, which a camp at the same dusk shares. */
  readonly backdrop: { sky: HTMLCanvasElement; near: HTMLCanvasElement };
  /** How the stage is told the way to the camp, once there is one. */
  toCamp: (() => void) | null;
  /**
   * The town is on the stage, or off it (the camp, or a game open over it): only while it is on is
   * the page in the town's live room.
   */
  onStage(on: boolean): void;
  /** The town's own handles for looking at it from outside. */
  readonly handles: {
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
    /** The town's own, where each is and what it is doing. */
    who(): { name: string; x: number; y: number; doing: string }[];
    /** Real members in town just now, visiting or dozing, and where each is. */
    visitors(): { name: string; x: number; y: number; dozing: boolean }[];
    /** Every member drawn this moment (the member, visitors, dozers, live players): who, where their feet are drawn, how tall, how opaque. */
    drawn(): { id: string; name: string; x: number; y: number; tall: number; seated: boolean; alpha: number }[];
    me(): Pt;
    lost(): Pt;
    kept(): unknown;
    /** Everybody else in town live, as they would be drawn this moment. */
    players: (typeof liveHandles)["players"];
    /** What the town's room was last told of the member, and when (milliseconds since 1970). */
    told: (typeof liveHandles)["told"];
    /** The live connection: its status, what is shown of it, the member's number, how many others. */
    link: (typeof liveHandles)["link"];
    /** The member makes an emote, as if chosen from the plaque over their head. */
    emote(kind: Emote): void;
  };
}

/** Who a figure is, for `apart`: a member's account, or which of the town's own. */
const whoIs = (a: Actor): string => (a.folk ? `folk:${a.folk.t.id}` : a.id);

export function makeTown(sprites: Sprites, campArt: CampArt, stage: Stage): Town {
  // ---------- the place itself ----------

  const ground = paintGround();
  buildTown(sprites, must(ground.getContext("2d"), "ground"));
  const standing = crabsStanding();
  const pic: Picture = {
    sky: paintBackdrop(),
    skyAt: { x: SKYLINE.worldX, y: SKYLINE.worldY - SKYLINE.horizon },
    ground,
    groundAt: { x: GROUND.x, y: GROUND.y },
    near: paintNear(),
    nearAt: { x: NEAR.x, y: NEAR.y },
    props,
    others: () => (flights.length > 0 ? [...standing, ...flights] : standing),
    people: () => [...G.folk, ...G.visitors, ...livePlayers(), player, cinfy],
    lights: allLights,
    beyond: () => undefined,
    under: drawWater,
    over: drawStrings,
    glows: drawGlows,
  };

  // ---------- who is here ----------

  const me = guild.me();
  const player = makeActor(me, bodyOf(me.look), 256, 85, true);
  player.id = member()?.id ?? "";
  player.alpha = 0;
  G.player = player;
  // The town's own: drawn as themselves, each where its evening finds it.
  initFolkArt(campArt);
  // A walk anybody here is sent on ends beside whoever is standing or sitting there.
  peopleOn(TOWN, () => pic.people());
  const cinfy = makeFolk(folk("cinfy"), 104, 113);
  placeFolk(cinfy, 0);
  G.cinfy = cinfy;
  G.folk = FOLK.filter((t) => t.job !== "counter" && t.job !== "calls").map((t, i) => {
    const a = makeFolk(t, 256, 216);
    placeFolk(a, i);
    return a;
  });

  // The member's own skin, if it is served.
  const skin = new Image();
  skin.addEventListener("load", () => {
    try {
      player.body = bake(skin);
      refreshFace();
    } catch {
      // A picture the page may not read: the made-up skin stays.
    }
  });
  skin.src = me.skin;

  initUI(sprites, campArt);
  setFace(openProfile);

  initAbout(locate);

  // ---------- going places ----------

  /** A game the member is on the way into: still walking to its door, or going through it. */
  let going: { id: GameId; through: boolean } | null = null;
  let seatWas = player.seat;
  /** The member was put somewhere without walking there since the room was last told: a jump. */
  let jumped = false;
  /** Puts the member somewhere at once, which the room is told is a jump. */
  function putAt(x: number, y: number): void {
    player.x = x;
    player.y = y;
    jumped = true;
  }

  function halt(): void {
    release(player);
    player.path = [];
    player.arrive = null;
    going = null;
    show.dest = null;
  }

  /** Opens a place at once and walks the member there meanwhile: its dock button, or a card's way there. */
  function visit(id: PlaceId): void {
    openPanel(id);
    const pl = place(id);
    if (G.near === id) {
      if (!player.seat) player.dir = pl.face;
      return;
    }
    halt();
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
    });
  }
  hooks.visit = visit;

  /** Through the door: the Works' doors part and the member steps in; at the stump the lantern burns up. */
  function through(id: GameId, of?: string): void {
    going = { id, through: true };
    show.dest = null;
    closePanel();
    closeCard();
    if (id === "works") {
      G.inDoor = true;
      openDoor(true);
      player.dir = 3;
      player.speed = STEP_IN;
      player.path = [{ x: place("works").stand.x, y: THRESHOLD }];
      player.arrive = null;
    } else lightTable(true);
    stage.goInside(id, DOORWAY[id], of);
  }

  /** Walks the member to a game's door and on through it (for the Works, to `of`'s yard, if given). */
  function goIn(id: GameId, of?: string): void {
    if (!G.home || going?.through) return;
    if (id === "table") {
      if (player.seat?.at === "table") {
        through(id);
        return;
      }
      const seat =
        SEATS.find((s) => s.at === "table" && seatFree(s, player) && s.yours) ??
        SEATS.find((s) => s.at === "table" && seatFree(s, player));
      if (seat) {
        halt();
        going = { id, through: false };
        goToSeat(
          player,
          seat,
          () => freeSeat(player, "table"),
          (sat) => {
            seatWas = sat;
            through(id);
          },
        );
        return;
      }
    }
    const pl = place(id);
    halt();
    going = { id, through: false };
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
      through(id, of);
    });
  }
  hooks.goIn = goIn;

  /** Out through the gate and down the trail to the member's own camp. */
  let leaving = false;
  function toCamp(): boolean {
    if (!G.home || going || leaving || !town.toCamp) return false;
    halt();
    closePanel();
    closeCard();
    leaving = true;
    walkTo(player, { x: 256, y: 100 });
    player.path.push({ x: 256, y: 84 });
    const started = G.t;
    const wait = (): void => {
      if (player.y < 130 || G.t - started > 0.9) town.toCamp?.();
      else after(0.1, wait);
    };
    wait();
    return true;
  }
  hooks.toCamp = toCamp;

  /** The member's own figure had its emotes up when the touch came. */
  let plaque = false;
  /** Somebody in town is touched. */
  function meet(who: Actor): void {
    // Somebody dozing sleeps on; their card says who they are.
    if (who.dozing !== null) {
      showCard(who);
      return;
    }
    // In the live room, the member's own figure offers its emotes; a second tap puts them away.
    if (who.you && inRoom()) {
      if (!plaque) openEmotes();
      return;
    }
    // Another player, live: drawn where they really are, so they do not turn; their card has a wave.
    if (isLivePlayer(who)) {
      showCard(who, null, () => {
        waveAt(who);
      });
      return;
    }
    hop(who);
    if (who.you) {
      say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
      return;
    }
    // A member really here: they look round, and their card says who they are.
    if (isVisitor(who)) {
      if (!who.seat && !who.moving) face(who, player.x, player.y);
      showCard(who);
      return;
    }
    const t = who.folk?.t;
    if (who === cinfy) say(who, pick(KEEPER.taps, Math.random()));
    else if (t) {
      rouse(who);
      if (!who.seat && who.lift === 0) face(who, player.x, player.y);
      who.hold = 2.6;
      say(who, pick(t.greets, Math.random()), 2);
    }
    showCard(who);
  }

  const awake = (): boolean => G.home && !going?.through && !leaving && G.dark < 0.35;

  // The page going (a reload, a deploy's reload) keeps where the member stands in town for the next page in this tab.
  addEventListener("pagehide", () => {
    keepText(STOOD, G.where === "town" && !going?.through && !leaving ? stood(player, Date.now()) : null, "tab");
  });

  /** Every member in town: the member, visitors and dozers, and live players. */
  const everyone = (): Actor[] => [player, ...G.visitors, ...livePlayers()];
  /**
   * Where each figure's feet were at the last step, and how fast they have been going, over about a
   * tenth of a second: a live player's place, drawn from the room's samples, jitters from frame to frame.
   */
  const pace = new WeakMap<Actor, { x: number; y: number; vx: number; vy: number }>();
  /** Faster than anybody walks, in pixels a second: put somewhere else, not walking there. */
  const JUMP = 300;
  /**
   * Everybody on top of one another, members and the town's own, standing, sitting or walking the
   * same way, is drawn apart (`apart`), stepping aside and back as they meet and part. A page
   * spreads what it shows: two walking in line may be apart on one page and not on another, and on
   * neither inside each other.
   */
  function standApart(dt: number): void {
    if (dt <= 0) return;
    const everybody = pic.people();
    const k = Math.min(1, dt / 0.1);
    const drawn = everybody.flatMap((a) => {
      if (a.away || a.alpha <= 0.02) {
        pace.delete(a);
        return [];
      }
      const { x, y } = a.seat ?? a;
      const was = pace.get(a);
      const [rx, ry] = was ? [(x - was.x) / dt, (y - was.y) / dt] : [0, 0];
      // Standing, only now in sight, or put somewhere else: not walking.
      const walks = a.moving && Math.hypot(rx, ry) < JUMP;
      const vx = was && walks ? was.vx + (rx - was.vx) * k : 0;
      const vy = was && walks ? was.vy + (ry - was.vy) * k : 0;
      pace.set(a, { x, y, vx, vy });
      // One of the town's own at its post keeps its place, as whoever sits does.
      const seated = a.seat !== null || (a.folk !== null && !a.moving);
      return [{ id: whoIs(a), x, y, tall: headOf(a), seated, vx, vy }];
    });
    const to = apart(drawn);
    for (const a of everybody) ease(a.aside, to.get(whoIs(a)) ?? HOME, dt);
  }

  /**
   * The places, as doors: each opens its panel, and walking on into a game's doorway, up to its
   * table or out through the gate goes in. At the fire, sitting by it or anywhere round it is
   * being at it; at the pond, anywhere along the shore; at the stump, sitting at it.
   */
  const AT: Partial<Record<PlaceId, (m: Actor) => boolean>> = {
    fire: (m) => m.seat?.at === "fire" || dist(m.x, m.y, 256, 214) < 30,
    pond: (m) => pondD(m.x, m.y) < 13,
    table: (m) => m.seat?.at === "table",
  };
  const doors: readonly Door[] = PLACES.map((pl) => {
    const game = isGame(pl.id) ? pl.id : null;
    return Object.assign({}, pl, {
      reach: pl.id === "fire" ? 10 : 22,
      // The way through the gate, and on up the trail beyond it.
      box: pl.id === "camp" ? { x: 242, y: 72, w: 28, h: 28 } : undefined,
      at: AT[pl.id],
      use: () => openPanel(pl.id),
      enter: game ? () => goIn(game) : pl.id === "camp" ? () => void toCamp() : undefined,
    });
  });

  const touch = makeTouch({
    ground: TOWN,
    doors: () => doors,
    people: () => pic.people(),
    greet: meet,
    own(x, y) {
      const crab = crabAt(x, y);
      if (crab) tapCrab(crab);
      else if (pondD(x, y) < 1) {
        tapWater(x, y);
        const pond = doors.find((d) => d.id === "pond");
        if (pond) touch.go(pond);
      } else return tapString(x, y);
      return true;
    },
    ownAt(x, y) {
      const crab = crabAt(x, y);
      return crab ? { box: { x: crab.x - 6, y: crab.y - 8, w: 12, h: 9 }, tip: null } : null;
    },
    props: () => props,
    sky(x, y) {
      if (y >= hedgeY(x)) return false;
      tapSky(x, y);
      return true;
    },
    awake,
    halt,
  });

  const town: Town = {
    backdrop: { sky: pic.sky, near: pic.near },
    toCamp: null,
    onStage: townOnStage,
    bounds: BOUNDS,

    resize(w, h) {
      sizeBuffers(w, h);
    },

    focus() {
      if (going?.through) return DOORWAY[going.id];
      const found = show.found;
      if (found?.glide === true) {
        const there = found.a.seat ?? found.a;
        return { x: there.x, y: there.y - 12 };
      }
      const at = player.seat ?? player;
      return { x: at.x, y: at.y - 12 };
    },

    step(dt, steer) {
      G.t += dt;
      stepActor(player, dt);
      touch.step(dt, steer);
      // The room hears where the member is at once, from their own walking; nothing waits for it.
      tellRoom(player, dt, jumped);
      jumped = false;
      stepActor(cinfy, dt);
      stepFolk(dt);
      stepVisitors(dt);
      stepPlayers(dt);
      standApart(dt);
      stepTown(dt);
      stepFlights(dt);
      stepEvents();
      // Somebody shown where they are, for a few seconds, or until they go.
      const found = show.found;
      if (found && (G.t >= found.until || found.a.away)) show.found = null;
      else if (found && found.glide === null) {
        const at = player.seat ?? player;
        found.glide = !inView(found.a.seat ?? found.a, { x: at.x, y: at.y - 12 });
      }
      if (G.home) guild.step(dt);
      updateFx(dt);

      // Stepping through the Works' door, in or out: into the dark and back.
      if (G.inDoor) {
        player.alpha = clamp((player.y - THRESHOLD) / 5, 0, 1);
        if (!going && player.path.length === 0) {
          G.inDoor = false;
          player.speed = STROLL;
          openDoor(false);
        }
      }
      // Sitting down at the stump is sitting down to play.
      if (awake() && player.seat !== seatWas && player.seat?.at === "table") through("table");
      seatWas = player.seat;
    },

    draw: () => drawPicture(pic),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px, pic.people());
    },

    tap(x, y, finger) {
      plaque = emotesOpen();
      closeEmotes();
      return touch.tap(x, y, finger);
    },
    point: touch.point,
    act() {
      if (G.panel && isGame(G.panel)) goIn(G.panel);
      else touch.act();
    },

    back() {
      if (emotesOpen()) closeEmotes();
      else if (G.panel) closePanel();
      else closeCard();
    },

    key: () => false,
    drag: () => undefined,
    release: () => undefined,

    awake,

    cameBack(id) {
      going = null;
      if (id === "table") {
        lightTable(false);
        return;
      }
      // Out of the dark of the doorway and back to where they stood.
      putAt(place("works").stand.x, THRESHOLD);
      player.dir = 0;
      player.path = [{ ...place("works").stand }];
      player.arrive = null;
    },

    cameFromCamp() {
      G.where = "town";
      leaving = false;
      going = null;
      release(player);
      putAt(256, 84);
      player.dir = 0;
      player.alpha = 0;
      player.say = "";
      player.speed = STROLL;
      walkTo(player, { x: 256, y: 128 }, () => {
        player.dir = 0;
      });
      townDock();
      setFace(openProfile);
      setHammer(null);
      hooks.toCamp = toCamp;
      // Whoever of the town's own is nearest the gate looks up.
      const nearest = G.folk
        .filter((a) => !a.away && !a.seat && a.doing !== "asleep" && dist(a.x, a.y, 256, 128) < 90)
        .toSorted((a, b) => dist(a.x, a.y, 256, 128) - dist(b.x, b.y, 256, 128))[0];
      if (nearest)
        after(0.9, () => {
          if (!nearest.moving) face(nearest, player.x, player.y);
          hop(nearest);
          say(nearest, pick(nearest.folk?.t.greets ?? ["hi!"], Math.random()), 2);
        });
    },

    arrive() {
      const { arrival } = kept();
      const letter = compose(arrival, guild.news(), [worksWaiting()]);
      // Loaded again in this tab a little after the last page: back where they stood. Otherwise in through the gate.
      const was = stoodAt(keptText(STOOD, "tab"), Date.now());
      if (was && !TOWN.footBlocked(was.x, was.y)) {
        putAt(was.x, was.y);
        player.dir = was.dir;
        stage.snap();
      } else
        after(0.35, () => {
          walkTo(player, { x: 256, y: 152 }, () => {
            player.dir = 0;
          });
        });
      const begin = (): void => {
        // Put away, Leaf posts what the town's own left while the member was away in the camp's
        // mailbox (not in this letter), but what does not fit beside the presents still in it.
        void (async () => {
          await ask({ do: "welcome", cursor: guild.told() });
          // Only a box full of presents turns a letter away.
          if (arrival.mail.length > 0 && !roomInBox(mine().letters)) hooks.feed(BOX_FULL, "coral");
        })();
        G.home = true;
        beginEvents();
        twinkleAll();
        // How many others are in town, once the town's room has said; then the feed says so.
        const greet = letter.show ? "You are home." : "Back again.";
        let tries = 0;
        const tellHowMany = (): void => {
          if (othersInTown() === null && tries++ < 12) {
            after(0.5, tellHowMany);
            return;
          }
          hooks.feed(`${greet} ${inTownLine(othersInTown() ?? 0)}`, "leaf");
        };
        tellHowMany();
        // Whoever of the town's own is nearest and awake looks up and says so.
        const nearest = G.folk
          .filter((a) => !a.away && a.doing !== "asleep")
          .toSorted((a, b) => dist(a.x, a.y, player.x, player.y) - dist(b.x, b.y, player.x, player.y))
          .slice(0, 2);
        nearest.forEach((a, i) => {
          after(0.5 + i * 0.6, () => {
            if (!a.seat && !a.moving && a.lift === 0) face(a, player.x, player.y);
            hop(a);
            say(a, pick(a.folk?.t.greets ?? ["hi!"], Math.random()), 2.4);
          });
        });
        changed();
      };
      if (letter.show) showArrival(letter, begin);
      else {
        document.getElementById("arrival")?.remove();
        begin();
      }
    },

    handles: {
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
      visit,
      inside: goIn,
      tp(x, y) {
        halt();
        putAt(x, y);
        stage.snap();
      },
      walk(x, y) {
        touch.walk(x, y);
      },
      who() {
        return [cinfy, ...G.folk].map((a) => ({
          name: a.who.name,
          x: Math.round(a.x),
          y: Math.round(a.y),
          doing: a.doing,
        }));
      },
      visitors: members,
      drawn: () =>
        everyone().flatMap((a) =>
          a.away || a.alpha <= 0.02
            ? []
            : [{ id: a.id, name: a.who.name, ...feet(a), tall: headOf(a), seated: a.seat !== null, alpha: a.alpha }],
        ),
      me() {
        return { x: Math.round(player.x), y: Math.round(player.y) };
      },
      lost() {
        const c = crabs.find((k) => k.lost);
        return c ? { x: Math.round(c.x), y: Math.round(c.y) } : { x: 0, y: 0 };
      },
      kept: () => kept(),
      players: liveHandles.players,
      told: liveHandles.told,
      link: liveHandles.link,
      emote,
    },
  };
  return town;
}
