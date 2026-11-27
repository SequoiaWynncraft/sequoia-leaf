/**
 * The Grove: where the guild's pulls are made, a place of its own inside the town's page as a camp
 * is. The pulls are Leaf's (`@sequoia-leaf/pulls`): the page opens them, draws Leaf's view, and
 * sends `pull` and `exchange`; a ceremony plays the notes Leaf answered with, and never a guess.
 *
 * One timeline: the picture (`grovepicture.ts`) is drawn for the time `t` alone (seconds since the
 * pull was answered), from nothing kept between frames. At a mid-tier or top prize among several
 * the clock stands (`ticked`) until the player goes on, and what moves there moves by how long it
 * has stood. A person is the town's own walking figure (the kit's `bake`), drawn large and moved as
 * the town moves it; a figure of the raid is the raid's own picture of it, as the camp shows it.
 *
 * `main.ts` drives it through `Scene`. What is said and counted is in `pulls.ts`, and the words and
 * buttons over the picture are `groveui.ts`.
 */

import { member } from "@sequoia-leaf/kit/live.ts";
import { ask as askLeaf } from "@sequoia-leaf/kit/net.ts";
import { openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import { bake, type Body, lookFor, paintSkin, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { noise, note, penta, sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { must } from "@sequoia-leaf/kit/util.ts";
import { BANNERS, type PullsCommand, type PullsNote, type PullsView, RARITIES } from "@sequoia-leaf/pulls";
import { type BannerPerson, readBanners, readNotes, readView } from "@sequoia-leaf/pulls/wire.ts";
import { catalogOf } from "@sequoia-leaf/raid/content/catalog.ts";

import type { CampArt } from "./campart.ts";
import { G, hooks } from "./game.ts";
import {
  arrivalOrder,
  arriveAt,
  BLACK,
  END_LINE,
  FINISH,
  flareAt,
  HOP,
  LETTER,
  lightStart,
  makeGrovePicture,
  RANK,
  type Show,
  type Shown,
  starAt,
  STARS,
  tagAt,
  TELL,
  tonesOf,
  worth,
} from "./grovepicture.ts";
import { makeGroveUi } from "./groveui.ts";
import { hush } from "./hud.ts";
import { troubleCard } from "./leaf.ts";
import {
  asksNow,
  bannerLine,
  GROVE,
  type GroveState,
  groveState,
  heardPeople,
  missingPeople,
  onward,
  refusedLine,
  revealOf,
  showing,
  takesCommand,
  ticked,
  tierOf,
  timeline,
} from "./pulls.ts";
import { placeOf as onStage } from "./screen.ts";
import type { Sprites } from "./sprites.ts";
import type { Scene, Stage } from "./stage.ts";

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

export function makeGrove(sprites: Sprites, art: CampArt, stage: Stage): Grove {
  // ---------------------------------------------------------------- Leaf

  let play: PullsPlay | null = null;
  let banners: BannerPerson[] = [];
  /** The headliner's figure: a look of their own at once, and their own skin once it has come. */
  let person: { id: string; body: Body } | null = null;
  /** The pool on show. */
  let pool = GROVE;
  /** Leaf is answering a pull or an exchange. */
  let sent = false;
  /** When Leaf was last asked for the pulls, and for the banners' headliners, while nothing told the page to. */
  let asked = 0;
  let metAt = 0;

  const view = (): PullsView => must(play, "the pulls").state;
  const banner = (): ReturnType<typeof showing> => showing(view(), banners, BANNERS);
  /** The Grove's one state: what may be pressed in it, and whether a command may be sent (`takesCommand`). */
  const state = (): GroveState => {
    // On the way out, or not here at all: the stage says.
    const now = stage.now();
    const leaving = onStage(now) !== "grove" || now.at === "dusk";
    return groveState({ leaving, sent, dark: G.dark, end: show?.end ?? null, t });
  };
  const mark = (): void => ui.at(state());

  function meet(who: { id: string; name: string }): void {
    if (person?.id === who.id) return;
    const mine = { id: who.id, body: bake(paintSkin(lookFor(who.name))) };
    person = mine;
    const skin = new Image();
    skin.addEventListener("load", () => {
      try {
        mine.body = bake(skin);
        pic.forget();
      } catch {
        // A picture the page may not read: the look of their own stays.
      }
    });
    skin.src = skinOf(who.id);
  }

  /** The pool on show is one that is open: a banner that has ended gives way to the always-open pool. */
  function settle(): void {
    const b = banner();
    if (b?.person) meet(b.person);
    if (pool !== GROVE && pool !== b?.id) pool = GROVE;
  }

  /**
   * Asks Leaf who the banners' people are, before the pulls are open and while an open banner has no
   * headliner known: at once, or `every` milliseconds apart at most. Each banner is kept as Leaf last
   * said it.
   */
  async function meetBanners(every = 60_000): Promise<void> {
    const now = Date.now();
    if ((play !== null && !missingPeople(play.state, banners)) || now - metAt < every) return;
    metAt = now;
    const said = await askLeaf("/v1/game/banners");
    banners = heardPeople(banners, (said.status === 200 ? readBanners(said.body) : null) ?? []);
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
   * Asks Leaf for the pulls again when a free pull has fallen due, a banner is due to open or to end,
   * or a release to open, by the page's clock, a minute apart at most. What is open and what each
   * pool gives is only ever what Leaf's answer says.
   */
  function keepFresh(): void {
    const now = Date.now();
    if (!asksNow(play?.state ?? null, now, asked)) return;
    asked = now;
    void (play ? Promise.all([play.refresh(), meetBanners()]).then(settle) : open());
  }

  /**
   * The banner open now and whose it is, in a line, for the Grove's card in town. What is open is
   * Leaf's to say: the pulls are asked for here, and again as `asksNow` says, in town as in the Grove.
   */
  hooks.groveBanner = (): string | null => {
    void meetBanners();
    keepFresh();
    return play ? bannerLine(showing(play.state, banners, BANNERS)) : null;
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
    pull: (n, paid, era, button) => void send({ do: "pull", pool, n, with: paid, era }, button, n),
    exchange: (prize, button) => void send({ do: "exchange", prize }, button, null),
    leave,
    done,
    next,
    toEnd() {
      if (show) jump(show.end);
    },
    picture: (prize) => pic.picture(prize),
  });
  const pic = makeGrovePicture(sprites, art, ui, { person: () => person, pool: () => pool, banner });
  function done(): void {
    if (state() !== "end") return;
    show = null;
    sfx.close();
    mark();
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

  // ---------------------------------------------------------------- a pull

  const shownOf = (drawn: PullsNote): Shown => ({
    note: drawn,
    says: revealOf(catalogOf(view()), drawn, banners),
    finish: FINISH[tierOf(drawn.rarity)],
    tones: tonesOf(RARITIES[drawn.rarity].colour),
    pic: pic.picture(drawn.prize),
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
    pic.forget();
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
    settle();
    if ("refused" in answer) {
      sfx.no();
      ui.said(refusedLine(answer.refused));
      // Shown other prizes than the pool gives now: Leaf's are asked for, and shown.
      if (answer.refused === "prizes_changed") void leaf.refresh().then(settle);
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
    if (state() === "banner") hooks.go({ to: "town" });
  }

  ui.canvas.addEventListener("pointerdown", () => {
    if (show && t >= show.tell) next();
  });

  return {
    open,
    wayOut() {
      sfx.close();
      mark();
      return [];
    },
    nightFrom: 0,
    putAway() {
      ui.root.hidden = true;
      hush(false);
    },
    putOn() {
      show = null;
      // The banner is the first thing seen, when there is one.
      pool = banner()?.id ?? GROVE;
      idle = 0;
      hush(true);
      pic.fit();
      ui.said(null);
      ui.root.hidden = false;
      mark();
      ui.tick();
    },
    bounds: { w: 320, top: 0, bottom: 180 },
    resize: pic.resize,
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
      if (play) pic.paint(show, t, stood, idle);
      // Night lifts on the Grove as it does on a place the town draws.
      ui.root.style.opacity = String(1 - G.dark);
      return pic.under.c;
    },
    words: () => undefined,
    tap: () => false,
    point: () => null,
    act: next,
    // The Grove keeps Escape for itself: it always puts away, goes on, or leaves.
    back() {
      if (ui.panelOpen()) ui.closePanel();
      else if (state() === "banner") leave();
      else if (state() === "ceremony") next();
      else done();
      return true;
    },
    key(act) {
      if (act !== "right" || !show) return false;
      next();
      return true;
    },
    drag: () => undefined,
    release: () => undefined,
    cancel: () => undefined,
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
