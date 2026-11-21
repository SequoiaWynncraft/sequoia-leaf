/**
 * Small sounds, made on the spot with Web Audio: no files. Nothing plays until the first touch, and
 * the mute button is remembered.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fireGain: GainNode | null = null;
let seaGain: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem("hub-map.muted") === "1";
} catch {
  // No storage: start with sound on.
}

export const isMuted = (): boolean => muted;
export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.03);
  try {
    localStorage.setItem("hub-map.muted", m ? "1" : "0");
  } catch {
    // Not remembered, then.
  }
}

/** Called on the first touch: from here on there is sound. */
export function unlock(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);
  ambience(ctx, master);
}

function noiseBuffer(ac: AudioContext, seconds: number, fill: (i: number, n: number) => number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fill(i, n);
  return buf;
}

/** The evening behind everything: a slow sea, a fire that is louder the nearer the map is to it, crickets. */
function ambience(ac: AudioContext, out: GainNode): void {
  let last = 0;
  const sea = ac.createBufferSource();
  sea.buffer = noiseBuffer(ac, 4, () => {
    last = (last + (Math.random() * 2 - 1) * 0.04) * 0.985;
    return last * 5;
  });
  sea.loop = true;
  const low = ac.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 520;
  seaGain = ac.createGain();
  seaGain.gain.value = 0;
  const swell = ac.createGain();
  swell.gain.value = 0.6;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.13;
  const depth = ac.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(swell.gain);
  sea.connect(low).connect(swell).connect(seaGain).connect(out);
  sea.start();
  lfo.start();

  let env = 0;
  const fire = ac.createBufferSource();
  fire.buffer = noiseBuffer(ac, 3, () => {
    if (Math.random() < 0.0009) env = 0.5 + Math.random() * 0.5;
    env *= 0.9965;
    return (Math.random() * 2 - 1) * env;
  });
  fire.loop = true;
  const high = ac.createBiquadFilter();
  high.type = "bandpass";
  high.frequency.value = 2400;
  high.Q.value = 0.7;
  fireGain = ac.createGain();
  fireGain.gain.value = 0;
  fire.connect(high).connect(fireGain).connect(out);
  fire.start();

  const chirp = (): void => {
    if (!ctx) return;
    const t = ac.currentTime + 0.05;
    const f = 3900 + Math.random() * 700;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) tone(f, t + k * 0.07, 0.045, "sine", 0.012);
    setTimeout(chirp, 1800 + Math.random() * 4200);
  };
  setTimeout(chirp, 2500);
}

/** How near the fire and the sea are, 0..1 each; the view says, every so often. */
export function setScene(fire: number, sea: number): void {
  if (!ctx) return;
  fireGain?.gain.setTargetAtTime(fire * 0.16, ctx.currentTime, 0.4);
  seaGain?.gain.setTargetAtTime(sea * 0.1, ctx.currentTime, 0.6);
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slide = 0): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function hiss(at: number, dur: number, vol: number, freq: number, q = 1): void {
  if (!ctx || !master) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur, () => Math.random() * 2 - 1);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master);
  src.start(at);
}

/** A run of notes, `gap` seconds apart. */
function run(notes: readonly number[], gap: number, dur: number, type: OscillatorType, vol: number): void {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  notes.forEach((f, i) => tone(f, t + i * gap, dur, type, vol));
}

const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.5;
const G6 = 1567.98;

export const sfx = {
  tap: (): void => run([A5], 0, 0.07, "triangle", 0.1),
  soft: (): void => run([E5], 0, 0.06, "sine", 0.07),
  step: (): void => {
    if (ctx) hiss(ctx.currentTime, 0.04, 0.035, 900 + Math.random() * 400, 1.5);
  },
  go: (): void => run([G5, C6], 0.06, 0.1, "triangle", 0.1),
  arrive: (): void => run([C6, E6], 0.07, 0.14, "triangle", 0.11),
  open: (): void => run([E5, A5, D6], 0.05, 0.16, "sine", 0.1),
  close: (): void => run([A5, E5], 0.05, 0.1, "sine", 0.07),
  coin: (): void => run([E6, G6], 0.05, 0.11, "square", 0.045),
  leaf: (): void => run([C6, E6, G6], 0.06, 0.3, "sine", 0.1),
  lantern: (): void => {
    run([G5, D6], 0.11, 0.7, "sine", 0.12);
    run([G5 * 2.01], 0, 0.5, "sine", 0.03);
  },
  ring: (): void => run([C5, E5, G5, C6], 0.07, 0.35, "triangle", 0.1),
  banner: (): void => run([C5, G5, C6, E6, G6], 0.09, 0.4, "triangle", 0.11),
  down: (): void => run([G5, E5, C5], 0.12, 0.35, "sine", 0.08),
  level: (): void => run([E5, G5, A5, C6, E6], 0.055, 0.22, "square", 0.05),
  crab: (): void => {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let k = 0; k < 3; k++) hiss(t + k * 0.05, 0.03, 0.12, 2600 + k * 500, 6);
  },
  no: (): void => run([D5, C5 * 0.94], 0.08, 0.14, "square", 0.05),
  emote: (): void => run([D6, G6], 0.05, 0.12, "sine", 0.09),
  wave: (): void => run([G5, A5, G5], 0.06, 0.1, "triangle", 0.08),
  buy: (): void => run([G5, C6, E6, G6, C6 * 2], 0.06, 0.25, "triangle", 0.1),
  thud: (): void => {
    if (!ctx) return;
    tone(150, ctx.currentTime, 0.18, "sine", 0.3, 0.4);
    hiss(ctx.currentTime, 0.1, 0.1, 500, 0.8);
  },
  splash: (): void => {
    if (!ctx) return;
    hiss(ctx.currentTime, 0.22, 0.12, 1500, 0.9);
    tone(700, ctx.currentTime, 0.12, "sine", 0.06, 2);
  },
  rustle: (): void => {
    if (!ctx) return;
    hiss(ctx.currentTime, 0.2, 0.08, 4200, 0.8);
    hiss(ctx.currentTime + 0.07, 0.16, 0.06, 5200, 0.8);
  },
  sweep: (): void => {
    if (ctx) hiss(ctx.currentTime, 0.35, 0.05, 1200, 0.5);
  },
  pop: (): void => run([A5 * 1.5], 0, 0.08, "sine", 0.1),
  tick: (): void => run([C6 * 2], 0, 0.03, "square", 0.03),
  stone: (): void => run([C5 / 2, G5 / 2], 0.1, 0.5, "sine", 0.12),
  jingle: (): void => run([E6, G6, E6, C6 * 2], 0.08, 0.3, "sine", 0.06),
};
