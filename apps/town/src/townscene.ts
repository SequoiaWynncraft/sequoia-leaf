/**
 * The town as a scene: who is here, what a touch does, how the member gets about and into the
 * places, and what is kept between visits. `main.ts` drives it through `Scene` and knows nothing
 * else about it.
 */

import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { bake, type Body, type Look, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, dist, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import {
  face,
  headOf,
  hop,
  makeActor,
  makeFolk,
  placeFolk,
  pushOf,
  release,
  rouse,
  say,
  shove,
  sit,
  stepActor,
  stepFolk,
  walkTo,
} from "./actors.ts";
import type { CampArt } from "./campart.ts";
import { drawPicture, drawWords, type Picture, show, sizeBuffers } from "./draw.ts";
import { beginEvents, stepEvents } from "./events.ts";
import { flights, stepFlights } from "./flights.ts";
import { FOLK, folk, KEEPER } from "./folk.ts";
import { initFolkArt } from "./folkart.ts";
import { ring, updateFx } from "./fx.ts";
import { type Actor, after, changed, G, hooks, type PanelId } from "./game.ts";
import { type GameId, isGame, worksWaiting } from "./games.ts";
import { GROUND, NEAR, paintBackdrop, paintGround, paintNear, SKYLINE } from "./ground.ts";
import { guild } from "./guild.ts";
import { closeCard, closePanel, refreshFace, setFace, setHammer, showCard } from "./hud.ts";
import { compose, read } from "./letter.ts";
import { BOX_FULL, post, roomInBox } from "./mail.ts";
import { inTownLine } from "./news.ts";
import { camp, kept, remember } from "./record.ts";
import { dayOf } from "./save.ts";
import type { Sprites } from "./sprites.ts";
import type { Hover, Scene, Stage, Steer } from "./stage.ts";
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
  propAt,
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
import { H, hedgeY, nearestFree, type Place, place, type PlaceId, PLACES, pondD, SEATS, W } from "./world.ts";

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

/** The member's face in the corner opens what the town knows of them, and shuts it again. */
function openProfile(): void {
  if (G.panel === "profile") closePanel();
  else openPanel("profile");
}

export interface Town extends Scene {
  /** Begins the visit: the member walks in through the gate, to a letter if there is one to read. */
  arrive(): void;
  /** The member is back from a camp: they walk in through the gate, and the town's own buttons are put back. */
  cameFromCamp(): void;
  /** The town's painted sky and near ferns, which a camp at the same dusk shares. */
  readonly backdrop: { sky: HTMLCanvasElement; near: HTMLCanvasElement };
  /** How the stage is told the way to the camp, once there is one. */
  toCamp: (() => void) | null;
  /** The town's own handles for looking at it from outside. */
  readonly handles: {
    enter(): void;
    open(id: PanelId): void;
    close(): void;
    visit(id: PlaceId): void;
    inside(id: GameId): void;
    tp(x: number, y: number): void;
    tap(x: number, y: number): void;
    /** The town's own, where each is and what it is doing. */
    who(): { name: string; x: number; y: number; doing: string }[];
    /** Real members in town just now, visiting or dozing, and where each is. */
    visitors(): { name: string; x: number; y: number; dozing: boolean }[];
    me(): Pt;
    lost(): Pt;
    kept(): unknown;
  };
}

export function makeTown(sprites: Sprites, campArt: CampArt, stage: Stage): Town {
  G.lostCrab = guild.lostCrab();
  hooks.looted = (): boolean => {
    const today = dayOf(Date.now());
    if (kept.chest === today) return true;
    kept.chest = today;
    remember();
    return false;
  };

  // ---------- the place itself ----------

  const ground = paintGround();
  buildTown(sprites, must(ground.getContext("2d"), "ground"));
  const standing = crabsStanding();
  const pic: Picture = {
    sprites,
    sky: paintBackdrop(),
    skyAt: { x: SKYLINE.worldX, y: SKYLINE.worldY - SKYLINE.horizon },
    ground,
    groundAt: { x: GROUND.x, y: GROUND.y },
    near: paintNear(),
    nearAt: { x: NEAR.x, y: NEAR.y },
    props,
    others: () => (flights.length > 0 ? [...standing, ...flights] : standing),
    people: () => [...G.folk, ...G.visitors, player, cinfy],
    lights: allLights,
    beyond: () => undefined,
    under: drawWater,
    over: drawStrings,
    glows: drawGlows,
  };

  // ---------- who is here ----------

  const me = guild.me();
  const player = makeActor(me, bodyOf(me.look), 256, 85, true);
  player.alpha = 0;
  G.player = player;
  // The town's own: drawn as themselves, each where its evening finds it.
  initFolkArt(campArt);
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

  // ---------- going places ----------

  /** A place the member is walking to, to be opened on arrival. */
  let pending: PlaceId | null = null;
  /** A game the member is on the way into: still walking to its door, or going through it. */
  let going: { id: GameId; through: boolean } | null = null;
  let pushing = 0;
  let seatWas = player.seat;

  function halt(): void {
    release(player);
    player.path = [];
    player.arrive = null;
    pending = null;
    going = null;
    show.dest = null;
  }

  function visit(id: PlaceId, now = false): void {
    const pl = place(id);
    const there =
      dist(player.x, player.y, pl.stand.x, pl.stand.y) < 26 || (id === "fire" && player.seat?.at === "fire");
    if (now || there) openPanel(id);
    if (there || (id === "table" && player.seat?.at === "table")) {
      if (!player.seat) player.dir = pl.face;
      return;
    }
    halt();
    pending = now ? null : id;
    if (!now) show.dest = pl.stand;
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
      show.dest = null;
      if (pending === id) {
        pending = null;
        openPanel(id);
      }
    });
  }
  hooks.visit = visit;

  /** Through the door: the Works' doors part and the member steps in; at the stump the lantern burns up. */
  function through(id: GameId): void {
    going = { id, through: true };
    pending = null;
    show.dest = null;
    closePanel();
    closeCard();
    if (id === "works") {
      G.inDoor = true;
      openDoor(true);
      player.dir = 3;
      player.speed = STEP_IN;
      player.path = [{ x: player.x, y: THRESHOLD }];
      player.arrive = null;
    } else lightTable(true);
    stage.goInside(id, DOORWAY[id]);
  }

  /** Walks the member to a game's door and on through it. */
  function goIn(id: GameId): void {
    if (!G.home || going?.through) return;
    if (id === "table") {
      if (player.seat?.at === "table") {
        through(id);
        return;
      }
      const seat =
        SEATS.find((s) => s.at === "table" && !s.taken && s.yours) ?? SEATS.find((s) => s.at === "table" && !s.taken);
      if (seat) {
        halt();
        going = { id, through: false };
        seat.taken = true;
        player.goal = seat;
        walkTo(player, seat.from, () => {
          sit(player, seat);
          seatWas = seat;
          through(id);
        });
        return;
      }
    }
    const pl = place(id);
    halt();
    going = { id, through: false };
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
      through(id);
    });
  }
  hooks.goIn = goIn;

  /** Out through the gate and down the trail to the member's own camp. */
  let leaving = false;
  /** The member has come in through the gate since arriving. */
  let entered = false;
  function toCamp(): void {
    if (!G.home || going || leaving || !town.toCamp) return;
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
  }
  hooks.toCamp = toCamp;

  function personAt(wx: number, wy: number): Actor | null {
    let best: Actor | null = null;
    for (const a of [...G.folk, ...G.visitors, player, cinfy]) {
      if (a.away || a.alpha < 0.5) continue;
      const at = a.seat ?? a;
      if (Math.abs(wx - at.x) > 7 || wy < at.y - headOf(a) - 2 || wy > at.y + 3 - a.lift) continue;
      if (!best || at.y > (best.seat ?? best).y) best = a;
    }
    return best;
  }

  /** What is under a point, as the box to put corners round; nothing for bare ground. */
  function under(wx: number, wy: number): (Hover & { who: Actor | null }) | null {
    const who = personAt(wx, wy);
    if (who) {
      const at = who.seat ?? who;
      const tall = headOf(who);
      return { box: { x: at.x - 6, y: at.y - tall, w: 12, h: tall + 1 - who.lift }, tip: null, who };
    }
    const crab = crabAt(wx, wy);
    if (crab) return { box: { x: crab.x - 6, y: crab.y - 8, w: 12, h: 9 }, tip: null, who: null };
    const prop = propAt(wx, wy);
    if (!prop?.hit || prop.kind === "trunk") return null;
    return { box: prop.hit, tip: prop.tip, who: null };
  }

  /** A touch somewhere in the town. Says whether it was bare ground (so a drag may steer). */
  function tapWorld(wx: number, wy: number): boolean {
    closeCard();
    const who = personAt(wx, wy);
    if (who) {
      sfx.pop();
      // Somebody dozing sleeps on; their card says who they are.
      if (who.dozing !== null) {
        showCard(who);
        return false;
      }
      hop(who);
      if (who.you) {
        say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
        return false;
      }
      // A member really here: they look round, and their card says who they are.
      if (isVisitor(who)) {
        if (!who.seat && !who.moving) face(who, player.x, player.y);
        showCard(who);
        return false;
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
      return false;
    }
    const crab = crabAt(wx, wy);
    if (crab) {
      tapCrab(crab);
      return false;
    }
    if (tapString(wx, wy)) return false;
    const prop = propAt(wx, wy);
    if (prop?.tap) {
      prop.tap(prop, wx, wy);
      return false;
    }
    if (wy < hedgeY(wx)) {
      tapSky(wx, wy);
      return false;
    }
    if (pondD(wx, wy) < 1) {
      tapWater(wx, wy);
      visit("pond");
      return false;
    }
    halt();
    if (G.panel) closePanel();
    const to = nearestFree(wx, wy);
    show.dest = to;
    ring(to.x, to.y, GOLD[2], 6);
    sfx.tap();
    walkTo(player, to, () => {
      show.dest = null;
    });
    return true;
  }

  /** Walking by hand: the keys, or a finger held down and dragged. */
  function steerBy(dt: number, steer: Steer): void {
    const push = pushOf(player, steer);
    if (!push) {
      pushing = 0;
      return;
    }
    const { dx, dy } = push;
    if (player.seat || player.path.length > 0 || pending || going) halt();
    shove(player, dt, dx, dy);
    // Walking on into a game's doorway, or up against its table, is going in.
    const up = dy < 0 && Math.abs(dy) >= Math.abs(dx);
    const door: GameId | null = !up
      ? null
      : Math.abs(player.x - place("works").stand.x) < 13 && player.y < 126
        ? "works"
        : Math.abs(player.x - table.x) < 22 && player.y > table.y && player.y < table.y + 9
          ? "table"
          : null;
    pushing = door ? pushing + dt : 0;
    if (door && pushing > 0.32) {
      pushing = 0;
      goIn(door);
    }
  }

  /** The place the member is standing at, if any: the prompt hangs by it. */
  function nearPlace(): PlaceId | null {
    for (const pl of PLACES) {
      const d = dist(player.x, player.y, pl.stand.x, pl.stand.y);
      if (d < 22) return pl.id;
      if (pl.id === "pond" && pondD(player.x, player.y) < 13) return pl.id;
      if (pl.id === "fire" && (player.seat?.at === "fire" || dist(player.x, player.y, 256, 214) < 30)) return pl.id;
      if (pl.id === "table" && player.seat?.at === "table") return pl.id;
    }
    return null;
  }

  const awake = (): boolean => G.home && !going?.through && !leaving && G.dark < 0.35;
  /** The place the prompt is hanging by. */
  let prompted: Place | null = null;

  const town: Town = {
    backdrop: { sky: pic.sky, near: pic.near },
    toCamp: null,
    bounds: { w: W, top: -72, bottom: H + 24 },

    resize(w, h) {
      sizeBuffers(w, h);
    },

    focus() {
      if (going?.through) return DOORWAY[going.id];
      const at = player.seat ?? player;
      return { x: at.x, y: at.y - 12 };
    },

    step(dt, steer) {
      G.t += dt;
      stepActor(player, dt);
      if (awake() && steer) steerBy(dt, steer);
      stepActor(cinfy, dt);
      stepFolk(dt);
      stepVisitors(dt);
      stepTown(dt);
      stepFlights(dt);
      stepEvents();
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

      const near = G.home ? nearPlace() : null;
      G.near = near;
      const on = near !== null && G.panel !== near && awake();
      if (near && on) {
        prompted = place(near);
        show.prompt = prompted;
      }
      show.promptT = clamp(show.promptT + (on ? dt : -dt) * 5, 0, 1);

      // Stepping on into the gateway is setting off for the camp beyond it; but only once the
      // member has come in through it, or a visit with no letter would send them straight back out.
      if (player.y > 100) entered = true;
      if (awake() && entered && player.y < 92) toCamp();
    },

    draw: () => drawPicture(pic),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px, pic.people());
    },

    tap(x, y, finger) {
      show.touch = finger;
      return awake() ? tapWorld(x, y) : false;
    },

    point(at) {
      const h = at && awake() ? under(at.x, at.y) : null;
      show.hover = h ? h.box : null;
      show.pointed = h ? h.who : null;
      return h;
    },

    act() {
      if (!awake()) return;
      if (G.panel && isGame(G.panel)) {
        goIn(G.panel);
        return;
      }
      if (prompted && show.promptT > 0.4) {
        openPanel(prompted.id);
        player.dir = prompted.face;
        return;
      }
      if (player.seat) {
        release(player);
        return;
      }
      hop(player);
      sfx.tap();
    },

    back() {
      if (G.panel) closePanel();
      else closeCard();
    },

    key: () => false,
    drag: () => undefined,
    release: () => undefined,

    awake,

    cameBack(id) {
      going = null;
      pushing = 0;
      if (id === "table") {
        lightTable(false);
        return;
      }
      // Out of the dark of the doorway and back to where they stood.
      player.x = place("works").stand.x;
      player.y = THRESHOLD;
      player.dir = 0;
      player.path = [{ ...place("works").stand }];
      player.arrive = null;
    },

    cameFromCamp() {
      G.where = "town";
      leaving = false;
      going = null;
      pending = null;
      pushing = 0;
      show.prompt = null;
      show.promptT = 0;
      show.hover = null;
      show.pointed = null;
      show.dest = null;
      release(player);
      player.x = 256;
      player.y = 84;
      entered = false;
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
      const now = Date.now();
      const away = guild.away(kept.lastSeen, now);
      const mail = guild.mail(kept.lastSeen, now);
      const letter = compose(kept, now, away, [worksWaiting()]);
      after(0.35, () => {
        walkTo(player, { x: 256, y: 152 }, () => {
          player.dir = 0;
        });
      });
      const begin = (): void => {
        Object.assign(kept, read(kept, Date.now()));
        // What the town's own left while the member was away is in the camp's mailbox, not in this letter;
        // what does not fit beside the presents still inside it is not left.
        let turnedAway = false;
        for (const l of mail) {
          if (roomInBox(camp.letters)) post(camp.letters, l);
          else if (!camp.letters.some((m) => m.id === l.id)) turnedAway = true;
        }
        G.home = true;
        remember();
        beginEvents();
        twinkleAll();
        // How many real players are in the game, once the guild has said; then the feed says so.
        const greet = letter.show ? "You are home." : "Back again.";
        let tries = 0;
        const tellHowMany = (): void => {
          if (!guild.heard() && tries++ < 12) {
            after(0.5, tellHowMany);
            return;
          }
          hooks.feed(`${greet} ${inTownLine(guild.visitors().length)}`, "leaf");
          if (turnedAway) hooks.feed(BOX_FULL, "coral");
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
      open: openPanel,
      close: closePanel,
      visit(id) {
        visit(id, true);
      },
      inside: goIn,
      tp(x, y) {
        halt();
        player.x = x;
        player.y = y;
        stage.snap();
      },
      tap(x, y) {
        tapWorld(x, y);
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
      me() {
        return { x: Math.round(player.x), y: Math.round(player.y) };
      },
      lost() {
        const c = crabs.find((k) => k.lost);
        return c ? { x: Math.round(c.x), y: Math.round(c.y) } : { x: 0, y: 0 };
      },
      kept() {
        remember();
        return { ...kept };
      },
    },
  };
  return town;
}
