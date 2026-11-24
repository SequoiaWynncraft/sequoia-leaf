/**
 * The town as a scene: who is here, what a touch does, how the member gets about and into the
 * places, and the letter at the gate. `main.ts` drives it through `Scene` and knows nothing else
 * about it.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import { bake, type Body, type Look, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Ctx, dist, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";
import { FOLK, folk, KEEPER } from "@sequoia-leaf/town/folk.ts";
import { BOX_FULL, roomInBox } from "@sequoia-leaf/town/mail.ts";

import { initAbout } from "./aboutui.ts";
import {
  face,
  freeSeat,
  goToSeat,
  hop,
  makeActor,
  makeFolk,
  placeFolk,
  rouse,
  say,
  seatFree,
  stepActor,
  stepFolk,
  stop,
  walkAlong,
  walkTo,
  wayTo,
} from "./actors.ts";
import { stood, stoodAt } from "./apart.ts";
import type { CampArt } from "./campart.ts";
import { makeApart } from "./crowd.ts";
import { drawPicture, drawWords, type Picture, sizeBuffers } from "./draw.ts";
import { beginEvents, stepEvents } from "./events.ts";
import { initFolkArt } from "./folkart.ts";
import { updateFx } from "./fx.ts";
import { type Actor, after, changed, G, hooks, show } from "./game.ts";
import { type GameId, isGame, worksWaiting } from "./games.ts";
import { GROUND, NEAR, paintBackdrop, paintGround, paintNear, SKYLINE } from "./ground.ts";
import { guild } from "./guild.ts";
import { closeCard, closePanel, refreshFace, setFace, setHammer, showCard } from "./hud.ts";
import { ask, mine, town as kept } from "./leaf.ts";
import { compose } from "./letter.ts";
import { inTownLine } from "./news.ts";
import {
  aboutLine,
  closeEmotes,
  emotesOpen,
  knownRanks,
  leafNow,
  livePlayers,
  meetLive,
  othersInTown,
  roomNow,
  stepPlayers,
  stirred,
  touched,
} from "./players.ts";
import { type TownHandles, townHandles } from "./review.ts";
import { placeOf } from "./screen.ts";
import type { Sprites } from "./sprites.ts";
import type { Scene, Stage } from "./stage.ts";
import { type Door, makeTouch } from "./touch.ts";
import { crabAt, lightTable, openDoor, props, stepTown, table, thingName, touchThing, twinkleAll } from "./town.ts";
import { allLights, buildTown, crabsStanding, drawGlows, drawStrings, drawWater } from "./townart.ts";
import { initUI, openPanel, showArrival, townDock } from "./ui.ts";
import { isVisitor, stepVisitors, worksTools } from "./visitors.ts";
import { H, place, type PlaceId, PLACES, pondD, SEATS, TOWN, W } from "./world.ts";

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
  /** The town's painted sky and near ferns, which a camp at the same dusk shares. */
  readonly backdrop: { sky: HTMLCanvasElement; near: HTMLCanvasElement };
  /** Walks the member to a game's door and on through it (for the Works, to `of`'s yard, if given). */
  goIn(id: GameId, of?: string): void;
  /** The town's own handles for looking at it from outside (`review.ts`). */
  readonly handles: TownHandles;
}

