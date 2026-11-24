/**
 * Small sounds, made on the spot from plain tones and hiss. Nothing plays until the first touch.
 * `sfx` is the set every game shares; a game adds its own from `tone` and `noise`.
 *
 * How loud, and whether the sound is on, are the player's settings (`settings.ts`), shared by every
 * page. Each sound belongs to a kind the player can switch off on its own (`SoundKind`): a sound asks
 * `heard` with its kind's id before it plays. The menu lists the kinds (`menu.ts`).
 */
import { type Settings, settings } from "./settings.ts";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hiss: AudioBuffer | null = null;
/**
 * Inside `hush`, nothing plays; inside `sample`, a kind switched off plays all the same; inside
 * `within`, every sound is of that kind too (`kind`).
 */
const playing: { hushed: boolean; sampling: boolean; kind: string | null } = {
  hushed: false,
  sampling: false,
  kind: null,
};

/** How loud the games have always been, at the top of the volume. */
const FULL = 0.5;

/**
 * The master gain for the settings: none while muted, and for the volume, the square of its share of
 * the loudest, so that the slider sounds even all the way down: 100% is as loud as ever, 50% about
 * 12 dB quieter, 0% silent.
 */
export const gainOf = (s: Pick<Settings, "volume" | "muted">): number =>
  s.muted ? 0 : FULL * (Math.max(0, Math.min(100, s.volume)) / 100) ** 2;

// The master gain follows the settings, this page's changes and other pages' alike.
settings.listen((now) => {
  if (master && ctx) master.gain.setTargetAtTime(gainOf(now), ctx.currentTime, 0.02);
});

