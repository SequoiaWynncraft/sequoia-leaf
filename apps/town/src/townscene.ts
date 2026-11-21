/**
 * The town as a scene: who is here, what a touch does, how the member gets about and into the
 * places, and what is kept between visits. `main.ts` drives it through `Scene` and knows nothing
 * else about it.
 */

import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { bake, type Body, type Look, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, dist, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import { face, footfall, hop, makeActor, release, say, sit, stepActor, stepMates, walkTo } from "./actors.ts";
import { GREETS, KEEPER } from "./cast.ts";
import { drawTown, drawWords, show, sizeBuffers, type TownArt } from "./draw.ts";
import { after, beginEvents, stepEvents } from "./events.ts";
import { ring, updateFx } from "./fx.ts";
import { type Actor, changed, G, hooks, type PanelId, watch } from "./game.ts";
import { type GameId, isGame, worksAway } from "./games.ts";
import { paintBackdrop, paintGround, paintNear } from "./ground.ts";
import { guild } from "./guild.ts";
import { load, store } from "./keep.ts";
import { compose, read } from "./letter.ts";
import { dayOf } from "./save.ts";
import type { Sprites } from "./sprites.ts";
import type { Hover, Scene, Stage, Steer } from "./stage.ts";
import {
  buildTown,
  crabAt,
  crabs,
  lightTable,
  openDoor,
  propAt,
  stepTown,
  table,
  tapCrab,
  tapSky,
  tapString,
  tapWater,
  twinkleAll,
} from "./town.ts";
import { closeCard, closePanel, dismissArrival, initUI, openPanel, refreshFace, showArrival, showCard } from "./ui.ts";
import { footBlocked, H, hedgeY, nearestFree, place, type PlaceId, PLACES, pondD, SEATS, SPOTS, W } from "./world.ts";

/** Where the view closes in when the member goes into each game, and where they stand to go in. */
const DOORWAY: Readonly<Record<GameId, Pt>> = {
  works: { x: 373, y: 104 },
  table: { x: table.x, y: table.y - 19 },
};
/** The Works' threshold: the member fades into the dark between its stand and here. */
const THRESHOLD = 121;
const STROLL = 64;
const STEP_IN = 15;

const HOW_MANY = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] as const;

const bodyOf = (look: Look): Body => bake(paintSkin(look));

export interface Town extends Scene {
  /** Begins the visit: the member walks in through the gate, to a letter if there is one to read. */
  arrive(): void;
  /** The town's own handles for looking at it from outside. */
  readonly handles: {
    enter(): void;
    open(id: PanelId): void;
    close(): void;
    visit(id: PlaceId): void;
    inside(id: GameId): void;
    tp(x: number, y: number): void;
    tap(x: number, y: number): void;
    who(): { name: string; x: number; y: number; doing: string }[];
    me(): Pt;
    lost(): Pt;
    kept(): unknown;
  };
}

