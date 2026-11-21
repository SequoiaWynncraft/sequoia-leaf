/** The camp's own small sounds, made from the kit's tones and hiss. */

import { noise, note, penta, tone } from "@sequoia-leaf/kit/sound.ts";

export const csfx = {
  purr(): void {
    for (let i = 0; i < 6; i++) tone(58 + (i % 2) * 6, 0.09, { vol: 0.09, type: "sawtooth", at: i * 0.085 });
  },
  yip(): void {
    tone(880, 0.07, { vol: 0.09, type: "square", slide: 1.5 });
    tone(1100, 0.09, { vol: 0.08, type: "square", slide: 1.3, at: 0.1 });
  },
  blob(): void {
    tone(210, 0.16, { vol: 0.14, type: "sine", slide: 1.9 });
    tone(420, 0.1, { vol: 0.05, type: "sine", slide: 0.6, at: 0.12 });
  },
  /** One tube of a wind chime. */
  chime(i: number): void {
    tone(penta(5 + i), 0.9, { vol: 0.09, type: "sine" });
    tone(penta(5 + i) * 2.76, 0.4, { vol: 0.025, type: "sine" });
  },
  /** The music box's one tune: a few notes, and a good tune. */
  tune(): void {
    [7, 9, 12, 9, 7, 4, 7, 12].forEach((semi, i) => {
      tone(note(semi + 12), 0.34, { vol: 0.08, type: "triangle", at: i * 0.19 });
      tone(note(semi + 24), 0.16, { vol: 0.025, type: "sine", at: i * 0.19 });
    });
  },
  creak(): void {
    tone(190, 0.18, { vol: 0.07, type: "sawtooth", slide: 1.25 });
    tone(240, 0.16, { vol: 0.06, type: "sawtooth", slide: 0.8, at: 0.2 });
  },
  snore(): void {
    noise(0.5, 260, { vol: 0.07, slide: 0.6, q: 3 });
  },
  chirp(): void {
    for (let i = 0; i < 3; i++) tone(2600 + i * 260, 0.05, { vol: 0.05, type: "sine", slide: 1.2, at: i * 0.09 });
  },
  /** The mailbox's flag going up. */
  mail(): void {
    tone(note(7), 0.08, { vol: 0.1, type: "square" });
    tone(note(14), 0.16, { vol: 0.1, type: "square", at: 0.09 });
  },
  /** Something picked up, and something set down. */
  lift(): void {
    tone(520, 0.07, { vol: 0.1, type: "sine", slide: 1.6 });
  },
  thud(): void {
    tone(110, 0.12, { vol: 0.2, type: "sine", slide: 0.6 });
    noise(0.05, 700, { vol: 0.08 });
  },
  spin(): void {
    for (let i = 0; i < 5; i++) noise(0.03, 3200 - i * 300, { vol: 0.05, q: 5, at: i * 0.07 });
  },
  bubble(): void {
    for (let i = 0; i < 3; i++)
      tone(300 + Math.random() * 200, 0.07, { vol: 0.07, type: "sine", slide: 1.7, at: i * 0.1 });
  },
};
