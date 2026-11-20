/**
 * The grove's small sounds, made here from plain tones and noise: no recordings. Quiet by design,
 * and silent until the player has touched the page (a browser's own rule) or if they turn sound off.
 */
type Shape = "sine" | "triangle" | "square";
let ctx: AudioContext | null = null;
let on = true;
try {
  on = localStorage.getItem("grove.sound") !== "off";
} catch {
  // No storage: sound stays on for this visit.
}
export const sound = {
  get on(): boolean {
    return on;
  },
  set on(v: boolean) {
    on = v;
    try {
      localStorage.setItem("grove.sound", v ? "on" : "off");
    } catch {
      // Not kept; it still applies now.
    }
  },
};
const audio = (): AudioContext | null => {
  if (!on) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};
/** One note: from `f0` to `f1` hertz over `secs`, at `vol`, after `wait` seconds. */
function tone(f0: number, f1: number, secs: number, vol: number, shape: Shape = "sine", wait = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + wait;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = shape;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + secs);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + secs + 0.02);
}
/** A breath of noise through a filter: rain, a rustle, a crackle. */
function hiss(secs: number, vol: number, low: number, high: number, wait = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + wait;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * secs), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(low, t);
  f.frequency.exponentialRampToValueAtTime(high, t + secs);
  f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, secs / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}
const NOTES = [392, 440, 523, 587, 659, 784, 880, 1047];
export const sfx = {
  /** A drop of Sap into the purse. */
  sap: (): void => tone(880 + Math.random() * 200, 1320, 0.09, 0.05, "triangle"),
  rustle: (): void => hiss(0.35, 0.07, 2600, 900),
  pick: (): void => {
    tone(660, 990, 0.08, 0.06, "triangle");
    tone(990, 1320, 0.1, 0.05, "triangle", 0.07);
  },
  pet: (): void => {
    tone(700, 1050, 0.09, 0.05, "sine");
    tone(1050, 1400, 0.12, 0.05, "sine", 0.08);
  },
  thud: (): void => tone(160, 70, 0.14, 0.12, "sine"),
  tok: (): void => tone(420, 240, 0.06, 0.09, "square"),
  crackle: (): void => {
    for (let i = 0; i < 5; i++) hiss(0.05, 0.08, 1800 + Math.random() * 1500, 900, i * 0.06 + Math.random() * 0.03);
    tone(140, 90, 0.3, 0.06, "triangle");
  },
  rain: (secs: number): void => hiss(secs, 0.06, 5200, 3600),
  whoosh: (): void => hiss(0.45, 0.07, 500, 2600),
  /** A step up the rank ladder as a cone burns: higher each time. */
  step: (n: number): void => {
    tone(NOTES[Math.min(n, NOTES.length - 1)]!, NOTES[Math.min(n, NOTES.length - 1)]! * 1.01, 0.22, 0.08, "triangle");
    tone(90 + n * 12, 60, 0.18, 0.1, "sine");
  },
  /** The cone bursts: a chord, richer for a higher rank. */
  reveal: (rank: number): void => {
    hiss(0.5, 0.09, 900, 5000);
    const chord = [523, 659, 784, 1047, 1319, 1568, 2093].slice(0, 3 + Math.min(4, rank));
    chord.forEach((f, i) => tone(f, f, 0.9 + rank * 0.12, 0.05, "triangle", i * 0.055));
  },
  /** The tree grows: a slow rise and a settling chord. */
  grow: (): void => {
    tone(110, 330, 1.3, 0.07, "triangle");
    hiss(1.3, 0.05, 700, 2600);
    [392, 523, 659, 784].forEach((f, i) => tone(f, f, 1.1, 0.045, "triangle", 1.25 + i * 0.07));
  },
  no: (): void => tone(220, 180, 0.12, 0.05, "square"),
};
