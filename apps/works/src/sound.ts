/**
 * The yard's own sounds, made from the kit's tones and hiss: a small sound for each kind of thing
 * that happens, and a low working murmur under it all that follows how busy the yard is.
 */

import { noise, note, penta, sfx, tone } from "@sequoia-leaf/kit/sound.ts";

export const yardSfx = {
  /** A machine set down: a thud, and the dust settling. */
  place(): void {
    tone(96, 0.14, { vol: 0.24, type: "sine", slide: 0.55 });
    noise(0.09, 420, { vol: 0.09, q: 0.9 });
    noise(0.12, 2600, { vol: 0.025, at: 0.05, q: 0.8 });
  },
  /** A length of belt: lighter, a wooden clack. `i` raises it a little along a run. */
  belt(i = 0): void {
    noise(0.035, 1700 + (i % 6) * 110, { vol: 0.11, q: 5 });
    tone(210 + (i % 6) * 14, 0.05, { vol: 0.07, type: "triangle", slide: 0.7 });
  },
  /** Something taken away, and its Coins coming back. */
  take(): void {
    noise(0.07, 900, { vol: 0.07, q: 1.4, slide: 1.8 });
    tone(note(7), 0.07, { vol: 0.08, type: "square", at: 0.03 });
    tone(note(14), 0.1, { vol: 0.07, type: "square", at: 0.09 });
  },
  turn(): void {
    noise(0.03, 2400, { vol: 0.09, q: 6 });
    tone(330, 0.04, { vol: 0.05, type: "triangle" });
  },
  /** It cannot go there: a soft, low knock rather than a buzzer. */
  no(): void {
    tone(note(-17), 0.12, { vol: 0.12, type: "triangle", slide: 0.85 });
  },
  pick(): void {
    tone(penta(5), 0.06, { vol: 0.08, type: "sine" });
  },
  undo(): void {
    tone(note(9), 0.07, { vol: 0.08, type: "triangle", slide: 0.7 });
    noise(0.05, 1200, { vol: 0.05, q: 2, at: 0.03 });
  },
  /** Something arriving at the depot: a soft pluck, higher the more work is in the thing. */
  arrive(step: number): void {
    tone(penta(1 + step * 2), 0.12, { vol: 0.035, type: "triangle" });
  },
  /** A story order filled. */
  order(): void {
    sfx.fanfare();
  },
  /** A standing order is full and waiting at the gate. */
  ready(): void {
    sfx.ding();
  },
  /** Handed over: a crate changes hands, and is paid for. */
  handOver(): void {
    sfx.knock();
    for (let i = 0; i < 4; i++) tone(penta(3 + i), 0.12, { vol: 0.09, at: 0.12 + i * 0.07 });
  },
  plan(): void {
    sfx.buy();
    for (let i = 0; i < 5; i++) tone(penta(2 + i), 0.14, { vol: 0.07, type: "square", at: 0.2 + i * 0.05 });
  },
  /** Undergrowth coming down: a long rustle that runs away across the plot. */
  clear(): void {
    for (let i = 0; i < 7; i++) noise(0.2, 3200 - i * 260, { vol: 0.06, slide: 0.6, q: 0.7, at: i * 0.11 });
    tone(note(-5), 0.5, { vol: 0.08, type: "sine", at: 0.1, attack: 0.1 });
  },
  /** The second shift coming on: the yard's bell, twice. */
  shift(): void {
    sfx.bell();
    for (let i = 0; i < 6; i++) tone(penta(4 + i), 0.2, { vol: 0.06, type: "sine", at: 0.3 + i * 0.07 });
  },
  hammer(): void {
    noise(0.025, 3400, { vol: 0.03, q: 7 });
  },
  letter(): void {
    sfx.paper();
  },
};

let nextChuff = 0;
let flip = false;

/**
 * The murmur: soft chuffs, closer together and a little louder the busier the yard is. `busy` is
 * 0 for a yard standing still, 1 for one with everything working. Call it every frame.
 */
export function murmur(now: number, busy: number): void {
  if (busy <= 0.01 || now < nextChuff) return;
  flip = !flip;
  const k = Math.min(1, busy);
  noise(0.22, flip ? 150 : 118, { vol: 0.016 + 0.03 * k, q: 0.7 });
  if (flip) tone(58, 0.16, { vol: 0.012 + 0.02 * k, type: "sine", attack: 0.04 });
  nextChuff = now + 0.95 - 0.6 * k + Math.random() * 0.05;
}
