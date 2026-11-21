/**
 * What the things in a camp do: what happens when each is touched, the parts of them that never
 * keep still (a flame, a string of bulbs, a fountain's water, Moth), and the light they give.
 */

import { BARK, CREAM, EARTH, GOLD, GREEN, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { noise, sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, lerp, pick } from "@sequoia-leaf/kit/util.ts";

import { onScreen } from "./actors.ts";
import type { Placed } from "./camp.ts";
import { type CampArt, HUES, pictureOf, SHELF_SLOTS, TUBES, WICKS } from "./campart.ts";
import { csfx } from "./campsfx.ts";
import { bit, burst, float, flutter, puff, ring, sparkle } from "./fx.ts";
import { changed, G, hooks } from "./game.ts";
import { flame, type Light, type Prop } from "./props.ts";
import { footprint, type Thing } from "./things.ts";

/** A thing as it stands in a camp: its record, its picture, its light, and a little state of its own. */
export interface Live {
  placed: Placed;
  thing: Thing;
  prop: Prop;
  light: Light | null;
  /** When the last thing of its own began (a tune, a ripple, a spin), by the camp's clock. */
  at: number;
  /** How often it has been touched this visit. */
  taps: number;
  /** When to put its picture back as it was (a worm gone in, a wren come back); 0 for never. */
  backAt: number;
  /** Drawn after dusk has fallen, for what shines. */
  glow: ((g: Ctx, sx: number, sy: number, spark: HTMLCanvasElement) => void) | null;
}

/** What a thing asks of the camp it stands in. */
export interface TouchWorld {
  art: CampArt;
  /** Whether this is the member's own camp: only there is anything kept. */
  mine: boolean;
  /** Sit down on a seat, nearest the point touched. */
  sit: (live: Live, wx: number, wy: number) => void;
  /** Walk up to one of the camp's own places and open it. */
  open: (what: "cabin" | "mailbox" | "signpost") => void;
  /** Whether there is mail waiting. */
  mail: () => boolean;
  /** The trophies to show on the shelf. */
  trophies: () => readonly string[];
  /** The top of the far hedge at a column, for things that send something into the sky. */
  hedge: (x: number) => number;
}

// ---------- light ----------

/** Where each thing's light is, from its foot. */
const GLOW_AT: Readonly<Record<string, readonly [number, number]>> = {
  cabin: [-17, -20],
  "fire-ring": [0, -6],
  mailbox: [1, -9],
  "lantern-post": [8, -26],
  "paper-lantern": [1, -11],
  "candle-stump": [0, -12],
  "firefly-lamp": [0, -11],
  brazier: [0, -8],
  glowcap: [0, -8],
  "fairy-lights": [0, -14],
  "moth-lantern": [3, -13],
  "glass-lantern": [0, -15],
  "cook-pot": [0, -2],
  "fox-statue": [0, -14],
  fountain: [0, -10],
  "sun-banner": [0, -22],
};

/** Things whose light is put out and lit again by a touch. */
const TOGGLES = new Set(["lantern-post", "candle-stump"]);
const isLit = (l: Live): boolean => !TOGGLES.has(l.thing.id) || l.placed.s === 0;

export function lightOf(l: Live): Light | null {
  if (l.thing.light <= 0) return null;
  const [dx, dy] = GLOW_AT[l.thing.id] ?? [0, -8];
  const flip = l.thing.turns === "flip" && l.placed.t % 2 === 1 ? -1 : 1;
  return {
    x: l.prop.x + dx * flip,
    y: l.prop.y + dy,
    r: l.thing.light,
    power: isLit(l) ? 0.9 : 0,
    boost: 0,
    phase: (l.placed.x * 7 + l.placed.y * 3) % 6,
  };
}

// ---------- pictures ----------

/** Shows a thing in the state it is in now. */
function repaint(l: Live, w: TouchWorld): void {
  const s = pictureOf(w.art, l.thing.id, l.placed.t, l.placed.s);
  if (!s) return;
  l.prop.sprite = s;
  if (l.prop.hit) l.prop.hit = { x: l.prop.x - s.ax, y: l.prop.y - s.ay, w: s.c.width, h: s.c.height };
}

/** Puts a thing in another state for a moment: something looks out, and goes back in. */
function forAWhile(l: Live, w: TouchWorld, state: number, secs: number): void {
  l.placed.s = state;
  l.backAt = G.t + secs;
  repaint(l, w);
}

const nudge = (l: Live): void => {
  l.prop.bumpAt = G.t;
};
const top = (l: Live): number => l.prop.y - (l.prop.sprite ? l.prop.sprite.c.height : 8);
const kept = (w: TouchWorld): void => {
  if (w.mine) changed();
};

// ---------- what touching each thing does ----------

const STARS = ["The Lost Crab", "Greg Major", "The Big Gnome", "Worm, probably", "The Fox's Antlers", "Cinfy's Coin"];
const STALL_NEWS = ["Open for business.", "Nobody is buying.", "A crab is browsing.", "Sold: nothing. Proud anyway."];
const BARREL_NEWS = ["Something looked at you.", "Just a barrel. Probably.", "The lid moved. You saw it."];
const CRAB_QUIPS = ["It was in the barrel!", "Gone again. Classic.", "It waved. Rudely."];

type Touch = (l: Live, w: TouchWorld, wx: number, wy: number) => void;

const leafy: Touch = (l) => {
  nudge(l);
  flutter(l.prop.x, top(l) + 4, 6, [GREEN[3], GREEN[4], GREEN[2]], 6, 24);
  sfx.rustle();
};
const petals: Touch = (l) => {
  nudge(l);
  flutter(l.prop.x, top(l) + 2, 5, [SKY[4], CREAM, GOLD[1]], 4, 28);
  sfx.pluck(Math.floor(l.prop.x / 23) % 10);
};
const knock: Touch = (l) => {
  nudge(l);
  sfx.knock();
  puff(l.prop.x, l.prop.y, 3, l.thing.id.includes("stone") || l.thing.id === "tiny-cairn" ? STONE[2] : EARTH[2]);
};
const seat: Touch = (l, w, wx, wy) => {
  nudge(l);
  w.sit(l, wx, wy);
};
const flare: Touch = (l) => {
  if (l.light) l.light.boost = 1;
  sfx.whoosh();
  burst(l.prop.x, l.prop.y - 9, 14, [GOLD[1], SKY[5], CREAM], 42);
};
const colour: Touch = (l, w) => {
  l.placed.s = (l.placed.s + 1) % HUES.length;
  repaint(l, w);
  nudge(l);
  sfx.pluck(3 + l.placed.s);
  const hue = HUES[l.placed.s % HUES.length];
  if (hue) burst(l.prop.x, top(l) + 6, 6, [hue[0], hue[1]], 22);
  kept(w);
};
const ripple: Touch = (l) => {
  l.at = G.t;
  sfx.twinkle();
};
const shine: Touch = (l) => {
  nudge(l);
  if (l.light) l.light.boost = 1;
  sparkle(l.prop.x, top(l) + 4, 12, 6);
  sfx.twinkle();
};

const TOUCH: Readonly<Record<string, Touch>> = {
  cabin: (l, w) => {
    nudge(l);
    sfx.knock();
    w.open("cabin");
  },
  "fire-ring": flare,
  mailbox: (l, w) => {
    nudge(l);
    w.open("mailbox");
  },
  signpost: (l, w) => {
    nudge(l);
    sfx.pluck(5);
    w.open("signpost");
  },
  "trophy-shelf": (l, w) => {
    nudge(l);
    noise(0.12, 2400, { vol: 0.07, q: 4 });
    const n = w.trophies().length;
    float(l.prop.x, top(l) - 2, n === 0 ? "Empty, for now." : `${n} ${n === 1 ? "trophy" : "trophies"}`, GOLD[2], 1.8);
    if (n > 0) sparkle(l.prop.x, top(l) + 8, 8, 9);
  },

  "log-seat": seat,
  stump: seat,
  bench: seat,
  cushion: seat,
  "crab-throne": seat,
  hammock: (l, w, wx, wy) => {
    l.at = G.t;
    csfx.creak();
    w.sit(l, wx, wy);
  },
  rocker: (l, w, wx, wy) => {
    l.at = G.t;
    csfx.creak();
    w.sit(l, wx, wy);
  },
  picnic: (l, w, wx, wy) => {
    nudge(l);
    noise(0.06, 3400, { vol: 0.08, q: 5 });
    w.sit(l, wx, wy);
  },

  "lantern-post": (l, w) => {
    nudge(l);
    l.placed.s = l.placed.s === 0 ? 1 : 0;
    if (l.light) {
      l.light.power = isLit(l) ? 0.9 : 0;
      l.light.boost = isLit(l) ? 1 : 0;
    }
    sfx.pluck(isLit(l) ? 7 : 2);
    if (isLit(l) && l.light) burst(l.light.x, l.light.y, 5, [GOLD[2], CREAM], 24);
    kept(w);
  },
  "candle-stump": (l, w) => {
    nudge(l);
    l.placed.s = l.placed.s === 0 ? 1 : 0;
    if (l.light) l.light.power = isLit(l) ? 0.9 : 0;
    if (isLit(l)) sfx.pluck(8);
    else {
      noise(0.1, 2200, { vol: 0.05, slide: 0.4 });
      puff(l.prop.x, top(l), 3, STONE[2], 10);
    }
    kept(w);
  },
  "paper-lantern": colour,
  "glass-lantern": colour,
  "firefly-lamp": (l) => {
    nudge(l);
    sfx.twinkle();
    for (let i = 0; i < 5; i++)
      bit({
        x: l.prop.x + (Math.random() - 0.5) * 4,
        y: l.prop.y - 12,
        vx: (Math.random() - 0.5) * 22,
        vy: -8 - Math.random() * 14,
        ttl: 2.4 + Math.random() * 2,
        col: GOLD[2],
        glow: true,
        flutter: 2,
      });
  },
  brazier: flare,
  glowcap: (l) => {
    nudge(l);
    if (l.light) l.light.boost = 1;
    sfx.boing();
    for (let i = 0; i < 6; i++)
      bit({
        x: l.prop.x + (Math.random() - 0.5) * 8,
        y: l.prop.y - 8,
        vx: (Math.random() - 0.5) * 12,
        vy: -8 - Math.random() * 14,
        drag: 1.2,
        ttl: 1 + Math.random(),
        col: WATER[3],
        glow: true,
        flutter: 1.5,
      });
  },
  "fairy-lights": ripple,
  "moth-lantern": (l) => {
    l.at = G.t;
    tone(1500, 0.05, { vol: 0.03, type: "sine", slide: 1.4 });
    float(l.prop.x, top(l) - 2, "Moth.", CREAM, 1.2);
  },

  pennant: colour,
  "guild-banner": (l) => {
    nudge(l);
    sfx.pluck(6);
    if (l.taps % 3 === 0) float(l.prop.x, top(l) - 2, "glory to the grove", GOLD[2], 1.8);
  },
  "sun-banner": shine,
  bunting: ripple,
  windsock: (l) => {
    nudge(l);
    noise(0.3, 900, { vol: 0.06, slide: 2.2, q: 0.8 });
  },
  weathervane: (l, w) => {
    l.at = G.t;
    l.backAt = G.t + 1.1;
    csfx.spin();
    void w;
  },

  "flower-pot": petals,
  "flower-bed": petals,
  "potted-fern": leafy,
  sapling: leafy,
  "berry-bush": (l, w, wx, wy) => {
    leafy(l, w, wx, wy);
    bit({ x: l.prop.x + 3, y: l.prop.y - 6, vy: -10, pull: 90, ttl: 0.5, col: SKY[5], size: 2 });
  },
  toadstool: (l) => {
    l.prop.hops = true;
    nudge(l);
    sfx.boing();
    for (let i = 0; i < 7; i++)
      bit({
        x: l.prop.x + (Math.random() - 0.5) * 9,
        y: l.prop.y - 8,
        vx: (Math.random() - 0.5) * 14,
        vy: -10 - Math.random() * 18,
        drag: 1.2,
        ttl: 0.9 + Math.random() * 0.8,
        col: CREAM,
        flutter: 1.5,
      });
  },
  "fairy-ring": (l) => {
    sfx.twinkle();
    sparkle(l.prop.x, l.prop.y - 8, 14, 11);
    ring(l.prop.x, l.prop.y - 7, GOLD[2], 12, true);
  },
  sunflower: (l) => {
    nudge(l);
    sfx.pluck(4);
  },
  pumpkin: (l) => {
    nudge(l);
    sfx.knock();
  },
  "worm-pot": (l, w) => {
    forAWhile(l, w, 1, 1.6);
    sfx.pop();
    float(l.prop.x, top(l) - 2, "Worm.", "#e88fb4", 1.3);
  },

  picket: knock,
  "log-fence": knock,
  "stone-wall": knock,
  woodpile: knock,
  arch: (l) => {
    nudge(l);
    csfx.creak();
  },
  "stepping-stones": (l) => {
    tone(880 + (l.taps % 3) * 110, 0.05, { vol: 0.08, type: "sine" });
    puff(l.prop.x, l.prop.y - 3, 2, STONE[2], 4);
  },
  "plank-path": (l) => {
    tone(140, 0.08, { vol: 0.14, type: "sine", slide: 0.7 });
    puff(l.prop.x, l.prop.y - 3, 2, BARK[3], 4);
  },
  doormat: (l) => {
    sfx.clack();
    float(l.prop.x, l.prop.y - 10, "CLACK", SKY[5], 1.1);
  },

  well: (l) => {
    nudge(l);
    sfx.plop();
    tone(260, 0.2, { vol: 0.05, type: "sine", slide: 0.5, at: 0.35 });
    ring(l.prop.x, l.prop.y - 9, WATER[3], 6, true);
    if (l.taps % 2 === 1) float(l.prop.x, top(l) - 2, "It wishes you well.", WATER[3], 2);
  },
  telescope: (l, w) => {
    nudge(l);
    sfx.star();
    // A star goes over, in the bit of sky between the trees.
    const x0 = l.prop.x - 40 + Math.random() * 80;
    const y0 = w.hedge(x0) - 30 - Math.random() * 20;
    for (let i = 0; i < 14; i++)
      bit({
        x: x0 - i * 2.2,
        y: y0 - i * 1.1,
        vx: 70,
        vy: 34,
        ttl: 0.5 + i * 0.03,
        life: i * 0.012,
        col: i < 3 ? CREAM : GOLD[2],
        glow: true,
      });
    float(l.prop.x, top(l) - 2, STARS[l.taps % STARS.length] ?? "", GOLD[2], 2.2);
  },
  "my-stall": (l) => {
    nudge(l);
    sfx.ding();
    float(l.prop.x, top(l) - 2, STALL_NEWS[l.taps % STALL_NEWS.length] ?? "", CREAM, 2);
  },
  gnome: (l, w) => {
    l.prop.hops = true;
    nudge(l);
    l.placed.t = (l.placed.t + 1) % 2;
    repaint(l, w);
    sfx.pop();
    kept(w);
  },
  "gnome-fishing": (l) => {
    nudge(l);
    sfx.plop();
    float(l.prop.x, top(l) - 2, pick(["nothing. again.", "a boot.", "patience."], Math.random()), CREAM, 1.6);
  },
  "gnome-napping": (l) => {
    csfx.snore();
    float(l.prop.x + 4, top(l) - 1, "z z z", CREAM, 1.6);
  },
  "gnome-traveller": (l) => {
    l.prop.hops = true;
    nudge(l);
    sfx.pop();
    float(l.prop.x, top(l) - 2, "It is not leaving.", CREAM, 1.6);
  },
  "crab-statue": (l) => {
    nudge(l);
    sfx.clack();
  },
  barrel: (l, w) => {
    forAWhile(l, w, 1, 1.3);
    sfx.knock();
    // Every third look, it is the crab that is never at roll call. It runs.
    if (l.taps % 3 === 0) {
      G.sightings++;
      sfx.clack();
      float(l.prop.x, top(l) - 4, CRAB_QUIPS[G.sightings % CRAB_QUIPS.length] ?? "", SKY[5], 2.2);
      hooks.feed(`You spotted crab No. ${G.lostCrab} in a barrel. It got away.`, "coral");
      puff(l.prop.x, l.prop.y, 5, EARTH[2]);
      changed();
    } else float(l.prop.x, top(l) - 4, BARREL_NEWS[l.taps % BARREL_NEWS.length] ?? "", CREAM, 1.8);
  },
  "wind-chime": (l) => {
    l.at = G.t;
    for (let i = 0; i < 3; i++)
      window.setTimeout(() => {
        csfx.chime((l.taps + i * 2) % 5);
      }, i * 140);
  },
  "music-box": (l) => {
    l.at = G.t;
    csfx.tune();
  },
  "bird-bath": (l, w) => {
    nudge(l);
    sfx.plop();
    ring(l.prop.x, top(l) + 4, WATER[3], 5, true);
    if (l.placed.s === 0) {
      csfx.chirp();
      forAWhile(l, w, 1, 4);
      flutter(l.prop.x - 5, top(l), 3, [BARK[3], BARK[4]], 3, 40);
    }
  },
  "rug-woven": (l) => {
    noise(0.1, 800, { vol: 0.05, q: 0.7 });
    puff(l.prop.x, l.prop.y - 6, 3, GOLD[0], 5);
  },
  "rug-moss": (l) => {
    noise(0.1, 600, { vol: 0.05, q: 0.7 });
    flutter(l.prop.x, l.prop.y - 8, 3, [GREEN[4], GREEN[3]], 5, 12);
  },
  rock: (l) => {
    nudge(l);
    sfx.knock();
    float(l.prop.x, top(l) - 2, "Rock.", STONE[3], 1.2);
  },
  birdhouse: (l) => {
    nudge(l);
    csfx.chirp();
    float(l.prop.x + 4, top(l) + 2, "♪", GOLD[2], 1.2);
  },
  "cook-pot": (l) => {
    nudge(l);
    csfx.bubble();
    puff(l.prop.x, l.prop.y - 9, 5, CREAM, 14);
  },
  "fox-statue": shine,
  fountain: (l) => {
    l.at = G.t;
    sfx.plop();
    sparkle(l.prop.x, l.prop.y - 16, 8, 6);
  },

  pinecone: (l) => {
    nudge(l);
    tone(300, 0.05, { vol: 0.08, type: "sine", slide: 0.7 });
  },
  "painted-pebble": (l) => {
    nudge(l);
    tone(1200, 0.04, { vol: 0.07, type: "sine" });
  },
  "acorn-jar": (l) => {
    nudge(l);
    for (let i = 0; i < 4; i++) noise(0.03, 2800, { vol: 0.07, q: 6, at: i * 0.05 });
  },
  "tiny-cairn": (l, w) => {
    forAWhile(l, w, 1, 1.4);
    sfx.knock();
    puff(l.prop.x, l.prop.y, 3, STONE[2]);
  },
  "crab-drawing": (l) => {
    nudge(l);
    sfx.paper();
  },
};

/** A thing is touched: it does what it does, or at the least it shivers and shines. */
export function touch(l: Live, w: TouchWorld, wx: number, wy: number): void {
  l.taps++;
  const fn = TOUCH[l.thing.id];
  if (fn) {
    fn(l, w, wx, wy);
    return;
  }
  // A trophy: it catches the light, and says what it was for.
  nudge(l);
  sparkle(l.prop.x, top(l) + 2, 8, 5);
  sfx.pluck(8);
  float(l.prop.x, top(l) - 2, l.thing.name, GOLD[2], 1.8);
}

// ---------- each moment ----------

export function stepLive(l: Live, w: TouchWorld, dt: number): void {
  if (l.light) {
    l.light.boost = Math.max(0, l.light.boost - dt * 1.4);
    if (l.thing.id === "mailbox") l.light.power = w.mail() ? 0.75 + 0.2 * Math.sin(G.t * 3) : 0;
  }
  const id = l.thing.id;
  if (l.backAt > 0 && G.t >= l.backAt) {
    l.backAt = 0;
    if (id === "weathervane") l.placed.s = 0;
    else {
      l.placed.s = 0;
      if (id === "tiny-cairn" || id === "bird-bath") sfx.pop();
    }
    repaint(l, w);
  } else if (id === "weathervane" && l.backAt > 0) {
    const s = Math.floor((G.t - l.at) * 9) % 2;
    if (s !== l.placed.s) {
      l.placed.s = s;
      repaint(l, w);
    }
  }
  if (!onScreen(l.prop.x, l.prop.y, 30)) return;
  if (id === "fire-ring" || id === "brazier") {
    if (Math.random() < dt * (id === "fire-ring" ? 5 : 2.5))
      bit({
        x: l.prop.x + (Math.random() - 0.5) * 6,
        y: l.prop.y - 10,
        vx: (Math.random() - 0.5) * 10,
        vy: -18 - Math.random() * 20,
        ttl: 0.7 + Math.random() * 0.9,
        col: Math.random() < 0.5 ? GOLD[1] : SKY[5],
        glow: true,
        flutter: 1.2,
      });
    if (id === "fire-ring" && G.home && Math.random() < dt * 1.4) sfx.crackle();
  } else if (id === "cabin") {
    if (Math.random() < dt * 2)
      bit({
        x: l.prop.x - 22 + (Math.random() - 0.5) * 5,
        y: top(l) + 1,
        vx: 4 + Math.random() * 5,
        vy: -11 - Math.random() * 7,
        drag: 0.4,
        ttl: 2 + Math.random() * 1.6,
        col: Math.random() < 0.5 ? STONE[2] : STONE[1],
        size: 2,
      });
  } else if (id === "cook-pot") {
    if (Math.random() < dt * 1.5) puff(l.prop.x, l.prop.y - 9, 1, CREAM, 12);
  } else if (id === "music-box" && G.t - l.at < 1.6) {
    if (Math.random() < dt * 5) float(l.prop.x + (Math.random() - 0.5) * 10, top(l), "♪", GOLD[2], 1);
  } else if (id === "mailbox" && w.mail()) {
    if (Math.random() < dt * 1.6) sparkle(l.prop.x, top(l) + 2, 1, 4);
  }
}

// ---------- the parts that move ----------

const BULBS = [GOLD[2], SKY[5], CREAM, SKY[4]] as const;

/** A line slung between a thing's two poles, as points from its foot; it sags in the middle. */
function slung(l: Live, drop: number): { x: number; y: number }[] {
  const [w, d] = footprint(l.thing, l.placed.t);
  const out: { x: number; y: number }[] = [];
  const high = l.thing.id === "bunting" ? 12 : 17;
  if (w >= d) {
    const half = w * 4 - 2;
    for (let x = -half; x <= half; x++) {
      const k = (x + half) / (half * 2);
      out.push({ x, y: -high + Math.round(drop * 4 * k * (1 - k)) });
    }
  } else {
    const len = d * 8 - 8;
    for (let i = 0; i <= len; i++) {
      const k = i / len;
      out.push({ x: Math.round(Math.sin(k * Math.PI) * 2), y: -high - len + i + Math.round(drop * 3 * k * (1 - k)) });
    }
  }
  return out;
}

type Extra = (g: Ctx, sx: number, sy: number) => void;

function fireExtra(l: Live): Extra {
  return (g, sx, sy) => {
    const b = l.light?.boost ?? 0;
    const small = l.thing.id === "brazier";
    const h = (small ? 7 : 11) + b * 8 + Math.sin(G.t * 13) * 1.2;
    const y = sy - (small ? 8 : 6);
    flame(g, sx, y, (small ? 3.4 : 5.4) + b, h, SKY[5], 0);
    flame(g, sx, y, (small ? 2.2 : 3.6) + b * 0.6, h * 0.72, GOLD[1], 1.3);
    flame(g, sx, y, small ? 1.1 : 1.8, h * 0.42, CREAM, 2.1);
  };
}

/** What is drawn over a thing's picture every frame, if it has a part that moves. */
export function extraOf(l: Live, w: TouchWorld): Extra | null {
  const id = l.thing.id;
  const flip = l.thing.turns === "flip" && l.placed.t % 2 === 1;
  switch (id) {
    case "fire-ring":
    case "brazier":
      return fireExtra(l);
    case "mailbox":
      // The flag: up when there is something in the box.
      return (g, sx, sy) => {
        if (w.mail()) {
          R(g, sx + 4, sy - 17, 3, 9, "#1a0f1e");
          R(g, sx + 6, sy - 17, 5, 5, "#1a0f1e");
          R(g, sx + 5, sy - 16, 1, 8, GOLD[0]);
          R(g, sx + 6, sy - 16, 4, 3, GOLD[2]);
          R(g, sx + 6, sy - 14, 4, 1, GOLD[1]);
        } else {
          R(g, sx + 4, sy - 9, 6, 3, "#1a0f1e");
          R(g, sx + 5, sy - 8, 4, 1, GOLD[0]);
        }
      };
    case "trophy-shelf":
      return (g, sx, sy) => {
        w.trophies().forEach((trophy, i) => {
          const pic = w.art.small[trophy];
          const at = SHELF_SLOTS[i % SHELF_SLOTS.length];
          if (pic && at) g.drawImage(pic, sx + at[0], sy + at[1] - pic.height + 1);
        });
      };
    case "lantern-post":
      // Put out, its glass goes dark.
      return (g, sx, sy) => {
        if (!isLit(l)) R(g, sx + (flip ? -10 : 7), sy - 27, 3, 5, "#3a2c40");
      };
    case "candle-stump":
      return (g, sx, sy) => {
        if (!isLit(l)) return;
        WICKS.forEach(([dx, dy], i) => {
          const tall = Math.sin(G.t * 11 + i * 2) > 0 ? 2 : 1;
          R(g, sx + dx, sy + dy - tall, 1, tall, GOLD[2]);
          R(g, sx + dx, sy + dy - 1, 1, 1, CREAM);
        });
      };
    case "firefly-lamp":
      return (g, sx, sy) => {
        for (let i = 0; i < 3; i++) {
          if (Math.sin(G.t * 3 + i * 2.1) < -0.3) continue;
          const x = sx + Math.round(Math.sin(G.t * 1.3 + i * 2) * 2.4);
          const y = sy - 11 + Math.round(Math.cos(G.t * 1.7 + i * 1.4) * 1.6);
          R(g, x, y, 1, 1, GOLD[2]);
        }
      };
    case "fairy-lights": {
      const wire = slung(l, 3);
      l.glow = (g, sx, sy, spark) => {
        wire.forEach((p, i) => {
          if (i % 6 !== 3) return;
          const n = Math.floor(i / 6);
          const wave = clamp(1 - Math.abs((G.t - l.at) * 22 - n), 0, 1);
          const on = 0.62 + 0.38 * Math.sin(G.t * 1.6 + n * 1.9) + wave;
          R(g, sx + p.x, sy + p.y + 1, 2, 2, wave > 0.3 ? CREAM : (BULBS[n % BULBS.length] ?? CREAM));
          g.globalAlpha = clamp(0.16 * on + wave * 0.3, 0, 0.6);
          g.drawImage(spark, sx + p.x - 5, sy + p.y - 4, 12, 12);
          g.globalAlpha = 1;
        });
      };
      return (g, sx, sy) => {
        for (const p of wire) R(g, sx + p.x, sy + p.y, 1, 1, SKY[0]);
      };
    }
    case "bunting": {
      const wire = slung(l, 1);
      const cols = [SKY[5], GOLD[1], CREAM, SKY[4], GREEN[4]];
      return (g, sx, sy) => {
        const since = G.t - l.at;
        wire.forEach((p, i) => {
          const lift = since < 1.2 ? Math.round(Math.sin(since * 14 - i * 0.5) * (1 - since / 1.2) * 1.6) : 0;
          R(g, sx + p.x, sy + p.y + lift, 1, 1, BARK[0]);
          if (i % 5 !== 2) return;
          const col = cols[Math.floor(i / 5) % cols.length] ?? CREAM;
          R(g, sx + p.x - 1, sy + p.y + 1 + lift, 3, 1, col);
          R(g, sx + p.x - 1, sy + p.y + 2 + lift, 2, 1, col);
          R(g, sx + p.x, sy + p.y + 3 + lift, 1, 1, col);
        });
      };
    }
    case "moth-lantern":
      l.glow = (g, sx, sy) => {
        // Moth goes round the lantern, wider for a while after being noticed.
        const wide = 4 + clamp(1 - (G.t - l.at) / 2, 0, 1) * 5;
        const a = G.t * 3.1;
        const x = sx + 3 + Math.round(Math.cos(a) * wide);
        const y = sy - 13 + Math.round(Math.sin(a * 1.3) * (wide * 0.6));
        const open = Math.sin(G.t * 26) > 0;
        R(g, x, y, 1, 1, CREAM);
        R(g, x - 1, y - (open ? 1 : 0), 1, 1, "#e9d8b8");
        R(g, x + 1, y - (open ? 1 : 0), 1, 1, "#e9d8b8");
      };
      return null;
    case "wind-chime":
      return (g, sx, sy) => {
        const swing = clamp(1 - (G.t - l.at) / 1.6, 0, 1);
        TUBES.forEach(([dx, len], i) => {
          const sway = Math.round(Math.sin(G.t * 9 + i * 1.7) * swing * 1.6);
          R(g, sx + dx + sway, sy - 17, 1, len, i % 2 ? STONE[3] : WATER[3]);
          R(g, sx + dx + sway, sy - 17 + len - 1, 1, 1, STONE[1]);
        });
      };
    case "hammock":
    case "rocker":
      return null;
    case "fountain":
      return (g, sx, sy) => {
        const leap = clamp(1 - (G.t - l.at) / 1.5, 0, 1);
        const high = 5 + leap * 6;
        for (let i = 0; i < 6; i++) {
          const k = (G.t * 1.6 + i / 6) % 1;
          for (const side of [-1, 1]) {
            const x = sx + Math.round(side * k * 6);
            const y = sy - 16 - Math.round(Math.sin(k * Math.PI) * high) + Math.round(k * 8);
            R(g, x, y, 1, 1, k < 0.5 ? WATER[3] : WATER[2]);
          }
        }
        R(g, sx - 1, sy - 17 - Math.round(leap * 4), 2, 2, CREAM);
      };
    case "cabin":
      // A pennant on the roof for every land the guild has taken tonight.
      return (g, sx, sy) => {
        if (G.lands <= 0) return;
        const cols = [SKY[4], WATER[2], SKY[3], GREEN[3]];
        const x = sx + 30;
        const y = sy - 78;
        R(g, x, y, 1, 12, BARK[0]);
        const col = cols[G.lands % cols.length] ?? SKY[4];
        for (let i = 0; i < 7; i++) {
          const wave = Math.round(Math.sin(G.t * 5 - i * 0.7) * (i / 6));
          R(g, x + 1 + i, y + 1 + wave, 1, Math.max(1, 5 - Math.floor(i / 2)), col);
        }
      };
    default:
      return null;
  }
}

/** How a seat's sitter is carried: a hammock sways and a rocker rocks for a moment after a touch. */
export function swayOf(l: Live): number {
  const since = G.t - l.at;
  return since < 1.6 ? Math.sin(since * 9) * lerp(1.6, 0, since / 1.6) : 0;
}
