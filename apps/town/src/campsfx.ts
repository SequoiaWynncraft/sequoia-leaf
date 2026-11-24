/** The camp's own small sounds, made from the kit's tones and hiss, and a cat's purr, recorded. */

import { heard, noise, note, penta, recording, type SoundKind, tone } from "@sequoia-leaf/kit/sound.ts";

import purrFile from "./sounds/purr.mp3";

/** The kinds of the town's and the camps' own sounds, by id: each one the player can switch off on its own. */
export const TOWN_SOUND = {
  pets: "town.pets",
  music: "town.music",
  touch: "town.touch",
  decorating: "town.decorating",
  mail: "town.mail",
  doors: "town.doors",
} as const;

/** A cat purring, one breath out and in: 2.84 s, a recording in the public domain (`sounds/NOTICE.txt`). */
const PURR = recording(purrFile);
/** Seconds a purr lasts at its slowest. */
export const PURR_TIME = 3;

export const csfx = {
  /** A purr, a little faster or slower each time (up to 6%), so that two are not the same. */
  purr(): void {
    if (!heard(TOWN_SOUND.pets)) return;
    PURR.play({ vol: 0.13, rate: 0.94 + Math.random() * 0.12 });
  },
  yip(): void {
    if (!heard(TOWN_SOUND.pets)) return;
    tone(880, 0.07, { vol: 0.09, type: "square", slide: 1.5 });
    tone(1100, 0.09, { vol: 0.08, type: "square", slide: 1.3, at: 0.1 });
  },
  blob(): void {
    if (!heard(TOWN_SOUND.pets)) return;
    tone(210, 0.16, { vol: 0.14, type: "sine", slide: 1.9 });
    tone(420, 0.1, { vol: 0.05, type: "sine", slide: 0.6, at: 0.12 });
  },
  /** One tube of a wind chime. */
  chime(i: number): void {
    if (!heard(TOWN_SOUND.music)) return;
    tone(penta(5 + i), 0.9, { vol: 0.09, type: "sine" });
    tone(penta(5 + i) * 2.76, 0.4, { vol: 0.025, type: "sine" });
  },
  /** The music box's one tune: a few notes, and a good tune. */
  tune(): void {
    if (!heard(TOWN_SOUND.music)) return;
    [7, 9, 12, 9, 7, 4, 7, 12].forEach((semi, i) => {
      tone(note(semi + 12), 0.34, { vol: 0.08, type: "triangle", at: i * 0.19 });
      tone(note(semi + 24), 0.16, { vol: 0.025, type: "sine", at: i * 0.19 });
    });
  },
  creak(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    tone(190, 0.18, { vol: 0.07, type: "sawtooth", slide: 1.25 });
    tone(240, 0.16, { vol: 0.06, type: "sawtooth", slide: 0.8, at: 0.2 });
  },
  snore(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    noise(0.5, 260, { vol: 0.07, slide: 0.6, q: 3 });
  },
  chirp(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    for (let i = 0; i < 3; i++) tone(2600 + i * 260, 0.05, { vol: 0.05, type: "sine", slide: 1.2, at: i * 0.09 });
  },
  /** The mailbox's flag going up. */
  mail(): void {
    if (!heard(TOWN_SOUND.mail)) return;
    tone(note(7), 0.08, { vol: 0.1, type: "square" });
    tone(note(14), 0.16, { vol: 0.1, type: "square", at: 0.09 });
  },
  /** Something picked up, and something set down. */
  lift(): void {
    if (!heard(TOWN_SOUND.decorating)) return;
    tone(520, 0.07, { vol: 0.1, type: "sine", slide: 1.6 });
  },
  /** A thing carried while decorating, set over another square: higher where it fits, lower where it does not. */
  carry(fits: boolean): void {
    if (!heard(TOWN_SOUND.decorating)) return;
    tone(fits ? 620 : 300, 0.02, { vol: 0.035, type: "sine" });
  },
  thud(): void {
    if (!heard(TOWN_SOUND.decorating)) return;
    tone(110, 0.12, { vol: 0.2, type: "sine", slide: 0.6 });
    noise(0.05, 700, { vol: 0.08 });
  },
  /** A knock on the stump in town. */
  knock(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    noise(0.03, 1900, { vol: 0.1, q: 5 });
    tone(330, 0.07, { vol: 0.08, type: "square" });
  },
  /** A door opening: the Works' door in town. */
  door(): void {
    if (!heard(TOWN_SOUND.doors)) return;
    noise(0.18, 420, { vol: 0.1, slide: 0.5, q: 2 });
    tone(98, 0.16, { vol: 0.14, type: "sine", slide: 0.7, at: 0.12 });
  },
  /** A game's door shutting behind the player. */
  doorShut(): void {
    if (!heard(TOWN_SOUND.doors)) return;
    noise(0.14, 380, { vol: 0.08, slide: 0.6, q: 2 });
  },
  /** Two knocks: a game's door asks the player to sign in. */
  knockKnock(): void {
    if (!heard(TOWN_SOUND.doors)) return;
    tone(196, 0.05, { vol: 0.08, type: "square" });
    tone(196, 0.05, { vol: 0.08, type: "square", at: 0.16 });
  },
  spin(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    for (let i = 0; i < 5; i++) noise(0.03, 3200 - i * 300, { vol: 0.05, q: 5, at: i * 0.07 });
  },
  bubble(): void {
    if (!heard(TOWN_SOUND.touch)) return;
    for (let i = 0; i < 3; i++)
      tone(300 + Math.random() * 200, 0.07, { vol: 0.07, type: "sine", slide: 1.7, at: i * 0.1 });
  },
};

/** The camps' own kinds of sound, as the settings menu lists them, each with one to hear. */
export const CAMP_SOUNDS: readonly SoundKind[] = [
  { id: TOWN_SOUND.pets, name: "Pets", sample: () => csfx.purr() },
  { id: TOWN_SOUND.music, name: "Chimes and the music box", sample: () => csfx.tune() },
  { id: TOWN_SOUND.touch, name: "Things you touch", sample: () => csfx.chirp() },
  { id: TOWN_SOUND.decorating, name: "Decorating", sample: () => csfx.thud() },
  { id: TOWN_SOUND.mail, name: "Mail", sample: () => csfx.mail() },
  { id: TOWN_SOUND.doors, name: "Doors", sample: () => csfx.door() },
];
