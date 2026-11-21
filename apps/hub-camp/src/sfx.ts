/**
 * Small sounds, all made from tones and hiss: nothing is loaded. Silent until the first touch, and
 * one switch turns the lot off.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function unlock(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  } else if (ctx.state === "suspended") void ctx.resume();
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
}
export const isMuted = (): boolean => muted;

interface Tone {
  type?: OscillatorType;
  vol?: number;
  at?: number;
  to?: number;
  attack?: number;
}
function tone(freq: number, dur: number, o: Tone = {}): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  const vol = o.vol ?? 0.14;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.006));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

let hissBuf: AudioBuffer | null = null;
function hiss(dur: number, o: { vol?: number; at?: number; freq?: number; q?: number; to?: number } = {}): void {
  if (!ctx || !master || muted) return;
  if (!hissBuf) {
    hissBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = hissBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = hissBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(o.freq ?? 1200, t0);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  filter.Q.value = o.q ?? 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(o.vol ?? 0.1, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

const N = {
  c4: 261.6,
  d4: 293.7,
  e4: 329.6,
  g4: 392,
  a4: 440,
  c5: 523.3,
  d5: 587.3,
  e5: 659.3,
  g5: 784,
  a5: 880,
  c6: 1046.5,
  e6: 1318.5,
};

export const sfx = {
  tap: (): void => tone(520, 0.07, { vol: 0.08, to: 420 }),
  ground: (): void => hiss(0.09, { vol: 0.05, freq: 2400, q: 0.6 }),
  open: (): void => {
    tone(N.g4, 0.09, { vol: 0.09 });
    tone(N.c5, 0.14, { vol: 0.09, at: 0.06 });
  },
  close: (): void => tone(N.g4, 0.09, { vol: 0.06, to: 300 }),
  coin: (): void => {
    tone(N.e6, 0.06, { type: "square", vol: 0.04 });
    tone(1760, 0.16, { type: "square", vol: 0.04, at: 0.05 });
  },
  leaf: (n = 0): void => tone([N.c5, N.e5, N.g5, N.a5, N.c6][n % 5]!, 0.2, { type: "sine", vol: 0.11 }),
  hop: (): void => tone(300, 0.14, { vol: 0.1, to: 620 }),
  blob: (): void => {
    tone(220, 0.1, { type: "sine", vol: 0.14, to: 520 });
    tone(520, 0.12, { type: "sine", vol: 0.1, at: 0.09, to: 380 });
  },
  purr: (): void => {
    for (let i = 0; i < 7; i++) tone(70 + (i % 2) * 8, 0.05, { type: "sawtooth", vol: 0.05, at: i * 0.05 });
    tone(700, 0.16, { type: "sine", vol: 0.05, at: 0.05, to: 900 });
  },
  yip: (): void => {
    tone(800, 0.07, { vol: 0.09, to: 1300 });
    tone(1000, 0.09, { vol: 0.08, at: 0.09, to: 1500 });
  },
  crab: (): void => {
    hiss(0.03, { vol: 0.12, freq: 3200, q: 3 });
    hiss(0.03, { vol: 0.12, freq: 3600, q: 3, at: 0.08 });
  },
  thump: (): void => {
    tone(130, 0.14, { type: "sine", vol: 0.2, to: 55 });
    hiss(0.08, { vol: 0.05, freq: 500 });
  },
  sparkle: (): void => {
    tone(N.c6, 0.1, { type: "sine", vol: 0.06 });
    tone(N.e6, 0.1, { type: "sine", vol: 0.06, at: 0.06 });
    tone(2093, 0.2, { type: "sine", vol: 0.05, at: 0.12 });
  },
  cheer: (): void => {
    [N.c5, N.e5, N.g5, N.c6].forEach((f, i) => tone(f, 0.16, { vol: 0.09, at: i * 0.07 }));
    hiss(0.5, { vol: 0.03, freq: 1800, q: 0.4, at: 0.05 });
  },
  horn: (): void => {
    tone(N.c4, 0.34, { type: "sawtooth", vol: 0.07, attack: 0.04 });
    tone(N.g4, 0.6, { type: "sawtooth", vol: 0.07, at: 0.3, attack: 0.04 });
    tone(N.e4, 0.6, { type: "triangle", vol: 0.06, at: 0.3, attack: 0.04 });
  },
  bell: (): void => {
    tone(N.a5, 0.9, { type: "sine", vol: 0.1 });
    tone(N.a5 * 2.01, 0.5, { type: "sine", vol: 0.04 });
    tone(N.e5, 1.1, { type: "sine", vol: 0.05, at: 0.12 });
  },
  buy: (): void => {
    [N.g4, N.c5, N.e5, N.g5, N.c6].forEach((f, i) => tone(f, 0.14, { type: "square", vol: 0.04, at: i * 0.06 }));
  },
  deny: (): void => {
    tone(200, 0.12, { type: "square", vol: 0.05 });
    tone(160, 0.18, { type: "square", vol: 0.05, at: 0.11 });
  },
  page: (): void => hiss(0.12, { vol: 0.07, freq: 3000, to: 1200, q: 0.5 }),
  splash: (): void => {
    hiss(0.22, { vol: 0.1, freq: 900, to: 2600, q: 0.7 });
    tone(500, 0.09, { type: "sine", vol: 0.06, to: 900, at: 0.04 });
  },
  whoosh: (): void => hiss(0.4, { vol: 0.11, freq: 400, to: 1600, q: 0.6 }),
  mail: (): void => {
    tone(N.e5, 0.1, { vol: 0.09 });
    tone(N.a5, 0.2, { vol: 0.09, at: 0.09 });
  },
  wipe: (): void => hiss(0.7, { vol: 0.07, freq: 2600, to: 700, q: 0.4 }),
  knock: (): void => {
    tone(180, 0.05, { type: "square", vol: 0.07 });
    tone(170, 0.05, { type: "square", vol: 0.07, at: 0.12 });
  },
  rustle: (): void => hiss(0.3, { vol: 0.06, freq: 3400, to: 2000, q: 0.5 }),
  pop: (): void => tone(700, 0.06, { type: "sine", vol: 0.1, to: 1100 }),
  star: (): void => tone(1568 + Math.random() * 500, 0.3, { type: "sine", vol: 0.05 }),
  step: (): void => hiss(0.03, { vol: 0.02, freq: 700, q: 1 }),
  gear: (): void => {
    for (let i = 0; i < 4; i++) tone(240 + i * 30, 0.03, { type: "square", vol: 0.04, at: i * 0.05 });
  },
  crackle: (): void =>
    hiss(0.02 + Math.random() * 0.03, { vol: 0.02 + Math.random() * 0.03, freq: 1500 + Math.random() * 2500, q: 2 }),
  cricket: (): void => {
    for (let i = 0; i < 3; i++) tone(4100, 0.03, { type: "sine", vol: 0.012, at: i * 0.06 });
  },
  emote: (): void => tone(N.d5, 0.08, { vol: 0.08, to: N.a5 }),
};
