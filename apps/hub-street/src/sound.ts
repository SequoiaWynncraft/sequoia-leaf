/**
 * Small sounds, all made on the spot from tones and hiss. Nothing plays until the first touch,
 * because a page may not make noise before then, and because nobody wants it to.
 */

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let muted = false;
let hiss: AudioBuffer | null = null;

try {
  muted = localStorage.getItem("hub-street.muted") === "1";
} catch {
  // No memory of the choice; sound starts on.
}

export const isMuted = (): boolean => muted;

/** Call from a touch or a key press: the first one wakes the sound. */
export function wake(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = muted ? 0 : 0.5;
    out.connect(ctx.destination);
    hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = hiss.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

export function setMuted(next: boolean): void {
  muted = next;
  if (out && ctx) out.gain.setTargetAtTime(next ? 0 : 0.5, ctx.currentTime, 0.03);
  try {
    localStorage.setItem("hub-street.muted", next ? "1" : "0");
  } catch {
    // Not remembered this time.
  }
}

type Wave = "sine" | "triangle" | "square" | "sawtooth";

/** One note: from `from` hertz, sliding to `to` if given, fading out over `long` seconds. */
function tone(from: number, long: number, wave: Wave, loud: number, after = 0, to = from): void {
  if (!ctx || !out) return;
  const t = ctx.currentTime + after;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + long);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(loud, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0005, t + long);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + long + 0.02);
}

/** A puff of hiss through a filter: rustles, steps, crackles. */
function puff(long: number, loud: number, pitch: number, after = 0, kind: BiquadFilterType = "bandpass"): void {
  if (!ctx || !out || !hiss) return;
  const t = ctx.currentTime + after;
  const src = ctx.createBufferSource();
  src.buffer = hiss;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.value = pitch;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(loud, t);
  gain.gain.exponentialRampToValueAtTime(0.0005, t + long);
  src.connect(filter).connect(gain).connect(out);
  src.start(t, Math.random() * 0.8, long + 0.05);
}

const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568];
const note = (i: number): number => SCALE[((i % SCALE.length) + SCALE.length) % SCALE.length] ?? 880;

export const sfx = {
  step(alt: boolean): void {
    puff(0.05, 0.05, alt ? 240 : 300, 0, "lowpass");
  },
  tap(): void {
    tone(880, 0.05, "triangle", 0.06);
  },
  open(): void {
    tone(note(0), 0.12, "triangle", 0.1);
    tone(note(3), 0.16, "triangle", 0.1, 0.07);
  },
  close(): void {
    tone(note(3), 0.1, "triangle", 0.08);
    tone(note(0), 0.14, "triangle", 0.08, 0.06);
  },
  bell(): void {
    tone(1318.5, 0.7, "sine", 0.12);
    tone(1975.5, 0.5, "sine", 0.06);
    tone(2637, 0.3, "sine", 0.03, 0.01);
  },
  /** A lantern is lit: three notes going up, soft. */
  chime(): void {
    [2, 4, 6].forEach((n, i) => tone(note(n), 0.5, "sine", 0.1, i * 0.09));
  },
  /** A banner is hung: a small fanfare. */
  fanfare(): void {
    const seq = [0, 0, 3, 5];
    seq.forEach((n, i) => {
      tone(note(n) / 2, i === 3 ? 0.5 : 0.14, "square", 0.05, i * 0.13);
      tone(note(n), i === 3 ? 0.5 : 0.14, "triangle", 0.08, i * 0.13);
    });
  },
  levelUp(): void {
    [0, 2, 3, 5, 7].forEach((n, i) => tone(note(n), 0.22, "triangle", 0.09, i * 0.06));
  },
  coin(after = 0): void {
    tone(987.8, 0.07, "square", 0.04, after);
    tone(1318.5, 0.22, "square", 0.04, after + 0.06);
  },
  /** A leaf lands in the purse: each one a step higher than the last. */
  leaf(i: number, after = 0): void {
    tone(note(i), 0.18, "triangle", 0.1, after);
    tone(note(i) * 2, 0.1, "sine", 0.03, after);
  },
  buy(): void {
    puff(0.04, 0.12, 3000, 0, "highpass");
    tone(1568, 0.5, "sine", 0.1, 0.03);
    tone(2093, 0.6, "sine", 0.08, 0.1);
  },
  nope(): void {
    tone(196, 0.12, "square", 0.05);
    tone(155.6, 0.2, "square", 0.05, 0.1);
  },
  click(): void {
    tone(1900, 0.02, "square", 0.04);
    tone(2300, 0.02, "square", 0.04, 0.05);
  },
  plop(): void {
    tone(620, 0.16, "sine", 0.12, 0, 190);
    puff(0.12, 0.03, 900, 0.02);
  },
  rustle(): void {
    puff(0.12, 0.07, 3200);
    puff(0.1, 0.05, 2400, 0.06);
  },
  knock(): void {
    tone(190, 0.09, "sine", 0.2, 0, 120);
    puff(0.02, 0.08, 800);
  },
  boing(): void {
    tone(260, 0.2, "sine", 0.1, 0, 520);
  },
  whoosh(): void {
    puff(0.3, 0.07, 700, 0, "lowpass");
  },
  crackle(loud: number): void {
    puff(0.03, loud, 1800 + Math.random() * 2500, 0, "highpass");
  },
  flare(): void {
    puff(0.4, 0.1, 500, 0, "lowpass");
    for (let i = 0; i < 5; i++) puff(0.03, 0.06, 2500 + Math.random() * 2000, 0.03 + Math.random() * 0.3, "highpass");
  },
  clank(): void {
    tone(310, 0.12, "square", 0.05, 0, 290);
    tone(466, 0.2, "triangle", 0.07, 0.01);
    puff(0.05, 0.07, 2600);
  },
  cricket(): void {
    for (let i = 0; i < 3; i++) tone(4200, 0.03, "sine", 0.012, i * 0.06);
  },
  /** A few quick notes at a speaker's own pitch, in place of a voice. */
  speak(pitch: number, words: number): void {
    const n = Math.min(6, Math.max(2, words));
    for (let i = 0; i < n; i++) tone(pitch * (1 + (((i * 7) % 5) - 2) * 0.06), 0.05, "triangle", 0.035, i * 0.065);
  },
  cheer(): void {
    [3, 5, 7].forEach((n, i) => tone(note(n), 0.14, "triangle", 0.06, i * 0.05));
  },
  sad(): void {
    tone(392, 0.25, "triangle", 0.08, 0, 370);
    tone(311, 0.45, "triangle", 0.08, 0.22, 290);
  },
  sparkle(): void {
    [6, 8, 7, 8].forEach((n, i) => tone(note(n) * 2, 0.12, "sine", 0.03, i * 0.04));
  },
  sit(): void {
    tone(220, 0.1, "sine", 0.09, 0, 150);
  },
  song(): void {
    [0, 2, 4, 2, 5, 4].forEach((n, i) => tone(note(n), 0.2, "triangle", 0.07, i * 0.17));
  },
  laugh(): void {
    [5, 4, 5, 4, 3].forEach((n, i) => tone(note(n), 0.07, "triangle", 0.06, i * 0.08));
  },
};
