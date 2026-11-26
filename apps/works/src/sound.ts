/**
 * The yard's own sounds, made from the kit's tones and hiss: a small sound for each kind of thing
 * that happens, and a low working murmur under it all that follows how busy the yard is.
 */

import { heard, noise, note, penta, sfx, type SoundKind, tone } from "@sequoia-leaf/kit/sound.ts";

/** The kinds of the yard's own sounds, by id: each one the player can switch off on its own. */
const WORKS = {
  machines: "works.machines",
  building: "works.building",
  refusals: "works.refusals",
  deliveries: "works.deliveries",
  orders: "works.orders",
  plans: "works.plans",
  shift: "works.shift",
  letters: "works.letters",
} as const;

export const yardSfx = {
  /** A machine set down: a thud, and the dust settling. */
  place(): void {
    if (!heard(WORKS.building)) return;
    tone(96, 0.14, { vol: 0.24, type: "sine", slide: 0.55 });
    noise(0.09, 420, { vol: 0.09, q: 0.9 });
    noise(0.12, 2600, { vol: 0.025, at: 0.05, q: 0.8 });
  },
  /** A length of belt: lighter, a wooden clack. `i` raises it a little along a run. */
  belt(i = 0): void {
    if (!heard(WORKS.building)) return;
    noise(0.035, 1700 + (i % 6) * 110, { vol: 0.11, q: 5 });
    tone(210 + (i % 6) * 14, 0.05, { vol: 0.07, type: "triangle", slide: 0.7 });
  },
  /** Something taken away, and its Coins coming back. */
  take(): void {
    if (!heard(WORKS.building)) return;
    noise(0.07, 900, { vol: 0.07, q: 1.4, slide: 1.8 });
    tone(note(7), 0.07, { vol: 0.08, type: "square", at: 0.03 });
    tone(note(14), 0.1, { vol: 0.07, type: "square", at: 0.09 });
  },
  /** A brush drawn along wood. */
  paint(): void {
    if (!heard(WORKS.building)) return;
    noise(0.1, 1500, { vol: 0.07, q: 1.2 });
  },
  turn(): void {
    if (!heard(WORKS.building)) return;
    noise(0.03, 2400, { vol: 0.09, q: 6 });
    tone(330, 0.04, { vol: 0.05, type: "triangle" });
  },
  /** It cannot go there: a soft, low knock rather than a buzzer. */
  no(): void {
    if (!heard(WORKS.refusals)) return;
    tone(note(-17), 0.12, { vol: 0.12, type: "triangle", slide: 0.85 });
  },
  pick(): void {
    if (!heard(WORKS.building)) return;
    tone(penta(5), 0.06, { vol: 0.08, type: "sine" });
  },
  undo(): void {
    if (!heard(WORKS.building)) return;
    tone(note(9), 0.07, { vol: 0.08, type: "triangle", slide: 0.7 });
    noise(0.05, 1200, { vol: 0.05, q: 2, at: 0.03 });
  },
  /** Something arriving at the depot: a soft pluck, higher the more work is in the thing. */
  arrive(step: number): void {
    if (!heard(WORKS.deliveries)) return;
    tone(penta(1 + step * 2), 0.12, { vol: 0.035, type: "triangle" });
  },
  /** A story order filled. */
  order(): void {
    if (!heard(WORKS.orders)) return;
    sfx.fanfare();
  },
  /** A standing order is full and waiting at the gate. */
  ready(): void {
    if (!heard(WORKS.orders)) return;
    sfx.ding();
  },
  /** Handed over: a crate changes hands, and is paid for. */
  handOver(): void {
    if (!heard(WORKS.orders)) return;
    sfx.knock();
    for (let i = 0; i < 4; i++) tone(penta(3 + i), 0.12, { vol: 0.09, at: 0.12 + i * 0.07 });
  },
  plan(): void {
    if (!heard(WORKS.plans)) return;
    sfx.buy();
    for (let i = 0; i < 5; i++) tone(penta(2 + i), 0.14, { vol: 0.07, type: "square", at: 0.2 + i * 0.05 });
  },
  /** A redwood felled: a short rustle rising as it lifts away. */
  fell(): void {
    if (!heard(WORKS.building)) return;
    noise(0.32, 900, { vol: 0.07, slide: 2.2, q: 0.8 });
    tone(note(-3), 0.3, { vol: 0.06, type: "sine", slide: 1.6, attack: 0.06 });
  },
  /** Undergrowth coming down: a long rustle that runs away across the plot. */
  clear(): void {
    if (!heard(WORKS.building)) return;
    for (let i = 0; i < 7; i++) noise(0.2, 3200 - i * 260, { vol: 0.06, slide: 0.6, q: 0.7, at: i * 0.11 });
    tone(note(-5), 0.5, { vol: 0.08, type: "sine", at: 0.1, attack: 0.1 });
  },
  /** The second shift coming on: the yard's bell, twice. */
  shift(): void {
    if (!heard(WORKS.shift)) return;
    sfx.bell();
    for (let i = 0; i < 6; i++) tone(penta(4 + i), 0.2, { vol: 0.06, type: "sine", at: 0.3 + i * 0.07 });
  },
  letter(): void {
    if (!heard(WORKS.letters)) return;
    sfx.paper();
  },
};

let nextChuff = 0;
let flip = false;

/** One chuff of the murmur, `at` seconds from now: a low hiss, and on every other one a low hum under it. `k` is how busy, 0 to 1. */
function chuff(k: number, hum: boolean, at = 0): void {
  noise(0.22, hum ? 150 : 118, { vol: 0.016 + 0.03 * k, q: 0.7, at });
  if (hum) tone(58, 0.16, { vol: 0.012 + 0.02 * k, type: "sine", attack: 0.04, at });
}

/**
 * The murmur: soft chuffs, closer together and a little louder the busier the yard is. `busy` is
 * 0 for a yard standing still, 1 for one with everything working. Call it every frame.
 */
export function murmur(now: number, busy: number): void {
  if (busy <= 0.01 || now < nextChuff || !heard(WORKS.machines)) return;
  flip = !flip;
  const k = Math.min(1, busy);
  chuff(k, flip);
  nextChuff = now + 0.95 - 0.6 * k + Math.random() * 0.05;
}

/** The yard's own kinds of sound, as the settings menu lists them, each with one to hear. */
export const WORKS_SOUNDS: readonly SoundKind[] = [
  {
    id: WORKS.machines,
    name: "Machines at work",
    sample: () => [0, 0.42, 0.84, 1.26].forEach((at, i) => chuff(1, i % 2 === 0, at)),
  },
  { id: WORKS.building, name: "Building", sample: () => yardSfx.place() },
  { id: WORKS.refusals, name: "Cannot build there", sample: () => yardSfx.no() },
  { id: WORKS.deliveries, name: "Deliveries", sample: () => yardSfx.arrive(2) },
  { id: WORKS.orders, name: "Orders", sample: () => yardSfx.handOver() },
  { id: WORKS.plans, name: "Projects and research", sample: () => yardSfx.plan() },
  { id: WORKS.shift, name: "Shift bell", sample: () => yardSfx.shift() },
  { id: WORKS.letters, name: "Letters", sample: () => yardSfx.letter() },
];
