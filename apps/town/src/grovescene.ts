/**
 * The Grove: where the guild's pulls are made, a place of its own inside the town's page as a camp
 * is. The pulls are Leaf's (`@sequoia-leaf/pulls`): the page opens them, draws Leaf's view, and
 * sends `pull` and `exchange`; a ceremony plays the notes Leaf answered with, and never a guess.
 *
 * Its picture is its own canvas over the town's, on the stage of `grovestage.ts`. It is composed
 * for a frame of 640 by 360 art pixels (360 by 640 in an upright window), which is shown as large
 * as the window allows (`fit`) and stands in the middle of the window's foot; the stage and
 * whatever crosses the whole picture are drawn on from the frame to the window's edges. One
 * timeline: `paint` draws the whole picture for the time `t` alone (seconds since the pull was
 * answered), from nothing kept between frames. At a mid-tier or top prize among several the clock
 * stands (`ticked`) until the player goes on, and what moves there moves by how long it has stood.
 * A person is the town's own walking figure (the
 * kit's `bake`), drawn large and moved as the town moves it; a figure of the raid is the raid's own
 * picture of it, as the camp shows it.
 *
 * `main.ts` drives it through `Scene`. What is said and counted is in `pulls.ts`, and the words and
 * buttons over the picture are `groveui.ts`.
 */

