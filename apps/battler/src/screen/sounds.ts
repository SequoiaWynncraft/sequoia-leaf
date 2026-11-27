/**
 * The table's own sounds, made from the kit's tones and hiss: a different small sound for buying,
 * placing, selling, each kind of hit, casting, falling, a star, a trait, a win. Sounds that can
 * come many at once (hits in a fast fight) are held to a few a second each.
 */
import { heard, noise, note, penta, sfx, type SoundKind, tone } from "@sequoia-leaf/kit/sound.ts";

import type { Voice } from "./looks.ts";

/** The kinds of the table's own sounds, by id: each one the player can switch off on its own. */
const RAID = {
  shop: "raid.shop",
  merge: "raid.merge",
  traits: "raid.traits",
  fights: "raid.fights",
  bosses: "raid.bosses",
  results: "raid.results",
  menus: "raid.menus",
} as const;

const last = new Map<string, number>();
/** Whether a sound of this name may play now: no more often than every `gap` milliseconds. */
function may(name: string, gap: number): boolean {
  const now = performance.now();
  if (now - (last.get(name) ?? -1e9) < gap) return false;
  last.set(name, now);
  return true;
}

export const snd = {
  /** A figure lifted off the table. */
  lift(): void {
    if (!heard(RAID.shop)) return;
    tone(note(7), 0.05, { vol: 0.08, type: "sine", slide: 1.5 });
  },
  /** Wood on wood: a figure set down. */
  place(): void {
    if (!heard(RAID.shop)) return;
    noise(0.03, 1900, { vol: 0.14, q: 5 });
    tone(170, 0.07, { vol: 0.16, type: "sine", slide: 0.7 });
  },
  buy(): void {
    if (!heard(RAID.shop)) return;
    tone(note(14), 0.07, { vol: 0.1, type: "square" });
    tone(note(19), 0.12, { vol: 0.1, type: "square", at: 0.06 });
    noise(0.03, 2200, { vol: 0.08, q: 5, at: 0.12 });
  },
  sell(): void {
    if (!heard(RAID.shop)) return;
    tone(note(19), 0.07, { vol: 0.09, type: "square" });
    tone(note(12), 0.12, { vol: 0.09, type: "square", at: 0.06 });
    sfx.coin(1);
  },
  no(): void {
    if (!heard(RAID.menus)) return;
    sfx.no();
  },
  rustle(): void {
    if (!heard(RAID.shop)) return;
    sfx.rustle();
    noise(0.12, 2400, { vol: 0.05, q: 0.8, at: 0.1, slide: 1.6 });
  },
  hold(on: boolean): void {
    if (!heard(RAID.shop)) return;
    tone(note(on ? 5 : 0), 0.08, { vol: 0.1, type: "triangle" });
    noise(0.03, 3000, { vol: 0.06, q: 6, at: 0.04 });
  },
  xp(): void {
    if (!heard(RAID.shop)) return;
    sfx.pluck(4);
    sfx.pluck(6);
  },
  level(): void {
    if (!heard(RAID.shop)) return;
    sfx.levelUp();
  },
  acorn(i: number): void {
    if (!heard(RAID.shop)) return;
    if (may("acorn", 45)) sfx.coin(i);
  },
  /** Three become one: a small run upward, and a much grander one for three stars. */
  star(stars: number): void {
    if (!heard(RAID.merge)) return;
    const n = stars >= 3 ? 9 : 5;
    for (let i = 0; i < n; i++) {
      tone(penta(3 + i), 0.18, { vol: 0.11, type: "square", at: i * 0.055 });
      tone(penta(3 + i) * 2, 0.12, { vol: 0.04, type: "sine", at: i * 0.055 + 0.02 });
    }
    tone(penta(3 + n) * (stars >= 3 ? 2 : 1), 0.7, { vol: 0.12, type: "sine", at: n * 0.055 });
    if (stars >= 3) {
      sfx.bell();
      noise(0.5, 6000, { vol: 0.05, q: 0.6, at: 0.3, slide: 0.5 });
    }
  },
  hopTogether(): void {
    if (!heard(RAID.merge)) return;
    tone(220, 0.16, { vol: 0.12, type: "sine", slide: 2.2 });
  },
  /** A trait switching on: two bell notes, higher for a higher step. */
  trait(step: number): void {
    if (!heard(RAID.traits)) return;
    if (!may("trait", 120)) return;
    tone(penta(4 + step * 2), 0.5, { vol: 0.13, type: "sine" });
    tone(penta(6 + step * 2), 0.7, { vol: 0.11, type: "sine", at: 0.12 });
    tone(penta(6 + step * 2) * 2.4, 0.3, { vol: 0.03, type: "sine", at: 0.12 });
  },
  give(): void {
    if (!heard(RAID.shop)) return;
    sfx.plop();
  },
  forge(): void {
    if (!heard(RAID.shop)) return;
    sfx.clank();
    tone(note(21), 0.5, { vol: 0.1, type: "sine", at: 0.1 });
    tone(note(28), 0.6, { vol: 0.06, type: "sine", at: 0.18 });
  },
  card(): void {
    if (!heard(RAID.shop)) return;
    sfx.paper();
  },
  choose(): void {
    if (!heard(RAID.shop)) return;
    sfx.pop();
    tone(note(12), 0.25, { vol: 0.1, type: "sine", at: 0.05 });
  },
  tap(): void {
    if (!heard(RAID.menus)) return;
    sfx.tap();
  },
  /** The two halves of the board coming together. */
  clack(): void {
    if (!heard(RAID.fights)) return;
    noise(0.05, 900, { vol: 0.2, q: 2 });
    tone(110, 0.14, { vol: 0.22, type: "sine", slide: 0.6 });
    noise(0.03, 2600, { vol: 0.1, q: 5, at: 0.05 });
  },
  swing(): void {
    if (!heard(RAID.fights)) return;
    if (may("swing", 70)) noise(0.05, 1300, { vol: 0.045, q: 1.2, slide: 2 });
  },
  shot(): void {
    if (!heard(RAID.fights)) return;
    if (may("shot", 70)) tone(880, 0.05, { vol: 0.035, type: "sine", slide: 1.6 });
  },
  hit(kind: "physical" | "magic" | "true", hard: boolean): void {
    if (!heard(RAID.fights)) return;
    if (hard) {
      if (!may("hard", 90)) return;
      noise(0.07, 700, { vol: 0.16, q: 1.5 });
      tone(150, 0.12, { vol: 0.18, type: "square", slide: 0.5 });
      return;
    }
    if (kind === "physical") {
      if (may("thud", 60)) {
        noise(0.04, 520, { vol: 0.1, q: 1.6 });
        tone(190, 0.05, { vol: 0.07, type: "sine", slide: 0.6 });
      }
    } else if (kind === "magic") {
      if (may("chime", 60))
        tone(note(16 + Math.floor(Math.random() * 5)), 0.1, { vol: 0.06, type: "triangle", slide: 0.8 });
    } else if (may("sting", 80)) tone(1500, 0.05, { vol: 0.05, type: "sawtooth", slide: 0.5 });
  },
  slip(): void {
    if (!heard(RAID.fights)) return;
    if (may("slip", 90)) noise(0.09, 3000, { vol: 0.04, q: 0.8, slide: 0.5 });
  },
  /** An ability, in its own voice (`looks.ts`): a note in its timbre, a second note after it, a breath of noise. */
  ability(v: Voice): void {
    if (!heard(RAID.fights)) return;
    if (!may("cast", 80)) return;
    const vol = v.vol ?? 0.09;
    tone(note(v.n), 0.22, { vol, type: v.wave, slide: v.slide ?? 1.4 });
    if (v.two !== undefined) tone(note(v.n + v.two), 0.26, { vol: vol * 0.7, type: "sine", at: 0.1 });
    if (v.hiss !== undefined) noise(0.18, v.hiss, { vol: vol * 0.55, q: 0.9 });
  },
  heal(): void {
    if (!heard(RAID.fights)) return;
    if (may("heal", 110)) {
      tone(penta(6), 0.14, { vol: 0.05, type: "sine" });
      tone(penta(8), 0.2, { vol: 0.05, type: "sine", at: 0.07 });
    }
  },
  shield(): void {
    if (!heard(RAID.fights)) return;
    if (may("shield", 110)) {
      tone(note(3), 0.2, { vol: 0.08, type: "triangle", slide: 1.25 });
      noise(0.08, 4000, { vol: 0.03, q: 3, at: 0.1 });
    }
  },
  stun(): void {
    if (!heard(RAID.fights)) return;
    if (may("stun", 110)) {
      tone(note(24), 0.06, { vol: 0.05, type: "square" });
      tone(note(21), 0.06, { vol: 0.05, type: "square", at: 0.07 });
      tone(note(24), 0.06, { vol: 0.05, type: "square", at: 0.14 });
    }
  },
  burn(): void {
    if (!heard(RAID.fights)) return;
    if (may("burn", 200)) noise(0.12, 2600, { vol: 0.03, q: 0.9, slide: 1.8 });
  },
  dig(): void {
    if (!heard(RAID.fights)) return;
    if (may("dig", 110)) noise(0.2, 300, { vol: 0.1, q: 0.9, slide: 0.5 });
  },
  leap(): void {
    if (!heard(RAID.fights)) return;
    if (may("leap", 90)) tone(260, 0.16, { vol: 0.08, type: "sine", slide: 2.4 });
  },
  summon(): void {
    if (!heard(RAID.fights)) return;
    if (may("summon", 110)) {
      sfx.pop();
      tone(note(9), 0.14, { vol: 0.07, type: "triangle", at: 0.04 });
    }
  },
  /** A figure tips over. */
  fall(big: boolean): void {
    if (!heard(RAID.fights)) return;
    if (!may("fall", 70)) return;
    tone(big ? 220 : 330, big ? 0.4 : 0.16, { vol: big ? 0.16 : 0.09, type: "triangle", slide: 0.4 });
    noise(0.04, 1400, { vol: big ? 0.16 : 0.09, q: 4, at: big ? 0.3 : 0.12 });
  },
  rise(): void {
    if (!heard(RAID.fights)) return;
    tone(200, 0.2, { vol: 0.1, type: "sine", slide: 2.2 });
    tone(penta(7), 0.2, { vol: 0.07, type: "sine", at: 0.15 });
  },
  dusk(): void {
    if (!heard(RAID.fights)) return;
    if (may("dusk", 900)) sfx.hoo();
  },
  win(): void {
    if (!heard(RAID.results)) return;
    sfx.fanfare();
  },
  loss(): void {
    if (!heard(RAID.results)) return;
    tone(note(-7), 0.3, { vol: 0.14, type: "triangle", slide: 0.85 });
    tone(note(-12), 0.5, { vol: 0.14, type: "triangle", at: 0.26, slide: 0.8 });
  },
  draw(): void {
    if (!heard(RAID.results)) return;
    tone(note(-5), 0.3, { vol: 0.12, type: "triangle" });
    tone(note(-5), 0.3, { vol: 0.12, type: "triangle", at: 0.3 });
  },
  /** A stage begins at a live table: two bright notes, under its banner. */
  round(): void {
    if (!heard(RAID.fights) || !may("round", 600)) return;
    tone(note(7), 0.16, { vol: 0.08, type: "triangle" });
    tone(note(12), 0.3, { vol: 0.08, type: "triangle", at: 0.12 });
  },
  /** Something big is coming up the path. */
  boss(): void {
    if (!heard(RAID.bosses)) return;
    sfx.horn();
  },
  stomp(): void {
    if (!heard(RAID.fights)) return;
    noise(0.08, 200, { vol: 0.22, q: 1 });
    tone(70, 0.2, { vol: 0.25, type: "sine", slide: 0.6 });
  },
  resolve(): void {
    if (!heard(RAID.results)) return;
    tone(note(-2), 0.18, { vol: 0.1, type: "sine", slide: 0.6 });
  },
  open(): void {
    if (!heard(RAID.menus)) return;
    sfx.open();
  },
  close(): void {
    if (!heard(RAID.menus)) return;
    sfx.close();
  },
  cheer(): void {
    if (!heard(RAID.results)) return;
    sfx.cheer();
  },
  leaf(): void {
    if (!heard(RAID.results)) return;
    sfx.leaf(2);
    sfx.twinkle();
  },
  nudge(): void {
    if (!heard(RAID.menus)) return;
    sfx.pop();
  },
};

/** The table's own kinds of sound, as the settings menu lists them, each with one to hear. */
export const RAID_SOUNDS: readonly SoundKind[] = [
  { id: RAID.shop, name: "Shop and board", sample: () => snd.buy() },
  { id: RAID.merge, name: "Three become one", sample: () => snd.star(2) },
  { id: RAID.traits, name: "Traits", sample: () => snd.trait(2) },
  { id: RAID.fights, name: "Fights", sample: () => snd.hit("physical", true) },
  { id: RAID.bosses, name: "Bosses", sample: () => snd.boss() },
  { id: RAID.results, name: "Wins and losses", sample: () => snd.win() },
  { id: RAID.menus, name: "Pages and buttons", sample: () => snd.open() },
];