export function makeTown(sprites: Sprites, stage: Stage): Town {
  // ---------- what was kept from last time ----------

  const kept = load();
  G.owned = new Set(kept.owned);
  G.wearing = new Set(kept.wearing);
  G.claimed = new Set(kept.claimed);
  G.sightings = kept.sightings;
  G.lostCrab = guild.lostCrab();

  function remember(): void {
    kept.owned = [...G.owned];
    kept.wearing = [...G.wearing].filter((id) => G.owned.has(id));
    kept.claimed = [...G.claimed];
    kept.sightings = G.sightings;
    // Time spent in town is not time away.
    if (G.home) kept.lastSeen = Date.now();
    store(kept);
  }
  watch(remember);
  window.setInterval(() => {
    if (G.home && !document.hidden) remember();
  }, 20000);
  window.addEventListener("pagehide", () => {
    if (G.home) remember();
  });
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
  const art: TownArt = { sprites, ground, near: paintNear(), sky: paintBackdrop() };

  // ---------- who is here ----------

  const me = guild.me();
  const player = makeActor(me, bodyOf(me.look), 256, 85, true);
  player.alpha = 0;
  G.player = player;
  const keeper = guild.keeper();
  const cinfy = makeActor(keeper, bodyOf(keeper.look), 104, 113);
  cinfy.mode = "led";
  G.cinfy = cinfy;
  G.mates = guild.roster().map((m, i) => {
    const a = makeActor(m, bodyOf(m.look), 256, 216);
    // The evening is already under way: three by the fire, the rest about their errands.
    const seat = [SEATS[0], SEATS[3], SEATS[4]][i];
    const spot = SPOTS[(i * 5 + 2) % SPOTS.length];
    if (seat) {
      sit(a, seat);
      a.x = seat.x;
      a.y = seat.y;
      a.sat = -9;
      a.doing = "fire";
      a.wait = 12 + i * 7;
    } else if (spot) {
      spot.taken = true;
      a.spot = spot;
      a.x = spot.x;
      a.y = spot.y;
      a.dir = spot.dir;
      a.doing = spot.errand;
      a.wait = 3 + i * 1.7;
    }
    a.mode = "busy";
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

  initUI(sprites);

  // ---------- going places ----------

  /** A place the member is walking to, to be opened on arrival. */
  let pending: PlaceId | null = null;
  let throughGate = false;
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

  function personAt(wx: number, wy: number): Actor | null {
    let best: Actor | null = null;
    for (const a of [...G.mates, player, cinfy]) {
      if (a.away || a.alpha < 0.5) continue;
      const at = a.seat ?? a;
      if (Math.abs(wx - at.x) > 7 || wy < at.y - 23 || wy > at.y + 3) continue;
      if (!best || at.y > (best.seat ?? best).y) best = a;
    }
    return best;
  }

  /** What is under a point, as the box to put corners round; nothing for bare ground. */
  function under(wx: number, wy: number): (Hover & { who: Actor | null }) | null {
    const who = personAt(wx, wy);
    if (who) {
      const at = who.seat ?? who;
      return { box: { x: at.x - 6, y: at.y - 21, w: 12, h: 22 }, tip: null, who };
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
      hop(who);
      if (who.you) {
        say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
        return false;
      }
      if (who === cinfy) say(who, pick(KEEPER.taps, Math.random()));
      else {
        if (!who.seat) face(who, player.x, player.y);
        who.hold = 2.6;
        say(who, pick(GREETS, Math.random()), 2);
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
    let { dx, dy } = steer;
    if (dx === 0 && dy === 0 && steer.toward && dist(steer.toward.x, steer.toward.y, player.x, player.y) > 5) {
      dx = steer.toward.x - player.x;
      dy = steer.toward.y - player.y;
    }
    if (dx === 0 && dy === 0) {
      pushing = 0;
      return;
    }
    if (player.seat || player.path.length > 0 || pending || going) halt();
    const len = Math.hypot(dx, dy);
    const go = player.speed * dt;
    const before = player.walked;
    const nx = player.x + (dx / len) * go;
    const ny = player.y + (dy / len) * go;
    let moved = 0;
    if (!footBlocked(nx, player.y)) {
      moved += Math.abs(nx - player.x);
      player.x = nx;
    }
    if (!footBlocked(player.x, ny)) {
      moved += Math.abs(ny - player.y);
      player.y = ny;
    }
    player.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
    if (moved > 0) {
      player.walked += moved;
      player.moving = true;
      footfall(player, before);
    }
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

  const awake = (): boolean => G.home && !going?.through;

  return {
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
      stepMates(dt);
      stepTown(dt);
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
      const prompted = near !== null && G.panel !== near && awake();
      if (near && prompted) show.prompt = place(near);
      show.promptT = clamp(show.promptT + (prompted ? dt : -dt) * 5, 0, 1);

      // Stepping into the gateway is asking about the camp beyond it.
      if (awake() && player.y < 92 && !throughGate) {
        throughGate = true;
        openPanel("camp");
      } else if (player.y > 104) throughGate = false;
    },

    draw: () => drawTown(art),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px);
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
      if (show.prompt && show.promptT > 0.4) {
        openPanel(show.prompt.id);
        player.dir = show.prompt.face;
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

    arrive() {
      const now = Date.now();
      const away = guild.away(kept.lastSeen, now);
      const letter = compose(kept, now, away, [worksAway(away.hours, away.first)]);
      after(0.35, () => {
        walkTo(player, { x: 256, y: 152 }, () => {
          player.dir = 0;
        });
      });
      const begin = (): void => {
        Object.assign(kept, read(kept, Date.now()));
        G.home = true;
        remember();
        beginEvents();
        twinkleAll();
        const about = G.mates.filter((a) => !a.away).length;
        const count = HOW_MANY[about] ?? String(about);
        hooks.feed(
          letter.show ? `You are home. ${count} guild-mates are about.` : "Back again. The fire kept your seat.",
          "leaf",
        );
        // Whoever is nearest looks up and says so.
        const nearest = G.mates
          .filter((a) => !a.away)
          .toSorted((a, b) => dist(a.x, a.y, player.x, player.y) - dist(b.x, b.y, player.x, player.y))
          .slice(0, 2);
        nearest.forEach((a, i) => {
          after(0.5 + i * 0.6, () => {
            if (!a.seat && !a.moving) face(a, player.x, player.y);
            hop(a);
            say(a, i === 0 ? "welcome back!" : "you're here!", 2.4);
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
        return G.mates.map((a) => ({ name: a.who.name, x: Math.round(a.x), y: Math.round(a.y), doing: a.doing }));
      },
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
}
