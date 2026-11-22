/**
 * Small sounds, made on the spot from plain tones and hiss. Nothing plays until the first touch.
 * `sfx` is the set every game shares; a game adds its own from `tone` and `noise`.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hiss: AudioBuffer | null = null;
let muted = false;
/** Inside `hush`: nothing plays. */
let hushed = false;

try {
  muted = localStorage.getItem("town.muted") === "1";
} catch {
  muted = false;
}

/** Call on any touch or key: browsers only allow sound once the player has done something. */
export function unlock(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = hiss.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
  try {
    localStorage.setItem("town.muted", m ? "1" : "0");
  } catch {
    // Nowhere to remember it; it still holds for this visit.
  }
}

/** Does `f` without a sound: whatever it plays is not heard. */
export function hush(f: () => void): void {
  const was = hushed;
  hushed = true;
  try {
    f();
  } finally {
    hushed = was;
  }
}

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
  if (!ctx || !master || muted || hushed) return;
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
  if (!ctx || !master || !hiss || muted || hushed) return;
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

let stepFlip = false;

export const sfx = {
  step(): void {
    stepFlip = !stepFlip;
    noise(0.05, stepFlip ? 900 : 700, { vol: 0.035, q: 2 });
  },
  tap(): void {
    tone(note(12), 0.06, { vol: 0.09, type: "sine" });
  },
  open(): void {
    tone(note(3), 0.09, { vol: 0.12 });
    tone(note(10), 0.14, { vol: 0.12, at: 0.07 });
  },
  close(): void {
    tone(note(10), 0.08, { vol: 0.1 });
    tone(note(3), 0.12, { vol: 0.1, at: 0.06 });
  },
  coin(i = 0): void {
    tone(note(19 + (i % 5)), 0.09, { vol: 0.09, type: "square" });
    tone(note(26 + (i % 5)), 0.16, { vol: 0.07, type: "square", at: 0.05 });
  },
  leaf(i = 0): void {
    tone(penta(4 + i), 0.22, { vol: 0.12, type: "sine" });
    tone(penta(4 + i) * 2, 0.16, { vol: 0.04, type: "sine", at: 0.02 });
  },
  buy(): void {
    noise(0.12, 5200, { vol: 0.08, q: 3 });
    tone(note(14), 0.1, { vol: 0.13, type: "square" });
    tone(note(21), 0.3, { vol: 0.13, type: "square", at: 0.09 });
    tone(note(26), 0.4, { vol: 0.06, type: "sine", at: 0.09 });
  },
  no(): void {
    tone(note(-14), 0.16, { vol: 0.14, type: "sawtooth", slide: 0.8 });
  },
  cheer(): void {
    for (let i = 0; i < 5; i++) tone(penta(3 + i), 0.14, { vol: 0.1, at: i * 0.06 });
  },
  horn(): void {
    tone(note(-19), 0.5, { vol: 0.16, type: "sawtooth", attack: 0.06 });
    tone(note(-12), 0.8, { vol: 0.16, type: "sawtooth", at: 0.42, attack: 0.06 });
  },
  bell(): void {
    for (const [f, v] of [
      [note(12), 0.16],
      [note(12) * 2.4, 0.06],
      [note(12) * 3.9, 0.03],
    ] as const)
      tone(f, 1.4, { vol: v, type: "sine" });
  },
  ding(): void {
    tone(note(24), 0.5, { vol: 0.14, type: "sine" });
    tone(note(24) * 2.7, 0.3, { vol: 0.04, type: "sine" });
  },
  fanfare(): void {
    [0, 4, 7, 12].forEach((s, i) => {
      tone(note(s), i === 3 ? 0.6 : 0.16, { vol: 0.13, type: "square", at: i * 0.14 });
      tone(note(s - 12), i === 3 ? 0.6 : 0.16, { vol: 0.08, at: i * 0.14 });
    });
  },
  levelUp(): void {
    for (let i = 0; i < 7; i++) tone(penta(2 + i), 0.16, { vol: 0.1, type: "square", at: i * 0.05 });
  },
  clack(): void {
    for (let i = 0; i < 3; i++) noise(0.03, 2600, { vol: 0.13, q: 6, at: i * 0.07 });
  },
  plop(): void {
    tone(520, 0.14, { vol: 0.16, type: "sine", slide: 0.35 });
    noise(0.1, 1400, { vol: 0.03, at: 0.02 });
  },
  rustle(): void {
    noise(0.22, 3600, { vol: 0.07, slide: 0.6, q: 0.7 });
  },
  knock(): void {
    tone(120, 0.12, { vol: 0.25, type: "sine", slide: 0.6 });
    noise(0.04, 500, { vol: 0.1 });
  },
  whoosh(): void {
    noise(0.5, 500, { vol: 0.14, slide: 5, q: 0.8 });
  },
  twinkle(): void {
    for (let i = 0; i < 6; i++) tone(penta(5 + ((i * 3) % 5)), 0.2, { vol: 0.06, type: "sine", at: i * 0.07 });
  },
  boing(): void {
    tone(180, 0.22, { vol: 0.16, type: "sine", slide: 2.6 });
  },
  pluck(i: number): void {
    tone(penta(i), 0.25, { vol: 0.1, type: "triangle" });
  },
  paper(): void {
    noise(0.09, 4200, { vol: 0.07, q: 1 });
    noise(0.07, 3000, { vol: 0.05, q: 1, at: 0.08 });
  },
  pop(): void {
    tone(700, 0.07, { vol: 0.12, type: "sine", slide: 1.8 });
  },
  clank(): void {
    tone(note(-5), 0.08, { vol: 0.1, type: "square" });
    noise(0.06, 3000, { vol: 0.08, q: 4 });
  },
  hoo(): void {
    tone(note(-9), 0.25, { vol: 0.1, type: "sine", attack: 0.05 });
    tone(note(-9), 0.4, { vol: 0.1, type: "sine", attack: 0.05, at: 0.32 });
  },
  cricket(): void {
    for (let i = 0; i < 3; i++) tone(4300, 0.04, { vol: 0.015, type: "sine", at: i * 0.07 });
  },
  crackle(): void {
    noise(0.03, 1800 + Math.random() * 1500, { vol: 0.03, q: 3 });
  },
  sit(): void {
    tone(note(-2), 0.1, { vol: 0.1, type: "sine", slide: 0.7 });
  },
  star(): void {
    tone(note(28), 0.5, { vol: 0.06, type: "sine", slide: 0.5 });
  },
  /** A few blips at somebody's own pitch: speaking, more or less. */
  talk(voice: number, words: number): void {
    for (let i = 0; i < Math.min(5, 2 + words); i++)
      tone(voice * (0.85 + Math.random() * 0.4), 0.05, { vol: 0.045, type: "square", at: i * 0.065 });
  },
};