/** Call on any touch or key: browsers only allow sound once the player has done something. */
export function unlock(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = gainOf(settings.now);
    master.connect(ctx.destination);
    hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = hiss.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Whether sound can be heard at all here: started (`unlock`), and neither muted nor at no volume. */
export const audible = (): boolean => ctx !== null && ctx.state === "running" && gainOf(settings.now) > 0;

/** Does `f` without a sound: whatever it plays is not heard. */
export function hush(f: () => void): void {
  const was = playing.hushed;
  playing.hushed = true;
  try {
    f();
  } finally {
    playing.hushed = was;
  }
}

/**
 * A kind of sound the player can switch off on its own: its id (`game.kind`), its name in the menu,
 * and how to hear one of it there (`sample`, played even while the kind is off).
 */
export interface SoundKind {
  readonly id: string;
  readonly name: string;
  readonly sample: () => void;
}

/** Whether a sound of a kind should play: its kind is not switched off, or it is being sampled. */
export const heard = (kind: string): boolean => playing.sampling || !settings.now.quiet.has(kind);

/** Plays `f` as a sample from the menu: its kind is heard even if switched off; the volume and mute still hold. */
export function sample(f: () => void): void {
  const was = playing.sampling;
  playing.sampling = true;
  try {
    f();
  } finally {
    playing.sampling = was;
  }
}

/**
 * Does `f`, its sounds of the kind `kind` as well as their own: while that kind is off, none of them
 * is heard, and whatever else `f` does (a picture, a move) goes on. For a place that plays its own
 * tones and hiss among what it draws.
 */
export function within(kind: string, f: () => void): void {
  const was = playing.kind;
  playing.kind = kind;
  try {
    f();
  } finally {
    playing.kind = was;
  }
}

/** Whether a tone or a hiss would be heard now. */
const silent = (): boolean =>
  playing.hushed || gainOf(settings.now) === 0 || (playing.kind !== null && !heard(playing.kind));

export interface Tone {
  type?: OscillatorType;
  vol?: number;
  /** Where the pitch ends up, as a multiple of where it began. */
  slide?: number;
  /** Seconds from now. */
  at?: number;
  attack?: number;
}

export function tone(freq: number, dur: number, o: Tone = {}): void {
  if (!ctx || !master || silent()) return;
  const t0 = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(freq * o.slide, t0 + dur);
  const vol = o.vol ?? 0.2;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function noise(
  dur: number,
  freq: number,
  o: { vol?: number; at?: number; slide?: number; q?: number } = {},
): void {
  if (!ctx || !master || !hiss || silent()) return;
  const t0 = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = hiss;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = o.q ?? 1.2;
  f.frequency.setValueAtTime(freq, t0);
  if (o.slide) f.frequency.exponentialRampToValueAtTime(freq * o.slide, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

/** A note some semitones above A. */
export const note = (semi: number): number => 440 * 2 ** (semi / 12);
/** Notes that always sound well together. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
export const penta = (i: number): number => note(PENTA[((i % PENTA.length) + PENTA.length) % PENTA.length] ?? 0);

/** The kinds of the sounds every game shares, by id. */
const KIT = {
  buttons: "kit.buttons",
  coins: "kit.coins",
  cheers: "kit.cheers",
  sparkles: "kit.sparkles",
  steps: "kit.steps",
  voices: "kit.voices",
  night: "kit.night",
  knocks: "kit.knocks",
  leaves: "kit.leaves",
  notes: "kit.notes",
} as const;

let stepFlip = false;

export const sfx = {
  step(): void {
    if (!heard(KIT.steps)) return;
    stepFlip = !stepFlip;
    noise(0.05, stepFlip ? 900 : 700, { vol: 0.035, q: 2 });
  },
  tap(): void {
    if (!heard(KIT.buttons)) return;
    tone(note(12), 0.06, { vol: 0.09, type: "sine" });
  },
  open(): void {
    if (!heard(KIT.buttons)) return;
    tone(note(3), 0.09, { vol: 0.12 });
    tone(note(10), 0.14, { vol: 0.12, at: 0.07 });
  },
  close(): void {
    if (!heard(KIT.buttons)) return;
    tone(note(10), 0.08, { vol: 0.1 });
    tone(note(3), 0.12, { vol: 0.1, at: 0.06 });
  },
  coin(i = 0): void {
    if (!heard(KIT.coins)) return;
    tone(note(19 + (i % 5)), 0.09, { vol: 0.09, type: "square" });
    tone(note(26 + (i % 5)), 0.16, { vol: 0.07, type: "square", at: 0.05 });
  },
  leaf(i = 0): void {
    if (!heard(KIT.coins)) return;
    tone(penta(4 + i), 0.22, { vol: 0.12, type: "sine" });
    tone(penta(4 + i) * 2, 0.16, { vol: 0.04, type: "sine", at: 0.02 });
  },
  buy(): void {
    if (!heard(KIT.coins)) return;
    noise(0.12, 5200, { vol: 0.08, q: 3 });
    tone(note(14), 0.1, { vol: 0.13, type: "square" });
    tone(note(21), 0.3, { vol: 0.13, type: "square", at: 0.09 });
    tone(note(26), 0.4, { vol: 0.06, type: "sine", at: 0.09 });
  },
  no(): void {
    if (!heard(KIT.buttons)) return;
    tone(note(-14), 0.16, { vol: 0.14, type: "sawtooth", slide: 0.8 });
  },
  cheer(): void {
    if (!heard(KIT.cheers)) return;
    for (let i = 0; i < 5; i++) tone(penta(3 + i), 0.14, { vol: 0.1, at: i * 0.06 });
  },
  horn(): void {
    if (!heard(KIT.cheers)) return;
    tone(note(-19), 0.5, { vol: 0.16, type: "sawtooth", attack: 0.06 });
    tone(note(-12), 0.8, { vol: 0.16, type: "sawtooth", at: 0.42, attack: 0.06 });
  },
  bell(): void {
    if (!heard(KIT.cheers)) return;
    for (const [f, v] of [
      [note(12), 0.16],
      [note(12) * 2.4, 0.06],
      [note(12) * 3.9, 0.03],
    ] as const)
      tone(f, 1.4, { vol: v, type: "sine" });
  },
  ding(): void {
    if (!heard(KIT.cheers)) return;
    tone(note(24), 0.5, { vol: 0.14, type: "sine" });
    tone(note(24) * 2.7, 0.3, { vol: 0.04, type: "sine" });
  },
  fanfare(): void {
    if (!heard(KIT.cheers)) return;
    [0, 4, 7, 12].forEach((s, i) => {
      tone(note(s), i === 3 ? 0.6 : 0.16, { vol: 0.13, type: "square", at: i * 0.14 });
      tone(note(s - 12), i === 3 ? 0.6 : 0.16, { vol: 0.08, at: i * 0.14 });
    });
  },
  levelUp(): void {
    if (!heard(KIT.cheers)) return;
    for (let i = 0; i < 7; i++) tone(penta(2 + i), 0.16, { vol: 0.1, type: "square", at: i * 0.05 });
  },
  clack(): void {
    if (!heard(KIT.knocks)) return;
    for (let i = 0; i < 3; i++) noise(0.03, 2600, { vol: 0.13, q: 6, at: i * 0.07 });
  },
  plop(): void {
    if (!heard(KIT.knocks)) return;
    tone(520, 0.14, { vol: 0.16, type: "sine", slide: 0.35 });
    noise(0.1, 1400, { vol: 0.03, at: 0.02 });
  },
  rustle(): void {
    if (!heard(KIT.leaves)) return;
    noise(0.22, 3600, { vol: 0.07, slide: 0.6, q: 0.7 });
  },
  knock(): void {
    if (!heard(KIT.knocks)) return;
    tone(120, 0.12, { vol: 0.25, type: "sine", slide: 0.6 });
    noise(0.04, 500, { vol: 0.1 });
  },
  whoosh(): void {
    if (!heard(KIT.leaves)) return;
    noise(0.5, 500, { vol: 0.14, slide: 5, q: 0.8 });
  },
  twinkle(): void {
    if (!heard(KIT.sparkles)) return;
    for (let i = 0; i < 6; i++) tone(penta(5 + ((i * 3) % 5)), 0.2, { vol: 0.06, type: "sine", at: i * 0.07 });
  },
  boing(): void {
    if (!heard(KIT.knocks)) return;
    tone(180, 0.22, { vol: 0.16, type: "sine", slide: 2.6 });
  },
  pluck(i: number): void {
    if (!heard(KIT.notes)) return;
    tone(penta(i), 0.25, { vol: 0.1, type: "triangle" });
  },
  paper(): void {
    if (!heard(KIT.buttons)) return;
    noise(0.09, 4200, { vol: 0.07, q: 1 });
    noise(0.07, 3000, { vol: 0.05, q: 1, at: 0.08 });
  },
  pop(): void {
    if (!heard(KIT.buttons)) return;
    tone(700, 0.07, { vol: 0.12, type: "sine", slide: 1.8 });
  },
  clank(): void {
    if (!heard(KIT.knocks)) return;
    tone(note(-5), 0.08, { vol: 0.1, type: "square" });
    noise(0.06, 3000, { vol: 0.08, q: 4 });
  },
  hoo(): void {
    if (!heard(KIT.night)) return;
    tone(note(-9), 0.25, { vol: 0.1, type: "sine", attack: 0.05 });
    tone(note(-9), 0.4, { vol: 0.1, type: "sine", attack: 0.05, at: 0.32 });
  },
  cricket(): void {
    if (!heard(KIT.night)) return;
    for (let i = 0; i < 3; i++) tone(4300, 0.04, { vol: 0.015, type: "sine", at: i * 0.07 });
  },
  crackle(): void {
    if (!heard(KIT.night)) return;
    noise(0.03, 1800 + Math.random() * 1500, { vol: 0.03, q: 3 });
  },
  sit(): void {
    if (!heard(KIT.steps)) return;
    tone(note(-2), 0.1, { vol: 0.1, type: "sine", slide: 0.7 });
  },
  star(): void {
    if (!heard(KIT.sparkles)) return;
    tone(note(28), 0.5, { vol: 0.06, type: "sine", slide: 0.5 });
  },
  /** A few blips at somebody's own pitch: speaking, more or less. */
  talk(voice: number, words: number): void {
    if (!heard(KIT.voices)) return;
    for (let i = 0; i < Math.min(5, 2 + words); i++)
      tone(voice * (0.85 + Math.random() * 0.4), 0.05, { vol: 0.045, type: "square", at: i * 0.065 });
  },
};

/** The kinds of the sounds every game shares, as the menu lists them: switching one off does so in every game. */
export const SHARED_SOUNDS: readonly SoundKind[] = [
  { id: KIT.buttons, name: "Buttons", sample: () => sfx.open() },
  { id: KIT.coins, name: "Coins and Leaf", sample: () => sfx.coin() },
  { id: KIT.cheers, name: "Cheers and fanfares", sample: () => sfx.fanfare() },
  { id: KIT.sparkles, name: "Sparkles", sample: () => sfx.twinkle() },
  { id: KIT.steps, name: "Footsteps", sample: () => sfx.step() },
  { id: KIT.voices, name: "Voices", sample: () => sfx.talk(260, 4) },
  { id: KIT.night, name: "Night sounds", sample: () => sfx.hoo() },
  { id: KIT.knocks, name: "Knocks and thuds", sample: () => sfx.knock() },
  { id: KIT.leaves, name: "Leaves and wind", sample: () => sfx.rustle() },
  { id: KIT.notes, name: "Plucked notes", sample: () => [0, 2, 4].forEach((i) => sfx.pluck(i)) },
];