import { beatAt } from "@sequoia-leaf/figures/sprites.ts";
import { member, refreshLeaf } from "@sequoia-leaf/kit/live.ts";
import { ask as askLeaf } from "@sequoia-leaf/kit/net.ts";
import { CORAL, CREAM, EARTH, GOLD, GREEN, INK, LEAF, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { ell, rgb } from "@sequoia-leaf/kit/pix.ts";
import { openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import { bake, type Body, lookFor, paintSkin, skinOf, WALK } from "@sequoia-leaf/kit/skin.ts";
import { noise, note, penta, sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, hash, lerp, makeCanvas, must, vnoise } from "@sequoia-leaf/kit/util.ts";
import {
  BANNERS,
  isOpen,
  PRIZES,
  type PullsCommand,
  type PullsNote,
  type PullsView,
  RARITIES,
  RATES,
} from "@sequoia-leaf/pulls";
import { type BannerPerson, readBanners, readNotes, readView } from "@sequoia-leaf/pulls/wire.ts";
import { figureThing } from "@sequoia-leaf/town/things.ts";

import { type CampArt, pictureOf } from "./campart.ts";
import { G, hooks } from "./game.ts";
import { buildStage, type Light, type Stage as Backdrop } from "./grovestage.ts";
import { makeGroveUi } from "./groveui.ts";
import { hush } from "./hud.ts";
import { troubleCard } from "./leaf.ts";
import {
  bannerLine,
  GROVE,
  type GroveState,
  groveState,
  onward,
  RARITY_NAMES,
  refusedLine,
  type Reveal,
  revealOf,
  seedsOf,
  showing,
  takesCommand,
  ticked,
  tierOf,
  type Timeline,
  timeline,
} from "./pulls.ts";
import type { Sprites } from "./sprites.ts";
import type { Scene, Stage } from "./stage.ts";

// ---------------------------------------------------------------- what a ceremony shows

/** The ceremony's three weights, one for each tier: by day, by lantern-light at dusk, under an aurora at night. */
type Finish = "leaf" | "lantern" | "aurora";
const FINISH = { filler: "leaf", mid: "lantern", top: "aurora" } as const;
const RANK: Record<Finish, number> = { leaf: 0, lantern: 1, aurora: 2 };
const STARS: Record<Finish, number> = { leaf: 1, lantern: 2, aurora: 3 };
/** An aurora's reveal begins with half a second of black. */
const BLACK = 0.5;
/** How long the build and the tell take, before the first reveal. */
const TELL = 2.6;

interface Trio {
  d: string;
  m: string;
  l: string;
}

/** One prize of a ceremony: what Leaf drew, what the reveal says of it, and what is drawn. */
interface Shown {
  readonly note: PullsNote;
  readonly says: Reveal;
  readonly finish: Finish;
  /** Its rarity's colour, with a darker and a lighter one beside it. */
  readonly tones: Trio;
  /** Its picture, a pixel to each of its own; a headliner has their walking figure too. */
  readonly pic: HTMLCanvasElement;
  readonly body: Body | null;
}

/** A ceremony: the prizes in the order Leaf drew them, and when each beat falls. */
interface Show extends Timeline {
  readonly list: readonly Shown[];
  readonly best: Finish;
  /** The rarest of them, which stands at the front of the end picture. */
  readonly rarest: number;
}

/** The name's letters land one a frame from 0.30 of a reveal; then the stars, then the tags. */
const LETTER = 1 / 60;
const nameDoneAt = (p: Shown): number => 0.3 + p.says.name.length * LETTER;
const starAt = (p: Shown, j: number): number => Math.max(nameDoneAt(p) + 0.06, 0.55) + j * 0.08;
const tagAt = (p: Shown): number => starAt(p, STARS[p.finish] - 1) + 0.09;
/** In the tell, when each light sets off from the path, and when it flares in its colour. */
const lightStart = (i: number): number => 1.04 + i * 0.03;
const flareAt = (i: number): number => 1.9 + i * 0.035;
/** In the end picture, when each prize hops in, by its turn; then the line, then the buttons. */
const arriveAt = (slot: number): number => slot * 0.11;
const HOP = 0.22;
const END_LINE = 1.3;
const END_BUTTONS = 1.45;

/** The order the prizes arrive in the end picture: as drawn, the rarest last. */
const arrivalOrder = (show: Show): number[] =>
  [...show.list.keys()].filter((k) => k !== show.rarest).concat([show.rarest]);

// ---------------------------------------------------------------- colours and easing

const AUR: Trio[] = [
  { d: GREEN[2], m: GREEN[4], l: LEAF },
  { d: WATER[1], m: WATER[2], l: WATER[3] },
  { d: SKY[3], m: SKY[4], l: CORAL },
];
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const auroraAt = (t: number, k = 0): Trio => AUR[mod(Math.floor(t * 3) + k, 3)] ?? { d: INK, m: INK, l: INK };
const mixed = (a: string, b: string, k: number): string => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return `rgb(${Math.round(lerp(r1, r2, k))},${Math.round(lerp(g1, g2, k))},${Math.round(lerp(b1, b2, k))})`;
};
const tonesOf = (colour: string): Trio => ({ d: mixed(colour, INK, 0.45), m: colour, l: mixed(colour, CREAM, 0.5) });
/** A prize's light: its rarity's colour, and for a top prize the aurora's, turning. */
const lit = (p: Shown, t = 0, k = 0): Trio => (p.finish === "aurora" ? auroraAt(t, k) : p.tones);
/** Whether dark letters or light ones read on a colour. */
const dark = (colour: string): boolean => {
  const [r, g, b] = rgb(colour);
  return 0.3 * r + 0.55 * g + 0.15 * b > 140;
};

const clamp01 = (v: number): number => clamp(v, 0, 1);
const outCubic = (x: number): number => 1 - (1 - x) ** 3;
const inOutSine = (x: number): number => 0.5 - 0.5 * Math.cos(Math.PI * x);
const outBack = (x: number, s = 1.70158): number => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
const inBack = (x: number, s = 1.70158): number => (s + 1) * x * x * x - s * x * x;
const r = Math.round;

// ---------------------------------------------------------------- pictures

function memo(cache: Map<string, HTMLCanvasElement>, id: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(id);
  if (!c) {
    c = make();
    cache.set(id, c);
  }
  return c;
}

/** The largest of these sizes at which a picture fits a box. */
const fitting = (src: HTMLCanvasElement, w: number, h: number, sizes: readonly number[]): number =>
  sizes.find((k) => src.width * k <= w && src.height * k <= h) ?? sizes.at(-1) ?? 1;

/** Where a picture is drawn to stand with its feet at (x, y), `up` pixels off the ground: a figure's frame has two rows under its feet. */
const footed = (p: Shown, spr: HTMLCanvasElement, k: number, x: number, y: number, up = 0): [number, number] => [
  r(x - spr.width / 2),
  r(y - spr.height + (p.body ? 2 * k : 0) - up),
];
/** The town's hop: up and down again `times` over, five of a figure's pixels high. */
const hopOf = (t: number, k: number, times = 1, each = 0.26): number =>
  t >= 0 && t < each * times ? Math.abs(Math.sin((t / each) * Math.PI)) * 5 * k : 0;

/** Where one aurora colour gives way to the next, the columns of the two are shuffled together. */
const seam = (x: number): number => (hash(x >> 1, 7, 3) - 0.5) * 0.2;
/** How large a prize stands in a reveal and in the end picture: a person, or a figure of the raid, each kind at one size. */
const revealSize = (p: Shown): number => (p.body ? 10 : 7);
const endSize = (p: Shown): number => (p.body ? 6 : 3);
/** How rare a prize is, among the rarities. */
const worth = (p: Shown): number => RARITY_NAMES.indexOf(p.note.rarity);

// ---------------------------------------------------------------- sound

/** A sound and the moment of the ceremony it falls on. */
type Beat = readonly [number, () => void];

/** Every sound of a ceremony: the build, the tell by the best finish, each reveal by its own, and the end picture. */
function beats(s: Show): Beat[] {
  const out: Beat[] = [];
  const ev = (at: number, fn: () => void): void => void out.push([at, fn]);
  if (s.tell > 0) {
    ev(0, () => {
      noise(0.45, 1400, { vol: 0.07, slide: 0.25 });
      tone(note(-26), 1.8, { type: "sine", vol: 0.13, attack: 0.35 });
      tone(note(-14), 1.4, { type: "sine", vol: 0.04, attack: 0.5, at: 0.2 });
    });
    ev(0.45, () => tone(note(31), 0.25, { type: "sine", vol: 0.05 }));
    ev(0.56, () => tone(note(33), 0.44, { type: "sine", vol: 0.035, slide: 0.42 }));
    ev(1.0, () => {
      tone(note(21), 1.1, { type: "sine", vol: 0.13 });
      tone(note(28), 0.7, { type: "sine", vol: 0.05, at: 0.02 });
      tone(note(-15), 0.45, { type: "sine", vol: 0.16, slide: 0.6 });
      noise(0.6, 1600, { vol: 0.05, slide: 0.3, q: 0.8 });
    });
    ev(1.6, () => {
      const chord = s.best === "leaf" ? [0, 4, 7] : s.best === "lantern" ? [0, 4, 7, 12] : [0, 4, 7, 11, 14];
      chord.forEach((semi, k) => tone(note(semi - 12), 1.6, { type: "sine", vol: 0.06, attack: 0.25, at: k * 0.04 }));
      if (s.best !== "leaf") tone(note(12), 1.4, { type: "sine", vol: 0.07, at: 0.1 });
      if (s.best === "aurora")
        for (let k = 0; k < 8; k++) tone(penta(7 + k), 0.3, { type: "sine", vol: 0.04, at: 0.15 + k * 0.08 });
      noise(0.9, 4200, { vol: 0.03, slide: 1.6, q: 0.6 });
    });
  }
  s.list.forEach((p, i) => {
    const f = p.finish;
    const rank = RANK[f];
    if (s.tell > 0) {
      ev(lightStart(i), () => tone(penta(5 + i), 0.22, { type: "triangle", vol: 0.045 }));
      ev(flareAt(i), () =>
        tone(penta(8 + rank * 2 + (i % 3)), 0.18, {
          type: f === "leaf" ? "triangle" : "sine",
          vol: 0.04 + rank * 0.02,
        }),
      );
    }
    const start = s.starts[i] ?? 0;
    const s0 = start + (f === "aurora" ? BLACK : 0);
    if (f === "aurora")
      ev(start + 0.001, () => tone(note(-5), BLACK + 0.05, { type: "sine", vol: 0.12, attack: 0.04 }));
    ev(s0 + 0.0005, () => {
      tone(110, 0.14, { type: "sine", vol: 0.2, slide: 0.55 });
      noise(0.18, 900, { vol: 0.08, slide: 3, q: 0.7 });
    });
    ev(s0 + 0.1, () => noise(0.2, 700, { vol: 0.06, slide: 4, q: 0.8 }));
    ev(s0 + 0.35, () => {
      if (f === "leaf") {
        tone(penta(5), 0.25, { type: "sine", vol: 0.1 });
        tone(penta(7), 0.3, { type: "sine", vol: 0.06, at: 0.05 });
      } else if (f === "lantern") {
        for (const [fq, vol] of [
          [note(12), 0.12],
          [note(19), 0.06],
          [note(24), 0.04],
        ] as const)
          tone(fq, 1.2, { type: "sine", vol });
        tone(note(0), 0.9, { type: "triangle", vol: 0.05 });
      } else {
        [0, 4, 7, 11, 14, 19].forEach((semi, k) => tone(note(semi), 2.2, { type: "sine", vol: 0.055, at: k * 0.03 }));
        for (const semi of [-12, -5]) tone(note(semi), 2.0, { type: "triangle", vol: 0.06 });
        for (let k = 0; k < 10; k++) tone(penta(8 + k), 0.25, { type: "sine", vol: 0.035, at: 0.1 + k * 0.06 });
      }
    });
    for (let k = 0; k < p.says.name.length; k += 2)
      ev(s0 + 0.3 + k * LETTER, () => tone(note(24 + (k % 4)), 0.03, { type: "square", vol: 0.022 }));
    for (let j = 0; j < STARS[f]; j++)
      ev(s0 + starAt(p, j), () => {
        tone(penta(7 + j * 2 + rank), 0.16, { type: "square", vol: 0.045 });
        tone(penta(7 + j * 2 + rank) * 2, 0.12, { type: "sine", vol: 0.04, at: 0.01 });
      });
    ev(s0 + tagAt(p), () => {
      if (p.says.owned) {
        tone(note(19), 0.08, { type: "square", vol: 0.05 });
        tone(note(26), 0.14, { type: "square", vol: 0.04, at: 0.05 });
      } else {
        tone(note(24), 0.3, { type: "sine", vol: 0.09 });
        tone(note(31), 0.4, { type: "sine", vol: 0.05, at: 0.06 });
      }
    });
  });
  // the end picture: a note as each prize lands, then a chord for the Seeds
  if (s.list.length > 1) {
    arrivalOrder(s).forEach((_k, slot) => {
      ev(s.end + arriveAt(slot) + HOP, () => {
        tone(penta(3 + slot), 0.16, { type: "triangle", vol: 0.07 });
        noise(0.05, 600, { vol: 0.04 });
      });
    });
    ev(s.end + END_LINE, () =>
      [0, 4, 7, 12].forEach((semi, k) => tone(note(semi), 0.9, { type: "sine", vol: 0.05, at: k * 0.07 })),
    );
  }
  return out;
}

type PullsPlay = Play<PullsView, PullsCommand, PullsNote>;

export interface Grove extends Scene {
  /** Opens the pulls from Leaf, or asks for them again; says why not if they will not open. */
  open(): Promise<Trouble | null>;
  /** The member has arrived: the picture and its words are put on. */
  enter(): void;
  /** Handles for looking at it from outside. */
  readonly handles: {
    /** Where the screen is (its state), the ceremony's time and beats, and Leaf's view. */
    state(): unknown;
    /** Moves the ceremony's clock to a time, or the banner's with a negative one. */
    jump(t: number): void;
    /** Shows a pool: `grove`, or a banner by its id. */
    pool(id: string): void;
    /** Asks Leaf for the pulls again: for after a tour has staged something. */
    again(): Promise<void>;
  };
}

export function makeGrove(
  sprites: Sprites,
  art: CampArt,
  stage: Stage,
  town: Scene & { cameFromGrove(): void },
): Grove {
  // ---------------------------------------------------------------- Leaf

  let play: PullsPlay | null = null;
  let banners: BannerPerson[] = [];
  /** The headliner's figure: a look of their own at once, and their own skin once it has come. */
  let person: { id: string; body: Body } | null = null;
  /** The pool on show. */
  let pool = GROVE;
  /** Leaf is answering a pull or an exchange; and the member is on the way out, or not here at all. */
  let sent = false;
  let leaving = true;
  /** When Leaf was last asked for the pulls, and for the banners' headliners, while nothing told the page to. */
  let asked = 0;
  let metAt = 0;

  const view = (): PullsView => must(play, "the pulls").state;
  const banner = (): ReturnType<typeof showing> => showing(view(), banners);
  /** The Grove's one state: what may be pressed in it, and whether a command may be sent (`takesCommand`). */
  const state = (): GroveState => groveState({ leaving, sent, dark: G.dark, end: show?.end ?? null, t });
  const mark = (): void => ui.at(state());

  function meet(who: { id: string; name: string }): void {
    if (person?.id === who.id) return;
    const mine = { id: who.id, body: bake(paintSkin(lookFor(who.name))) };
    person = mine;
    const skin = new Image();
    skin.addEventListener("load", () => {
      try {
        mine.body = bake(skin);
        shownCache.clear();
      } catch {
        // A picture the page may not read: the look of their own stays.
      }
    });
    skin.src = skinOf(who.id);
  }

  /** The pool on show is one that is open: a banner that has ended gives way to the always-open pool. */
  function settle(): void {
    const b = banner();
    if (b) meet(b.person);
    if (pool !== GROVE && pool !== b?.id) pool = GROVE;
  }

  /** Asks Leaf who headlines the banners, while it has said of none: at once, or `every` milliseconds apart at most. */
  async function meetBanners(every = 60_000): Promise<void> {
    const now = Date.now();
    if (banners.some((b) => b.headliner) || now - metAt < every) return;
    metAt = now;
    const said = await askLeaf("/v1/game/banners");
    banners = (said.status === 200 ? readBanners(said.body) : null) ?? banners;
  }

  async function open(): Promise<Trouble | null> {
    const me = member();
    if (!me) return "closed";
    const [opened] = await Promise.all([
      play ??
        openPlay<PullsView, PullsCommand, PullsNote>(
          "pulls",
          { view: readView, notes: readNotes },
          // Offstage it says nothing of itself: time in town is not time in the Grove.
          { player: me.id, away: () => G.where !== "grove" },
        ),
      play?.refresh(),
      meetBanners(0),
    ]);
    if ("trouble" in opened) return opened.trouble;
    if (!play) opened.onTrouble(troubleCard);
    play = opened;
    settle();
    return null;
  }

  /**
   * Asks Leaf for the pulls again when a free pull has fallen due or a banner is due to open or to
   * end by the page's clock, a minute apart at most.
   */
  function keepFresh(): void {
    const v = view();
    const now = Date.now();
    const due =
      (v.free.waiting < RATES.free.most && now >= v.free.next) ||
      BANNERS.some(({ id }) => isOpen(id, now) !== v.open.some((b) => b.id === id));
    if (!due || now - asked < 60_000) return;
    asked = now;
    void Promise.all([play?.refresh(), meetBanners()]).then(settle);
  }

  /** The banner open now and whose it is, in a line, for the Grove's card in town; asks Leaf whose, if it does not know. */
  hooks.groveBanner = (): string | null => {
    const now = Date.now();
    void meetBanners();
    const b = showing({ open: BANNERS.filter(({ id }) => isOpen(id, now)) }, banners);
    return b ? bannerLine(b) : null;
  };

  // ---------------------------------------------------------------- the page

  const ui = makeGroveUi({
    view,
    banners: () => banners,
    banner,
    pool: () => pool,
    choose(id) {
      pool = id;
      settle();
      sfx.tap();
    },
    state,
    pull: (n, paid, button) => void send({ do: "pull", pool, n, with: paid }, button, n),
    exchange: (prize, button) => void send({ do: "exchange", prize }, button, null),
    leave,
    done,
    next,
    toEnd() {
      if (show) jump(show.end);
    },
    picture,
  });
  function done(): void {
    if (state() !== "end") return;
    show = null;
    sfx.close();
    mark();
  }
  const canvas = ui.canvas;
  const screen2d = must(canvas.getContext("2d"), "2d context");
  /** The picture, a pixel to an art pixel, drawn in the frame's places: (0, 0) is the frame's corner. */
  const { c: whole, g } = makeCanvas(1, 1, true);
  const fx = makeCanvas(1, 1, true);

  /** The frame, and whether it is the upright one. */
  let W = 640;
  let H = 360;
  let TALL = false;
  /** CSS pixels to an art pixel. */
  let SCALE = 2;
  /** The window's left, top and right edges in the frame's art pixels; the frame's foot is the window's. */
  let X0 = 0;
  let Y0 = 0;
  let X1 = 640;
  /** The stage for this frame and this much round it, built when it is first drawn. */
  let built: Backdrop | null = null;
  const scene = (): Backdrop => (built ??= buildStage(sprites, W / 2, H / 2, TALL ? 90 : 86, -X0 / 2, -Y0 / 2));
  /** What the town's canvas shows under this one: nothing. */
  const under = makeCanvas(1, 1);

  function resize(w: number, h: number): void {
    under.c.width = w;
    under.c.height = h;
    under.g.fillStyle = INK;
    under.g.fillRect(0, 0, w, h);
    fit();
  }

  /**
   * The frame as large as the window allows, in the middle of the window's foot, and the picture on
   * from it to the window's edges. An upright window takes the upright frame, which is the larger there.
   */
  function fit(): void {
    const dpr = devicePixelRatio || 1;
    const was = `${W} ${X0} ${Y0}`;
    TALL = innerHeight > innerWidth;
    W = TALL ? 360 : 640;
    H = TALL ? 640 : 360;
    // Device pixels to an art pixel: a fraction if it must be, and within a hundredth over a whole number, that number.
    let px = Math.min(innerWidth / W, innerHeight / H) * dpr;
    if (px - Math.floor(px) < Math.floor(px) / 100) px = Math.floor(px);
    SCALE = px / dpr;
    // The frame stands on a device pixel; the picture goes on round it in scene pixels, two art pixels each.
    const left = Math.round(((innerWidth - W * SCALE) / 2) * dpr) / dpr;
    const top = Math.ceil((innerHeight - H * SCALE) * dpr) / dpr;
    X0 = -2 * Math.ceil(Math.max(left, innerWidth - left - W * SCALE) / SCALE / 2);
    Y0 = -2 * Math.ceil(top / SCALE / 2);
    X1 = W - X0;
    if (was !== `${W} ${X0} ${Y0}`) {
      built = null;
      keptCache.clear();
      shownCache.clear();
    }
    whole.width = X1 - X0;
    whole.height = H - Y0;
    g.imageSmoothingEnabled = false;
    g.translate(-X0, -Y0);
    // An art pixel is seldom a whole number of device pixels, and enlarged to one by the browser
    // some rows would be fatter than others. So the picture is shown enlarged by the next whole
    // number up, and the browser brings that down smoothly: every art pixel is as wide as the next.
    // At a whole number the browser enlarges it evenly by itself, and it is shown as it is.
    const plain = Number.isInteger(px);
    const up = plain ? 1 : Math.ceil(px);
    canvas.width = whole.width * up;
    canvas.height = whole.height * up;
    screen2d.imageSmoothingEnabled = false;
    Object.assign(canvas.style, {
      left: `${X0 * SCALE}px`,
      top: `${Y0 * SCALE}px`,
      width: `${whole.width * SCALE}px`,
      height: `${whole.height * SCALE}px`,
      imageRendering: plain ? "pixelated" : "auto",
    });
    ui.fit(W, H, SCALE, TALL, left, top);
  }

  // ---------------------------------------------------------------- pictures

  /** Pictures made from the stage, kept; and pictures made for what is on show, let go with it. */
  const keptCache = new Map<string, HTMLCanvasElement>();
  const shownCache = new Map<string, HTMLCanvasElement>();
  /**
   * A prize's own picture, a pixel to each of its own: the headliner's walking figure, or a figure of
   * the raid as the camp shows it, in the first or the second of its two standing pictures.
   */
  function picture(prize: string, beat: 0 | 1 = 0): HTMLCanvasElement {
    const [kind, id = ""] = prize.split(":");
    if (kind === "headliner") return person?.body.frames[0]?.[0] ?? art.parcel.c;
    return pictureOf(art, figureThing(id), 0, beat)?.c ?? art.parcel.c;
  }

  /** A picture `k` art pixels to each of its own. */
  function sized(src: HTMLCanvasElement, id: string, k: number): HTMLCanvasElement {
    return memo(shownCache, `s${id}/${k}`, () => {
      const { c, g: cg } = makeCanvas(src.width * k, src.height * k);
      cg.drawImage(src, 0, 0, c.width, c.height);
      return c;
    });
  }
  function tinted(src: HTMLCanvasElement, id: string, colour: string): HTMLCanvasElement {
    return memo(shownCache, `t${id}${colour}`, () => {
      const { c, g: cg } = makeCanvas(src.width, src.height);
      cg.drawImage(src, 0, 0);
      cg.globalCompositeOperation = "source-in";
      cg.fillStyle = colour;
      cg.fillRect(0, 0, c.width, c.height);
      return c;
    });
  }

  /** A picture grown by `rad` pixels all round, in one colour: an edge to draw behind it. */
  function grown(src: HTMLCanvasElement, id: string, colour: string, rad: number): HTMLCanvasElement {
    return memo(shownCache, `g${id}${colour}${rad}`, () => {
      const s = tinted(src, id, colour);
      const { c, g: cg } = makeCanvas(s.width + rad * 2, s.height + rad * 2);
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++)
          if (Math.abs(dx) + Math.abs(dy) <= rad) cg.drawImage(s, rad + dx, rad + dy);
      return c;
    });
  }

  const edgeCache = new Map<string, [number, number, number][]>();
  /** Points just outside a picture's outline, with which way is out (-1 left, 1 right). */
  function edgePoints(s: HTMLCanvasElement, id: string): [number, number, number][] {
    let pts = edgeCache.get(id);
    if (pts) return pts;
    const d = must(s.getContext("2d"), "2d context").getImageData(0, 0, s.width, s.height).data;
    const a = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < s.width && y < s.height && (d[(y * s.width + x) * 4 + 3] ?? 0) > 0;
    pts = [];
    for (let y = 0; y < s.height; y += 4)
      for (let x = 0; x < s.width; x++) {
        if (a(x, y) && !a(x - 1, y)) pts.push([x - 4, y, -1]);
        if (a(x, y) && !a(x + 1, y)) pts.push([x + 4, y, 1]);
      }
    edgeCache.set(id, pts);
    return pts;
  }

  /** The stage in one light, darkened by `k` so that what stands on it stands out. */
  function dimmed(light: Light, k: number): HTMLCanvasElement {
    return memo(keptCache, `dim${light}${k}`, () => {
      const src = scene().pic[light];
      const { c, g: cg } = makeCanvas(src.width, src.height);
      cg.drawImage(src, 0, 0);
      cg.globalAlpha = k;
      cg.fillStyle = INK;
      cg.fillRect(0, 0, c.width, c.height);
      return c;
    });
  }

  /** Night over the stage, a step at a time: a quarter of its pixels, a checker, three quarters, all. */
  function nightStep(step: number): HTMLCanvasElement {
    return memo(keptCache, `night${step}`, () => {
      const src = scene().pic.night;
      const { c, g: cg } = makeCanvas(src.width, src.height);
      cg.drawImage(src, 0, 0);
      const bayer = [0, 2, 3, 1];
      for (let y = 0; y < src.height; y += 2)
        for (let x = 0; x < src.width; x += 2)
          if ((bayer[(((y + Y0) >> 1) & 1) * 2 + (((x + X0) >> 1) & 1)] ?? 0) >= step) cg.clearRect(x, y, 2, 2);
      return c;
    });
  }

  /**
   * A prize's picture as it stands at a size: a person facing `dir` in a pose of their walk, or a
   * figure of the raid in the first of its two standing pictures or (`pose` 1) the second.
   */
  function standing(p: Shown, k: number, dir = 0, pose = 0): { spr: HTMLCanvasElement; id: string } {
    const id = `${p.note.prize}${p.body ? dir : ""}${pose}`;
    const src = p.body?.frames[dir]?.[pose] ?? picture(p.note.prize, pose === 1 ? 1 : 0);
    return { spr: sized(src, id, k), id: `${id}/${k}` };
  }
  // ---------------------------------------------------------------- drawing helpers

  function R(x: number, y: number, w: number, h: number, c: string, cx: Ctx = g): void {
    cx.fillStyle = c;
    cx.fillRect(r(x), r(y), r(w), r(h));
  }
  /** A picture as large as the whole picture (the stage in a light, or the offscreen picture), laid over it. */
  const lay = (c: HTMLCanvasElement): void => g.drawImage(c, X0, Y0);
  /** One colour over the whole picture. */
  const flood = (c: string): void => R(X0, Y0, X1 - X0, H - Y0, c);
  /** The offscreen picture, emptied, to be drawn in as the picture is. */
  function blank(): Ctx {
    fx.c.width = whole.width;
    fx.c.height = whole.height;
    fx.g.imageSmoothingEnabled = false;
    fx.g.translate(-X0, -Y0);
    return fx.g;
  }
  const disc = (cx: number, cy: number, rad: number, c: string): void => ell(g, r(cx), r(cy), r(rad), r(rad), c);
  const ellipse = (cx: number, cy: number, rx: number, ry: number, c: string): void =>
    ell(g, r(cx), r(cy), r(rx), Math.max(1, r(ry)), c);

  /** A ring lying on the ground: an ellipse `ratio` as tall as wide, `w` pixels thick across the ground. */
  function groundRing(cx: number, cy: number, rx: number, ratio: number, w: number, c: string): void {
    g.fillStyle = c;
    cx = r(cx);
    cy = r(cy);
    const ry = Math.max(1, r(rx * ratio));
    const irx = rx - w;
    const iry = irx * ratio;
    for (let dy = -ry; dy <= ry; dy++) {
      const wo = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))) + 0.3);
      const wi = irx > 0 && Math.abs(dy) < iry ? Math.floor(irx * Math.sqrt(1 - (dy * dy) / (iry * iry))) : -1;
      if (wi < 0) g.fillRect(cx - wo, cy + dy, wo * 2 + 1, 1);
      else {
        g.fillRect(cx - wo, cy + dy, Math.max(1, wo - wi), 1);
        g.fillRect(cx + wi + 1, cy + dy, Math.max(1, wo - wi), 1);
      }
    }
  }

  /** Soft light in banded rings, added to what is under it. */
  function glow(cx: number, cy: number, rad: number, c: string, a: number): void {
    if (a <= 0) return;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = a;
    disc(cx, cy, rad, c);
    disc(cx, cy, rad * 0.68, c);
    disc(cx, cy, rad * 0.4, c);
    g.restore();
  }

  function say(s: string, x: number, y: number, px: number, colour: string, shadow?: string): number {
    if (shadow) write(g, s, x + px, y + px, { px, colour: shadow, shadow: false });
    return write(g, s, x, y, { px, colour, shadow: false });
  }
  /** The largest of these letter sizes at which a line is no wider than `most`. */
  const letters = (s: string, most: number, sizes: readonly number[]): number =>
    sizes.find((px) => widthOf(g, s, px) <= most) ?? sizes.at(-1) ?? 1;

  /**
   * A name at the largest letters at which it fits a line no wider than `most`, or two lines no
   * taller together than `tall`, broken at the space that leaves the shorter longest line.
   */
  function nameLines(name: string, most: number, tall: number): { px: number; rows: string[] } {
    const words = name.split(" ");
    const breaks = words.slice(1).map((_w, k) => [words.slice(0, k + 1).join(" "), words.slice(k + 1).join(" ")]);
    for (const px of [5, 4, 3]) {
      if (widthOf(g, name, px) <= most) return { px, rows: [name] };
      const wide = (rows: readonly string[]): number => Math.max(...rows.map((row) => widthOf(g, row, px)));
      const two = breaks.toSorted((a, b) => wide(a) - wide(b))[0];
      if (two && px * 22 <= tall && wide(two) <= most) return { px, rows: two };
    }
    return { px: 2, rows: [name] };
  }

  /** A four-point sparkle: size 1 a dot, 2 a plus, 3 and up a long plus. */
  function sparkle(x: number, y: number, size: number, c: string, core: string = CREAM): void {
    x = r(x);
    y = r(y);
    if (size <= 0) return;
    if (size === 1) return R(x, y, 1, 1, c);
    const arm = size - 1;
    R(x - arm, y, arm * 2 + 1, 1, c);
    R(x, y - arm, 1, arm * 2 + 1, c);
    if (size >= 4) R(x - 1, y - 1, 3, 3, c);
    R(x, y, 1, 1, core);
  }

  const STAR13 = [
    "......#......",
    "......#......",
    ".....###.....",
    ".....###.....",
    "#############",
    ".###########.",
    "..#########..",
    "...#######...",
    "...#######...",
    "..####.####..",
    "..###...###..",
    ".##.......##.",
    ".#.........#.",
  ];
  const STAR7 = ["...#...", "..###..", "#######", ".#####.", "..###..", ".##.##.", ".#...#."];
  function starSprite(rows: string[], main: string, shade: string, light: string): HTMLCanvasElement {
    return memo(keptCache, `star${rows.length}${main}${shade}${light}`, () => {
      const n = rows.length;
      const { c, g: cg } = makeCanvas(n + 2, n + 2);
      const on = (x: number, y: number): boolean => rows[y]?.charAt(x) === "#";
      for (let y = -1; y <= n; y++)
        for (let x = -1; x <= n; x++) {
          let col: string | null = null;
          if (on(x, y)) col = x > n / 2 && y >= n / 3 ? shade : y <= 3 && x === Math.floor(n / 2) ? light : main;
          else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) col = INK;
          if (col) {
            cg.fillStyle = col;
            cg.fillRect(x + 1, y + 1, 1, 1);
          }
        }
      return c;
    });
  }

  /** A tag's words, its plate, the plate's light top, and its letters. */
  type Tag = readonly [string, string, string, string];
  /** A small tag: a plate with an ink edge, a light top and a word in the pixel font, whose tails (g, y) clear the foot's edge. */
  const chipWidth = (text: string, px = 2): number => widthOf(g, text, px) + 5 * px;
  function chip(text: string, x: number, y: number, bg: string, top: string, fg: string, px = 2): number {
    const w = chipWidth(text, px);
    const h = 11 * px;
    R(x - 1, y - 1, w + 2, h + 2, INK);
    R(x, y, w, h, bg);
    R(x, y, w, px, top);
    R(x, y + h - px, w, px, INK);
    write(g, text, x + 3 * px, y + px, { px, colour: fg, shadow: false });
    return w;
  }

  /**
   * Aurora curtains, two pixels to a column: a bright hem along a slow wave, light above it, then rays
   * that thin out upward in a checker. Only columns left of `front` are drawn (with a ragged edge).
   */
  function curtains(
    c: Ctx,
    t: number,
    base: number,
    amp: number,
    len: number,
    col: (x: number) => Trio,
    front: number,
    seed: number,
  ): void {
    for (let x = X0; x < X1; x += 2) {
      if (x > front - hash(x, seed, 9) * 18) continue;
      const n = x / 640;
      const hem = r(
        base + Math.sin(n * 5.2 + t * 0.7 + seed) * amp + Math.sin(n * 14 - t * 1.5 + seed * 2) * amp * 0.35,
      );
      // rays: narrow streaks that drift along the curtain, under a broad swell
      const swell = 0.7 + 0.3 * Math.sin(n * 9 + t * 0.9 + seed);
      const streak = vnoise(x / 7 - t * 3, seed * 7, 11);
      const L = r(len * swell * (0.3 + 0.7 * streak));
      const k = col(x);
      R(x, hem - 3, 2, 3, k.l, c);
      R(x, hem - 9, 2, 6, k.m, c);
      const solid = r(L * 0.4);
      R(x, hem - 9 - solid, 2, solid, k.d, c);
      c.fillStyle = k.d;
      for (let yy = hem - 10 - solid; yy > hem - 9 - L; yy--) if ((yy + (x >> 1)) % 2 === 0) c.fillRect(x, yy, 2, 1);
      // the hem's light spills a little below it in a checker
      c.fillStyle = k.m;
      for (let yy = hem; yy < hem + 4; yy++) if ((yy + (x >> 1)) % 2 === 0) c.fillRect(x, yy, 2, 1);
    }
  }

  /** Draw into the offscreen picture with `draw`, keep only what lands on `mask`, lay it on. */
  function throughMask(draw: (c: Ctx) => void, mask: HTMLCanvasElement): void {
    const c = blank();
    draw(c);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(mask, X0, Y0);
    lay(fx.c);
  }

  // ---------------------------------------------------------------- the banner and the tell

  const LIGHT_RISE = 0.3;
  /** The aurora's two curtains: the near one's hem, sway and length, then the far one's hem and length. */
  const auroraShape = (): [number, number, number, number, number] =>
    TALL ? [330, 14, 190, 200, 56] : [150, 12, 104, 86, 34];

  /** The posts' lanterns: a slow pulse in four steps, each a little out of time with the other. */
  function lanternGlow(ti: number, k: number, size = 20): void {
    if (k <= 0) return;
    scene().lanterns.forEach(([x, y], i) => {
      const p = Math.floor((0.5 + 0.5 * Math.sin(ti * 2.4 + i * 1.7)) * 3.99) / 3;
      glow(x, y, size + p * 4, GOLD[0], (0.1 + p * 0.05) * k);
      R(x - 2, y - 2, 4, 6, GOLD[3]);
    });
  }

  function stars(ta: number): void {
    for (const [x, y, k] of scene().stars) {
      if (hash(x, Math.floor(ta * 4 + k * 10), 3) < 0.15) continue;
      const c = k > 0.8 ? CREAM : k > 0.45 ? GOLD[2] : SKY[4];
      if (k > 0.93) sparkle(x, y, 2, c);
      else R(x, y, 2, 2, c);
    }
  }

  /** The plum ground the words stand on, on an upright screen: its top edge steps up to the right. */
  function lowerThird(base: number): void {
    for (let x = Math.floor(X0 / 12) * 12; x < X1; x += 12) {
      const top = base - Math.floor(x / 24) * 3;
      R(x, top, 12, H - top, SKY[1]);
      R(x, top, 12, 2, INK);
    }
    R(X0, Math.max(base, H - 32), X1 - X0, 32, SKY[0]);
  }
  /** How far the banner has dropped out of the picture, `at` seconds into a pull: a little lift first. */
  const dropped = (at: number): number => r(inBack(at / 0.4, 1.4) * (H - Y0));

  /** Where the banner's plum ground begins on an upright screen, and where its name is written. */
  const THIRD = 372;
  const NAME_AT = (): { x: number; y: number; most: number } =>
    TALL ? { x: W / 2, y: THIRD + 2, most: W - 24 } : { x: W - 16, y: 92, most: 256 };

  /** The banner's own ground for its words: a slanted plum field at the right, or the lower third; and the pool's name on it. */
  function bannerField(sink: number): void {
    if (TALL) lowerThird(THIRD + sink);
    else
      for (let y = Y0 + sink; y < H; y++) {
        const edge = r(384 - 0.3 * (y - sink));
        R(edge, y, 6, 1, GOLD[1]);
        R(edge + 6, y, 2, 1, INK);
        R(edge + 8, y, X1 - edge - 8, 1, SKY[0]);
      }
    const name = ui.poolName();
    const at = NAME_AT();
    const px = letters(name, at.most, [4, 3, 2]);
    const x = TALL ? r(at.x - widthOf(g, name, px) / 2) : at.x - widthOf(g, name, px);
    say(name, x, at.y + sink + (4 - px) * 5, px, CREAM, INK);
  }

  /** What stands in the clearing on the banner: its headliner, hopping now and then, or the always-open pool's three top figures. `sink` drops them out of the picture. */
  function faces(ti: number, sink: number): void {
    const feet = (TALL ? THIRD - 18 : 344) + sink;
    const cx = TALL ? 118 : 110;
    const b = banner();
    if (pool !== GROVE && b && person) {
      const k = 8;
      const spr = sized(person.body.frames[0]?.[0] ?? art.parcel.c, `face${b.id}`, k);
      ellipse(cx, feet - 1, 5 * k, k / 2, INK);
      g.drawImage(spr, r(cx - spr.width / 2), r(feet - spr.height + 2 * k - hopOf(mod(ti, 4) - 3, k)));
      return;
    }
    const stands = [
      [158, -40, 84],
      [92, -22, 100],
      [0, 0, 132],
    ] as const;
    PRIZES.Treant.forEach((prize, i) => {
      const [dx, dy, box] = stands[i % stands.length] ?? [0, 0, 100];
      const beat = beatAt(ti, i / 3);
      const pic = picture(prize, beat);
      const spr = sized(pic, `${prize}${beat}`, fitting(pic, box, box * 1.4, [6, 5, 4, 3, 2, 1]));
      ellipse(cx + dx, feet + dy - 1, spr.width * 0.46, 4, INK);
      g.drawImage(spr, r(cx + dx - spr.width / 2), feet + dy - spr.height);
    });
  }

  function drawBanner(ti: number): void {
    const st = scene();
    lay(st.pic.day);
    lanternGlow(ti, 1);
    // a few motes drift up from each lantern
    for (let k = 0; k < 8; k++) {
      const [lx, ly] = st.lanterns[k % st.lanterns.length] ?? [0, 0];
      const ph = mod(ti / (2.4 + hash(k, 1, 5) * 1.6) + hash(k, 2, 5), 1);
      if (ph < 0.85)
        R(
          lx + (hash(k, 3, 5) - 0.5) * 40 + Math.sin(ti * 1.3 + k) * 4,
          ly - ph * 110,
          2,
          2,
          ph < 0.5 ? GOLD[2] : GOLD[1],
        );
    }
    faces(ti, 0);
    bannerField(0);
  }

  /** The aurora's three colours drifting by in turn, for a column. */
  const drifting =
    (t: number, speed: number, layer: number) =>
    (x: number): Trio =>
      AUR[mod(Math.floor((x / W) * 1.3 - t * speed + layer + seam(x)), 3)] ?? auroraAt(0);

  /** The best finish's colour in the sky, for a column: for a top prize, green, blue and rose drift by in turn. */
  function tellColour(s: Show, t: number, layer: number): (x: number) => Trio {
    if (s.best === "aurora") return drifting(t, 0.9, layer);
    const c: Trio = s.best === "leaf" ? { d: GREEN[2], m: GREEN[4], l: LEAF } : { d: GOLD[0], m: GOLD[1], l: GOLD[3] };
    return () => c;
  }

  /** The aurora over the stage's sky, as far across as `front`: two curtains, and their light along the tops of the trees. */
  function aurora(t: number, col: (layer: number) => (x: number) => Trio, front: number): void {
    const st = scene();
    const [hem, amp, len, hem2, len2] = auroraShape();
    throughMask((c) => {
      curtains(c, t * 1.2 + 7, hem2, amp * 0.7, len2, col(1), front - 40, 3);
      curtains(c, t, hem, amp, len, col(0), front, 1);
    }, st.sky);
    g.save();
    g.beginPath();
    g.rect(X0, Y0, r(front - 20) - X0, H - Y0);
    g.clip();
    lay(tinted(st.rim, "rim", col(0)(W / 2).m));
    g.restore();
  }

  function drawTell(s: Show, t: number): void {
    const tt = Math.min(t, 2.4); // hold the last 0.2 s; only an aurora goes on moving
    const ta = s.best === "aurora" ? t : tt;
    const st = scene();
    // 0.0–0.4: night comes down over the stage in four dithered steps, the lanterns going out, and
    // whoever is on the banner and its words drop away together
    if (tt < 0.4) {
      const step = Math.floor(tt / 0.1);
      const sink = dropped(tt);
      lay(st.pic.day);
      if (step > 0) lay(nightStep(step));
      lanternGlow(0, 1 - step / 2);
      faces(0, sink);
      bannerField(sink);
      return;
    }
    lay(st.pic.night);
    stars(ta);

    // 1.6–2.6: the aurora unrolls left to right across the sky, in the colour of the best finish
    if (t >= 1.6)
      aurora(ta, (layer) => tellColour(s, ta, layer), X0 + inOutSine(clamp01((t - 1.6) / 0.6)) * (X1 - X0 + 40));

    const [lx, ly] = st.root;
    // 0.4–1.0: a glint gathers at the top of the screen, then one bright drop falls to the path
    const top = Y0 + 3;
    if (tt < 1.0) {
      if (tt < 0.6) {
        const k = (tt - 0.4) / 0.2;
        glow(lx, top, 8, GOLD[0], 0.3);
        sparkle(lx, top, k < 0.35 ? 2 : k < 0.7 ? 5 : 4, GOLD[2]);
        R(lx - 1, top - 1, 3, 3, CREAM);
      } else {
        const u = (tt - 0.6) / 0.4;
        const y = r(top + (ly - top) * u * u);
        const trail = r(5 + u * u * 40);
        for (let k = 1; k <= trail; k++)
          if (k < trail * 0.45 || k % 2 === 0)
            R(lx, y - 3 - k, 2, 1, k < trail * 0.3 ? CREAM : k < trail * 0.6 ? GOLD[2] : GOLD[1]);
        glow(lx, y, 9, GOLD[0], 0.3);
        R(lx - 1, y - 3, 4, 5, CREAM);
        R(lx, y - 4, 2, 7, CREAM);
      }
    }
    // 1.0: it lands; a flash, a splash, and rings of light run out along the ground
    if (tt >= 1.0) {
      const u = tt - 1.0;
      if (u < 0.1) {
        glow(lx, ly, 44, GOLD[1], u < 0.05 ? 0.4 : 0.2);
        disc(lx, ly, u < 0.05 ? 7 : 4, CREAM);
      }
      if (u < 0.32)
        for (let k = 0; k < 9; k++) {
          const vx = (k - 4) * 22 + (hash(k, 4, 1) - 0.5) * 10;
          const vy = -70 - hash(k, 5, 1) * 50;
          R(lx + vx * u, ly + vy * u + 440 * u * u, 2, 2, k % 2 ? GOLD[2] : CREAM);
        }
      const ring = (delay: number, max: number, c0: string): void => {
        const k = (u - delay) / 0.55;
        if (k <= 0 || k >= 1) return;
        const rx = 5 + Math.pow(k, 0.55) * max;
        g.save();
        g.globalAlpha = k < 0.45 ? 1 : k < 0.75 ? 0.6 : 0.3;
        groundRing(lx, ly, rx, 0.15, 2 + k * 7, k < 0.25 ? CREAM : c0);
        g.restore();
      };
      // the light shows the clearing as it was by day, in a pool that runs out and fades
      if (u < 0.8) {
        const k = outCubic(Math.min(1, u / 0.5));
        const rx = 16 + k * W * 0.6;
        const ry = Math.max(2, r(rx * 0.22));
        const c = blank();
        c.fillStyle = "#fff";
        for (let dy = -ry; dy <= ry; dy++) {
          const w = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
          c.fillRect(lx - w, ly + dy, w * 2 + 1, 1);
        }
        c.globalCompositeOperation = "source-in";
        c.drawImage(st.pic.dusk, X0, Y0);
        g.save();
        g.beginPath();
        g.rect(X0, st.horizon, X1 - X0, H - st.horizon);
        g.clip();
        g.globalAlpha = u < 0.2 ? 0.9 : u < 0.4 ? 0.65 : u < 0.6 ? 0.4 : 0.2;
        lay(fx.c);
        g.restore();
      }
      ring(0, TALL ? 230 : 320, GOLD[2]);
      ring(0.1, TALL ? 150 : 210, GOLD[1]);
      // the path keeps a little light
      glow(lx, ly, 14, GOLD[0], 0.16);
      R(lx - 2, ly, 6, 2, GOLD[2]);
    }
    // 1.04–1.6: a small light for each pull rises up among the trees; 1.9 on: each flares in its prize's colour
    s.list.forEach((p, i) => {
      const s0 = lightStart(i);
      if (tt < s0) return;
      const k = clamp01((tt - s0) / LIGHT_RISE);
      // One pull's light goes to the middle of the trees.
      const [pxw, pyw] = st.perches[s.list.length === 1 ? 5 : i] ?? [lx, ly - 100];
      const e = outCubic(k);
      const sway = Math.sin(k * Math.PI * 2 + i * 1.7) * 12 * (1 - k);
      const x = r(lerp(lx, pxw, e) + sway);
      const y = r(lerp(ly, pyw, outCubic(Math.min(1, k * 1.1)))) + (k >= 1 ? r(Math.sin(ta * 3 + i * 1.3)) : 0);
      if (k < 1) for (let q = 1; q < 5; q++) R(x, y + q * 4, 2, 2, q <= 2 ? GOLD[2] : GOLD[1]);
      const fa = flareAt(i);
      if (tt < fa) {
        glow(x, y, 7, GOLD[0], 0.22);
        R(x - 2, y - 2, 4, 4, GOLD[1]);
        R(x - 1, y - 1, 2, 2, CREAM);
      } else {
        const u = tt - fa;
        const c = lit(p, ta, i);
        const big = RANK[p.finish];
        glow(x, y, 10 + big * 6, c.m, 0.18 + big * 0.05);
        if (u < 0.05) {
          sparkle(x, y, 9 + big * 3, CREAM);
          disc(x, y, 3 + big, CREAM);
        } else {
          sparkle(x, y, 4 + big * 2, c.m, c.l);
          disc(x, y, 1 + big, c.l);
          R(x, y, 1, 1, CREAM);
        }
      }
    });
  }

  // ---------------------------------------------------------------- a reveal

  /** Where the prize stands and where its name is written (`nameX` null: centred), and how wide a line of it and how tall two lines may be. */
  const placeOf = (): { cx: number; feet: number; nameX: number | null; nameY: number; most: number; tall: number } =>
    TALL
      ? { cx: 180, feet: 390, nameX: null, nameY: 424, most: 336, tall: 70 }
      : { cx: 172, feet: 340, nameX: 318, nameY: 84, most: 306, tall: 115 };

  /** The stage in the finish's own light: day for a leaf, lantern-lit dusk, a night under the aurora. */
  function backdrop(f: Finish, u: number): void {
    if (f === "leaf") return lay(dimmed("day", 0.35));
    if (f === "lantern") {
      lay(dimmed("dusk", 0.12));
      return lanternGlow(u, 1, 22);
    }
    lay(scene().pic.night);
    stars(u);
    aurora(u + 3, (layer) => drifting(u, 1.1, layer), X1 + 60);
  }

  /**
   * One of the two bands behind a reveal: a slanted strip, moved in from the lower left by `off`
   * (0..1). With `shade`, the stage to the right of the band is darkened by that much, so words there read.
   */
  function band(cx: number, cy: number, slope: number, half: number, colour: string, off: number, shade = 0): void {
    const d = off * (X1 - X0 - Y0 + 260);
    for (let y = Y0; y < H; y++) {
      const xc = cx + slope * (y - cy - d * 0.6) - d;
      if (shade > 0) {
        g.globalAlpha = shade;
        g.fillStyle = INK;
        g.fillRect(r(xc), y, X1 - xc, 1);
        g.globalAlpha = 1;
      }
      g.fillStyle = colour;
      g.fillRect(r(xc - half), y, r(half * 2), 1);
    }
  }

  /** A square for each pull along the foot of the picture: the one on show picked out, those shown in their colours. */
  function drawPips(s: Show, cur: number, revealedCur: boolean): void {
    const n = s.list.length;
    if (n < 2) return;
    const size = TALL ? 6 : 5;
    const gap = 4;
    const x0 = r(W / 2 - (n * size + (n - 1) * gap) / 2);
    const y = H - (TALL ? 16 : 11);
    s.list.forEach((p, k) => {
      const x = x0 + k * (size + gap);
      const c = k < cur || (k === cur && revealedCur) ? p.tones : null;
      if (k === cur) {
        R(x - 2, y - 3, size + 4, size + 4, CREAM);
        R(x - 1, y - 2, size + 2, size + 2, INK);
        R(x, y - 1, size, size, c ? c.m : SKY[2]);
        if (c) R(x, y - 1, size, 1, c.l);
      } else {
        R(x - 1, y - 1, size + 2, size + 2, INK);
        R(x, y, size, size, c ? c.m : SKY[1]);
        if (c) R(x, y, size, 1, c.l);
      }
    });
  }

  function drawReveal(s: Show, i: number, u: number): void {
    const p = must(s.list[i], "a prize");
    const f = p.finish;
    flood(INK);
    if (u < 0) return; // an aurora's half second of black, one note held

    const pl = placeOf();
    backdrop(f, u);

    // 0.00–0.15: the two bands sweep in from the lower left: a wide one in the finish's colour, a narrow one in the rarity's
    const slope = TALL ? -0.62 : 0.62;
    const bcy = TALL ? 230 : H / 2;
    const snap = u >= 0.35 && u < 0.35 + 2 / 60; // the bands flash as the prize snaps to colour
    const wide = f === "leaf" ? GREEN[2] : f === "lantern" ? CORAL : SKY[2];
    band(pl.cx - 8, bcy, slope, TALL ? 82 : 76, snap ? lit(p, u).l : wide, 1 - outCubic(clamp01(u / 0.12)));
    band(
      pl.cx + (TALL ? 104 : 98),
      bcy,
      slope,
      TALL ? 12 : 11,
      snap ? CREAM : p.tones.m,
      1 - outBack(clamp01((u - 0.03) / 0.12), 1.4),
      TALL ? 0 : f === "aurora" ? 0.15 : 0.5,
    );

    // the lanterns burn on this side of the shade
    if (f === "lantern") lanternGlow(u, 1, 22);
    // the lower third on a phone: a plum ground for the name
    if (TALL) lowerThird(410);

    const isLit = u >= 0.35;
    // warm motes rise behind a lantern
    if (f === "lantern")
      for (let k = 0; k < 46; k++) {
        const h1 = hash(k, i, 1);
        const h2 = hash(k, i, 2);
        const h3 = hash(k, i, 3);
        const span = pl.feet + 20;
        const y = r(pl.feet + 10 - mod(u * (22 + h2 * 40) + h3 * span, span));
        const x = r(pl.cx + (h1 - 0.5) * (TALL ? 340 : 300) + Math.sin(u * 2.4 + h3 * 6) * 3);
        if (hash(k, Math.floor(u * 8), 4) < 0.12) continue;
        const size = h2 > 0.7 ? 3 : 2;
        R(x, y, size, size, h3 > 0.66 ? GOLD[3] : h3 > 0.33 ? GOLD[2] : GOLD[1]);
      }

    // 0.10–0.35: it comes in from the left as a flat shape in its rarity's colour (a person walks,
    // as the town's people walk); 0.35: it is in its own colours, a person turned to face us, and
    // hops (twice for an aurora); from then a figure of the raid breathes as it does on the raid's table
    if (u >= 0.1) {
      const K = revealSize(p);
      const half = (p.body ? 12 : p.pic.width) * K * 0.5;
      const k = clamp01((u - 0.1) / 0.23);
      const from = X0 - half - 20;
      const x = isLit ? pl.cx : r(lerp(from, pl.cx, outCubic(k)));
      // a step of the walk for every five of its own pixels walked, as in the town
      const step = WALK[Math.floor((x - from) / K / 5) % 4] ?? 0;
      const pose = p.body ? (isLit ? 0 : step) : isLit ? beatAt(u - 0.35) : 0;
      const { spr, id } = standing(p, K, isLit ? 0 : 2, pose);
      // a person the ceremony waits at goes on hopping now and then, as they do on the banner
      const again = p.body ? hopOf(mod(u - 0.35, 4) - 3, 10) : 0;
      const up = isLit ? Math.max(again, hopOf(u - 0.35, 10, f === "aurora" ? 2 : 1)) : 0;
      const [sx, sy] = footed(p, spr, K, x, pl.feet, up);
      ellipse(x, pl.feet - 2, half * 0.84, 5, INK);
      if (!isLit) {
        const col = lit(p, u * 1.5).l;
        // speed lines trail the shape while it is fast
        const speed = 3 * (1 - k) ** 2;
        if (speed > 0.25)
          for (let n = 0; n < 7; n++) {
            const ly = pl.feet - spr.height * 0.85 + r(hash(n, i, 31) * spr.height * 0.7);
            const len = r(speed * (40 + hash(n, i, 32) * 60));
            R(x - half * 0.84 - len, ly, len, 2, n % 3 === 0 ? CREAM : col);
          }
        g.drawImage(tinted(spr, id, col), sx, sy);
      } else {
        const frame = Math.floor((u - 0.35) * 60);
        if (frame < 3) g.drawImage(grown(spr, id, "#ffffff", 3 - frame), sx - (3 - frame), sy - (3 - frame));
        g.drawImage(spr, sx, sy);
        // an aurora sparkles round its outline
        if (f === "aurora") {
          const pts = edgePoints(spr, id);
          for (let n = 0; n < 34; n++) {
            const [ex, ey, side] = pts[Math.floor(hash(n, 8, 21) * pts.length)] ?? [0, 0, 1];
            const ph = mod((u - 0.35) / (0.5 + hash(n, 9, 21) * 0.5) + hash(n, 10, 21), 1);
            const size =
              ph < 0.1 ? 1 : ph < 0.2 ? 3 : ph < 0.32 ? 5 : ph < 0.44 ? 4 : ph < 0.56 ? 2 : ph < 0.66 ? 1 : 0;
            sparkle(sx + ex + side * 3, sy + ey - r(ph * 8), size, auroraAt(u + n * 0.37).l);
          }
        }
      }
    }

    // 0.30 on: the name is stamped a letter a frame; then its rarity and the stars, what it is for, and the tags
    const { name, rarity } = p.says;
    const { px: PX, rows: lines } = nameLines(name, pl.most, pl.tall);
    const left = (w: number): number => (pl.nameX === null ? r(W / 2 - w / 2) : pl.nameX);
    let stamped = Math.max(0, Math.min(name.length, Math.floor((u - 0.3) / LETTER) + 1));
    const landing = stamped > 0 && u - (0.3 + (stamped - 1) * LETTER) < LETTER;
    lines.forEach((line, n) => {
      const shown = Math.min(line.length, stamped);
      // the space a name was broken at is stamped too, and takes its frame
      stamped -= line.length + 1;
      if (shown <= 0) return;
      const nx = left(widthOf(g, line, PX));
      const jolt = landing && stamped < 0 ? 1 : 0;
      const ny = pl.nameY + n * PX * 11 + jolt;
      say(line.slice(0, shown), nx, ny, PX, CREAM, f === "aurora" ? auroraAt(u * 1.25).d : SKY[2]);
      // the newest letter lands white for its frame
      if (jolt)
        write(g, line.charAt(shown - 1), nx + widthOf(g, line.slice(0, shown - 1), PX), ny, {
          px: PX,
          colour: "#ffffff",
          shadow: false,
        });
    });
    const starsN = STARS[f];
    const starGap = 19;
    const rankW = chipWidth(rarity);
    const rowW = rankW + 12 + starsN * starGap;
    const ry = pl.nameY + lines.length * PX * 11 + 4;
    const rx = left(rowW) + (pl.nameX === null ? 0 : 3);
    const rankAt = nameDoneAt(p) + 0.02;
    if (u >= rankAt) {
      const drop = u - rankAt < 1 / 30 ? -2 : 0;
      chip(rarity, rx, ry + drop, p.tones.m, p.tones.l, dark(p.tones.m) ? INK : CREAM);
      const is = p.says.is;
      say(is, pl.nameX === null ? r(W / 2 - widthOf(g, is, 2) / 2) : rx, ry + 30 + drop, 2, CREAM, INK);
    }
    const sc = lit(p, u);
    for (let j = 0; j < starsN; j++) {
      const a = starAt(p, j);
      if (u < a) continue;
      const τ = u - a;
      const sx = rx + rankW + 20 + j * starGap;
      const sy = ry + 11;
      const main = f === "aurora" ? auroraAt(u + j * 0.33).l : f === "leaf" ? LEAF : GOLD[1];
      const shade = f === "aurora" ? auroraAt(u + j * 0.33).m : f === "leaf" ? GREEN[4] : GOLD[0];
      const img =
        τ < 1 / 30
          ? starSprite(STAR7, CREAM, CREAM, CREAM)
          : τ < 0.08
            ? starSprite(STAR13, "#ffffff", CREAM, "#ffffff")
            : starSprite(STAR13, main, shade, CREAM);
      g.drawImage(img, r(sx - img.width / 2), r(sy - img.height / 2) + (τ >= 1 / 30 && τ < 0.08 ? -2 : 0));
      if (τ < 0.24)
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + 0.4;
          const d = 8 + (τ / 0.24) * 12;
          R(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, τ < 0.12 ? 2 : 1, τ < 0.12 ? 2 : 1, k % 2 ? sc.l : CREAM);
        }
    }
    // the tags, a beat apart: whether it is new, the Seeds it gave, and for a banner's top prize how its 50/50 fell
    const ta = tagAt(p);
    const tags: Tag[][] = [
      [p.says.owned ? [p.says.have, SKY[1], SKY[3], WATER[3]] : [p.says.have, GOLD[1], GOLD[3], INK]],
    ];
    if (p.says.seeds) tags[0]?.push([p.says.seeds, GREEN[1], GREEN[4], LEAF]);
    if (p.says.fifty) tags.push([[p.says.fifty, SKY[1], SKY[3], CREAM]]);
    tags.forEach((row, n) => {
      let x = left(row.reduce((sum, [text]) => sum + chipWidth(text) + 8, -8)) + (pl.nameX === null ? 0 : 3);
      row.forEach(([text, bg, top, fg], m) => {
        const at = ta + (n * 2 + m) * 0.07;
        if (u >= at) chip(text, x, ry + 56 + n * 28 + (u - at < 1 / 30 ? -3 : u - at < 2 / 30 ? 1 : 0), bg, top, fg);
        x += chipWidth(text) + 8;
      });
    });

    drawPips(s, i, isLit);
  }

  // ---------------------------------------------------------------- the end picture

  interface Spot {
    x: number;
    feet: number;
    /** The name goes over it: the row in front hides its foot. */
    above?: true;
  }
  /** Where each prize of ten stands, by its pull: two rows (three on an upright screen), the rarest in the middle of the front one. */
  function spots(s: Show): Spot[] {
    const rows: readonly (readonly [number, readonly number[], boolean])[] = TALL
      ? [
          [196, [80, 180, 280], false],
          [368, [51, 137, 223, 309], false],
          [540, [80, 180, 280], false],
        ]
      : [
          [202, [84, 189, 294, 399, 504], true],
          [302, [136, 241, 346, 451, 556], false],
        ];
    const all = rows.flatMap(([feet, xs, above]) => xs.map((x): Spot => (above ? { x, feet, above } : { x, feet })));
    // The rarest takes the middle of the front row, a step nearer; the rest fill the others in the order they were drawn.
    const front = TALL ? 8 : 7;
    const [best] = all.splice(front, 1);
    const out: Spot[] = [];
    s.list.forEach((_p, k) => {
      const spot = k === s.rarest ? best : all.shift();
      out.push(spot ? (k === s.rarest && !TALL ? { ...spot, feet: spot.feet + 6 } : spot) : { x: W / 2, feet: H - 60 });
    });
    return out;
  }

  function drawEnd(s: Show, v: number): void {
    backdrop(s.best, v);
    // the fire is just this side of the picture: its light on the ground, flickering, and its sparks
    const flick = Math.floor(v * 8) % 3;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.06 + flick * 0.01;
    ellipse(W / 2, H + 10, (X1 - X0) * 0.6, TALL ? 170 : 100, GOLD[0]);
    ellipse(W / 2, H + 10, (X1 - X0) * 0.4, TALL ? 110 : 66, GOLD[0]);
    g.restore();
    for (let k = 0; k < 10; k++) {
      const ph = mod(v / (1.6 + hash(k, 1, 44) * 1.4) + hash(k, 2, 44), 1);
      const x = W / 2 + (hash(k, 3, 44) - 0.5) * W * 0.7 + Math.sin(v * 2 + k) * 6;
      if (ph < 0.8 && hash(k, Math.floor(v * 6), 45) > 0.15)
        R(x, H + 4 - ph * (TALL ? 260 : 150), 1, 1, ph < 0.4 ? GOLD[2] : GOLD[0]);
    }

    const sp = spots(s);
    const order = arrivalOrder(s);
    const rare = must(s.list[s.rarest], "the rarest");
    const at = must(sp[s.rarest], "its spot");
    const rc = lit(rare, v);
    const rareLand = arriveAt(order.indexOf(s.rarest)) + HOP * 0.5;
    // a soft glow behind the rarest, and a pool of its light on the ground
    if (v >= rareLand - 0.05) {
      const k = Math.min(1, (v - rareLand + 0.05) / 0.15);
      const pulse = Math.floor((0.5 + 0.5 * Math.sin(v * 2.2)) * 2.99);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let b = 0; b < 5; b++) {
        g.globalAlpha = 0.06 * k;
        disc(at.x, at.feet - 66, (78 + pulse * 3) * (1 - b * 0.17), rc.m);
      }
      g.restore();
      g.save();
      g.globalAlpha = 0.5 * k;
      ellipse(at.x, at.feet - 1, 46, 7, rc.d);
      g.restore();
      for (let j = 0; j < 6; j++) {
        const ph = mod(v / 0.9 + hash(j, 1, 51), 1);
        const size = ph < 0.15 ? 1 : ph < 0.3 ? 3 : ph < 0.45 ? 2 : ph < 0.55 ? 1 : 0;
        const ang = hash(j, 2, 51) * Math.PI * 2;
        sparkle(
          at.x + Math.cos(ang) * (46 + hash(j, 3, 51) * 16),
          at.feet - 66 + Math.sin(ang) * 62,
          size * k,
          lit(rare, v, j).l,
        );
      }
    }

    // back to front, so nearer prizes stand in front
    const drawOrder = [...s.list.keys()].toSorted((a, b) => (sp[a]?.feet ?? 0) - (sp[b]?.feet ?? 0));
    let shaded = false;
    for (const k of drawOrder) {
      const p = s.list[k];
      const spot = sp[k];
      if (!p || !spot) continue;
      const τ = v - arriveAt(order.indexOf(k));
      if (τ < 0) continue;
      const isRare = k === s.rarest;
      // a small hop: up and down again
      const q = clamp01(τ / HOP);
      const dy = τ < HOP ? r((isRare ? 16 : 9) * 4 * q * (1 - q)) : 0;
      // on a wide screen the row behind stands in a little shade, so the row in front reads
      if (!TALL && spot.feet > 250 && !shaded) {
        shaded = true;
        g.save();
        g.globalAlpha = 0.3;
        flood(INK);
        g.restore();
      }
      // the rarest goes on hopping, pleased; a figure of the raid breathes, each out of step with the next
      const size = endSize(p);
      const { spr, id } = standing(p, size, 0, p.body ? 0 : beatAt(v, k / 3));
      const glad = isRare && τ >= HOP ? hopOf(mod(τ - HOP, 1.6) - 1.0, 6, 2) : 0;
      const [x, y] = footed(p, spr, size, spot.x, spot.feet, dy + glad);
      ellipse(spot.x, spot.feet - 1, Math.max(14, spr.width * 0.42), 3, INK);
      if (τ < 1 / 30) g.drawImage(tinted(spr, id, "#ffffff"), x, y);
      else {
        if (isRare && τ >= HOP && τ < HOP + 0.06) g.drawImage(grown(spr, id, CREAM, 2), x - 2, y - 2);
        g.drawImage(spr, x, y);
      }
      // dust where it lands
      if (τ >= HOP && τ < HOP + 0.18) {
        const d = (τ - HOP) / 0.18;
        for (const side of [-1, 1])
          R(spot.x + side * (spr.width * 0.42 + d * 10), spot.feet - 2 - r(d * 3), 2, 2, EARTH[2]);
      }
    }

    // then, at the top, the Seeds the ten gave
    if (v >= END_LINE) {
      const text = seedsOf(s.list.map((p) => p.note));
      const drop = v - END_LINE < 0.08 ? -4 + r(((v - END_LINE) / 0.08) * 4) : 0;
      say(text, r(W / 2 - widthOf(g, text, 2) / 2), (TALL ? 22 : 8) + drop, 2, LEAF, INK);
    }
  }

  // ---------------------------------------------------------------- the whole frame

  /** The ceremony on show, or null on the banner. */
  let show: Show | null = null;
  /** Seconds since the ceremony began, how long its clock has stood at a wait, and how long the banner has been on. */
  let t = 0;
  let stood = 0;
  let idle = 0;
  let prevT = 0;
  let sounds: Beat[] = [];

  type Part = { kind: "tell" } | { kind: "reveal"; i: number; u: number } | { kind: "end"; v: number };
  function partAt(s: Show, at: number): Part {
    if (at < s.tell) return { kind: "tell" };
    for (const [i, p] of s.list.entries()) {
      // One prize alone stays on show: its reveal is the end picture.
      if (at < (s.starts[i + 1] ?? s.end) || s.list.length === 1)
        return { kind: "reveal", i, u: at - (s.starts[i] ?? 0) - (p.finish === "aurora" ? BLACK : 0) };
    }
    return { kind: "end", v: at - s.end };
  }

  function paint(): void {
    if (!show) drawBanner(idle);
    else {
      const part = partAt(show, t);
      if (part.kind === "tell") drawTell(show, t);
      else if (part.kind === "reveal") drawReveal(show, part.i, part.u + stood);
      else drawEnd(show, part.v);
    }
    screen2d.drawImage(whole, 0, 0, canvas.width, canvas.height);
    layout();
  }

  /** The words and buttons over the picture, where the time puts them. */
  function layout(): void {
    const s = show;
    const many = s !== null && s.list.length > 1;
    const v = s ? t - s.end : -1;
    // The names in the end picture are the page's own words, so they stay readable on a phone.
    ui.names.hidden = !many || v < 0;
    if (s && many && v >= 0) {
      const sp = spots(s);
      const order = arrivalOrder(s);
      s.list.forEach((p, k) => {
        const tag = ui.names.children[k];
        const spot = sp[k];
        if (!(tag instanceof HTMLElement) || !spot) return;
        tag.style.visibility = v - arriveAt(order.indexOf(k)) >= HOP * 0.5 ? "visible" : "hidden";
        tag.style.left = `${spot.x * SCALE}px`;
        const tall = (p.body ? 24 : p.pic.height) * endSize(p);
        tag.style.top = `${(spot.above ? spot.feet - tall - 4 : spot.feet + 4) * SCALE}px`;
        tag.classList.toggle("above", spot.above === true);
      });
    }
    // 0.0–0.4 of a pull: the banner's interface drops away downward, a little lift first
    const dropping = s !== null && s.tell > 0 && t < 0.4;
    ui.banner.hidden = s !== null && !dropping;
    ui.banner.style.transform = dropping ? `translateY(${dropped(t) * SCALE}px)` : "";
    ui.skip.hidden = s === null || dropping || t >= s.end;
    ui.go.hidden = !s?.waits.includes(t);
    ui.go.style.transform = `translateY(${r((1 - outBack(clamp01(stood / 0.3), 1.3)) * 50) * SCALE}px)`;
    const b = v - (many ? END_BUTTONS : 0.2);
    ui.end.hidden = s === null || b < 0;
    if (b >= 0) ui.end.style.transform = `translateY(${r((1 - outBack(clamp01(b / 0.3), 1.3)) * 50) * SCALE}px)`;
  }

  // ---------------------------------------------------------------- a pull

  const shownOf = (drawn: PullsNote): Shown => ({
    note: drawn,
    says: revealOf(drawn, banners),
    finish: FINISH[tierOf(drawn.rarity)],
    tones: tonesOf(RARITIES[drawn.rarity].colour),
    pic: picture(drawn.prize),
    body: drawn.prize.startsWith("headliner:") ? (person?.body ?? null) : null,
  });

  /** Begins the ceremony for what Leaf answered: the build and the tell for pulls, the reveal alone for a prize had for Seeds. */
  function begin(notes: readonly PullsNote[], repeat: 1 | 10 | null): void {
    if (notes.length === 0) return;
    const list = notes.map(shownOf);
    const line = timeline(
      list.map((p) => tierOf(p.note.rarity)),
      repeat ? TELL : 0,
    );
    const rarest = list.reduce((best, p, k) => (worth(p) >= worth(list[best] ?? p) ? k : best), 0);
    show = { ...line, list, best: list[rarest]?.finish ?? "leaf", rarest };
    shownCache.clear();
    edgeCache.clear();
    sounds = beats(show);
    jump(0);
    ui.began(
      list.map((p) => ({ name: p.says.name, colour: p.tones.m, have: p.note.have })),
      repeat,
    );
  }

  /** Sends a pull (of `repeat`) or an exchange, if the state takes one, and plays what Leaf answers. */
  async function send(command: PullsCommand, button: HTMLElement, repeat: 1 | 10 | null): Promise<void> {
    const leaf = play;
    if (!leaf || !takesCommand(state())) return;
    sent = true;
    mark();
    ui.said(null);
    if (repeat) sfx.tap();
    const answer = await waitingLook(button, leaf.send(command));
    sent = false;
    if (command.do === "pull" && command.with === "leaf") void refreshLeaf();
    settle();
    if ("refused" in answer) {
      sfx.no();
      ui.said(refusedLine(answer.refused));
    } else begin(answer.notes, repeat);
    mark();
  }

  // ---------------------------------------------------------------- the clock and the taps

  function jump(to: number): void {
    t = to;
    stood = 0;
    prevT = to - 0.0001;
  }

  /** On to the next beat: past the tell, or to the next prize, and so on from a prize the ceremony waits at. */
  function next(): void {
    if (show && t < show.end) jump(onward(show, t));
  }

  /** Back to town from the banner, the way the member came: night closes in, and lifts on the town. */
  function leave(): void {
    if (state() !== "banner") return;
    const went = stage.travel(town, () => {
      ui.root.hidden = true;
      hush(false);
      town.cameFromGrove();
    });
    if (!went) return;
    leaving = true;
    sfx.close();
    mark();
  }

  canvas.addEventListener("pointerdown", () => {
    if (show && t >= show.tell) next();
  });

  return {
    open,
    enter() {
      G.where = "grove";
      leaving = false;
      show = null;
      // The banner is the first thing seen, when there is one.
      pool = banner()?.id ?? GROVE;
      idle = 0;
      hush(true);
      fit();
      ui.said(null);
      ui.root.hidden = false;
      mark();
      ui.tick();
    },
    bounds: { w: 320, top: 0, bottom: 180 },
    resize,
    focus: () => ({ x: 0, y: 0 }),
    step(dt) {
      if (!play) return;
      if (show) {
        const to = ticked(show, t, dt);
        stood += t + dt - to;
        t = to;
        // A jump of the clock is not played through: only what a step of ordinary length passes.
        if (t - prevT < 0.5) for (const [at, fn] of sounds) if (at > prevT && at <= t) fn();
        prevT = t;
      } else {
        idle += dt;
        if (!sent) keepFresh();
      }
      const now = state();
      ui.at(now);
      // While a ceremony plays, the words keep what they said before it: the Seeds and the count would give the prize away.
      if (now !== "sent" && now !== "ceremony") ui.tick();
    },
    draw() {
      if (play) paint();
      // Night lifts on the Grove as it does on a place the town draws.
      ui.root.style.opacity = String(1 - G.dark);
      return under.c;
    },
    words: () => undefined,
    tap: () => false,
    point: () => null,
    act: next,
    back() {
      const now = state();
      if (ui.panelOpen()) ui.closePanel();
      else if (now === "banner") leave();
      else if (now === "ceremony") next();
      else done();
    },
    key(k) {
      if (k !== "arrowright" || !show) return false;
      next();
      return true;
    },
    drag: () => undefined,
    release: () => undefined,
    awake: () => !leaving && G.dark < 0.35,
    cameBack: () => undefined,
    handles: {
      state: () => ({
        on: state(),
        t: Math.round(t * 1000) / 1000,
        tell: show?.tell,
        starts: show?.starts,
        waits: show?.waits,
        end: show?.end,
        prizes: show?.list.map((p) => [p.note.prize, p.note.rarity, p.note.have, p.note.fifty ?? ""]),
        pool,
        view: play?.state,
      }),
      jump(to) {
        if (to < 0) idle = -to;
        else jump(to);
      },
      pool(id) {
        pool = id;
        settle();
      },
      async again() {
        await open();
      },
    },
  };
}