export function makeTown(sprites: Sprites, campArt: CampArt, stage: Stage): Town {
  // ---------- the place itself ----------

  G.now = leafNow();
  hooks.deeds = () => guild.deeds();
  // Where everybody is (`where.ts`) is worked out from the room as much as from Leaf's list.
  guild.followRoom({ room: roomNow, ranks: knownRanks, stirred });
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
    others: () => [...standing, ...worksTools()],
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
  const cinfy = makeFolk(folk("cinfy"), 104, 113);
  placeFolk(cinfy);
  G.cinfy = cinfy;
  G.folk = FOLK.filter((t) => t.job !== "counter" && t.job !== "calls").map((t) => {
    const a = makeFolk(t, 256, 216);
    placeFolk(a);
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

  /**
   * A game's door the member is on the way through: walking up to it, going in (the Works' doors
   * part and they step into the dark; at the stump the lantern burns up), or coming back out (out of
   * the Works' doorway to its stand; up from the stump). Only `doorTo` changes it; any halt, and any
   * change of place, ends it.
   */
  let door: { readonly game: GameId; readonly phase: "walking" | "in" | "out" } | null = null;
  /** The member was put somewhere without walking there since the room was last told: a jump. */
  let jumped = false;
  /** Puts the member somewhere at once, which the room is told is a jump. */
  function putAt(x: number, y: number): void {
    player.x = x;
    player.y = y;
    jumped = true;
  }

  /** The door the member is going through is now `next`: in the Works' doorway they step slowly, and its doors stand open. */
  function doorTo(next: typeof door): void {
    const was = door;
    door = next;
    const stepping = (d: typeof door): boolean => d !== null && d.game === "works" && d.phase !== "walking";
    player.speed = stepping(next) ? STEP_IN : STROLL;
    if (stepping(next) !== stepping(was)) openDoor(stepping(next));
  }

  function halt(): void {
    stop(player);
    doorTo(null);
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
    if (!stage.goInside(id, DOORWAY[id], of)) {
      doorTo(null);
      return;
    }
    doorTo({ game: id, phase: "in" });
    show.dest = null;
    closePanel();
    closeCard();
    if (id === "works") {
      player.dir = 3;
      walkAlong(player, [{ x: place("works").stand.x, y: THRESHOLD }]);
    } else lightTable(true);
  }

  /** Walks the member to a game's door and on through it (for the Works, to `of`'s yard, if given). */
  function goIn(id: GameId, of?: string): void {
    if (!G.home || door?.phase === "in") return;
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
        doorTo({ game: id, phase: "walking" });
        goToSeat(
          player,
          seat,
          () => freeSeat(player, "table"),
          () => {
            through(id);
          },
        );
        return;
      }
    }
    const pl = place(id);
    halt();
    doorTo({ game: id, phase: "walking" });
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
      through(id, of);
    });
  }

  /** Somebody in town is touched. */
  function meet(who: Actor): void {
    // Somebody dozing sleeps on; their card says who they are.
    if (who.dozing !== null) {
      showCard(who);
      return;
    }
    // The member, or another player live here.
    if (meetLive(who)) return;
    hop(who);
    // A member really here: they look round, and their card says who they are.
    if (isVisitor(who)) {
      if (!who.seat && !who.moving) face(who, player.x, player.y);
      showCard(who, aboutLine(who));
      return;
    }
    const t = who.folk?.t;
    if (who === cinfy) say(who, pick(KEEPER.taps, Math.random()));
    else if (t) {
      rouse(who);
      if (!who.seat && who.lift === 0) face(who, player.x, player.y);
      say(who, pick(t.greets, Math.random()), 2);
    }
    showCard(who);
  }

  const awake = (): boolean => stage.mayAct();

  // The page going (a reload, a deploy's reload) keeps where the member stands in town for the next page
  // in this tab: not while they walk off, or go through a door.
  addEventListener("pagehide", () => {
    const now = stage.now();
    const here = placeOf(now) === "town" && (now.at === "playing" || now.at === "dawn");
    keepText(STOOD, here ? stood(player, Date.now()) : null, "tab");
  });

  /** Every member in town: the member, visitors and dozers, and live players. */
  const everyone = (): Actor[] => [player, ...G.visitors, ...livePlayers()];
  /** Everybody on top of one another drawn apart (`crowd.ts`). */
  // A walk anybody here is sent on ends beside whoever is standing or sitting there.
  const standApart = makeApart(TOWN, () => pic.people());

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
      enter: game
        ? () => goIn(game)
        : pl.id === "camp" || pl.id === "grove"
          ? () => hooks.go({ to: pl.id === "camp" ? "camp" : "grove" })
          : undefined,
    });
  });

  const touch = makeTouch({
    ground: TOWN,
    doors: () => doors,
    people: () => pic.people(),
    greet: meet,
    own(x, y) {
      const crab = crabAt(x, y);
      if (crab) return touchThing(thingName("crab", crab.n));
      if (!touchThing(thingName("water", x, y))) return touchThing(thingName("lights", x, y));
      const pond = doors.find((d) => d.id === "pond");
      if (pond) touch.go(pond);
      return true;
    },
    ownAt(x, y) {
      const crab = crabAt(x, y);
      return crab ? { box: { x: crab.x - 6, y: crab.y - 8, w: 12, h: 9 }, tip: null } : null;
    },
    props: () => props,
    touch: (p, x, y) => void touchThing(thingName(p.kind, x, y)),
    sky: (x, y) => touchThing(thingName("sky", x, y)),
    awake,
    halt,
  });

  /** The member is back from a camp: they walk in through the gate, and the town's own buttons are put back. */
  function cameFromCamp(): void {
    halt();
    putAt(256, 84);
    player.dir = 0;
    player.alpha = 0;
    player.say = "";
    walkTo(player, { x: 256, y: 128 }, () => {
      player.dir = 0;
    });
    townDock();
    setFace(openProfile);
    setHammer(null);
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
  }

  const town: Town = {
    backdrop: { sky: pic.sky, near: pic.near },
    goIn,
    bounds: BOUNDS,

    resize(w, h) {
      sizeBuffers(w, h);
    },

    focus() {
      if (door?.phase === "in") return DOORWAY[door.game];
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
      // The room hears where the member is at once, and everybody else in it is drawn where they are.
      stepPlayers(player, dt, jumped);
      jumped = false;
      stepActor(cinfy, dt);
      const walkers = [player, ...livePlayers()];
      stepVisitors(dt, [...walkers, ...G.folk]);
      stepFolk(dt, walkers);
      standApart(dt);
      stepTown(dt, walkers);
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
      if (door?.game === "works" && door.phase !== "walking") player.alpha = clamp((player.y - THRESHOLD) / 5, 0, 1);
      // Out once at the Works' stand, or up from the stump.
      const out = door?.game === "works" ? player.path.length === 0 : player.seat?.at !== "table";
      if (door?.phase === "out" && out) doorTo(null);
      // Sitting down at the stump is sitting down to play.
      if (awake() && door === null && player.seat?.at === "table") through("table");
    },

    draw: () => drawPicture(pic),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px, pic.people());
    },

    tap(x, y, finger) {
      touched();
      return touch.tap(x, y, finger);
    },
    point: touch.point,
    act() {
      if (G.panel && isGame(G.panel)) hooks.go({ to: "game", game: G.panel });
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
    cancel: () => undefined,

    cameBack(id) {
      doorTo({ game: id, phase: "out" });
      if (id === "table") {
        lightTable(false);
        return;
      }
      // Out of the dark of the doorway and back to where they stood.
      putAt(place("works").stand.x, THRESHOLD);
      player.dir = 0;
      walkAlong(player, [{ ...place("works").stand }]);
    },

    wayOut(to) {
      halt();
      closePanel();
      closeCard();
      // Out through the gate and up the trail beyond it; for anywhere else, night falls where the member stands.
      return to === "camp" ? [...wayTo(player, { x: 256, y: 100 }), { x: 256, y: 84 }] : [];
    },
    // Night falls from about where the gate's stand is.
    nightFrom: 46,
    putAway: () => undefined,
    putOn(_to, from) {
      if (from === "camp") cameFromCamp();
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

    handles: townHandles({
      player,
      cinfy,
      visit,
      halt,
      putAt,
      walk: (x, y) => {
        touch.walk(x, y);
      },
      snap: () => {
        stage.snap();
      },
      everyone,
    }),
  };
  return town;
}
