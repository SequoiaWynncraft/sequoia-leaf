/**
 * The table's own sounds, made from the kit's tones and hiss: a different small sound for buying,
 * placing, selling, each kind of hit, casting, falling, a star, a trait, a win. Sounds that can
 * come many at once (hits in a fast fight) are held to a few a second each.
 */
import { noise, note, penta, sfx, tone } from "@sequoia-leaf/kit/sound.ts";

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
    tone(note(7), 0.05, { vol: 0.08, type: "sine", slide: 1.5 });
  },
  /** Wood on wood: a figure set down. */
  place(): void {
    noise(0.03, 1900, { vol: 0.14, q: 5 });
    tone(170, 0.07, { vol: 0.16, type: "sine", slide: 0.7 });
  },
  buy(): void {
    tone(note(14), 0.07, { vol: 0.1, type: "square" });
    tone(note(19), 0.12, { vol: 0.1, type: "square", at: 0.06 });
    noise(0.03, 2200, { vol: 0.08, q: 5, at: 0.12 });
  },
  sell(): void {
    tone(note(19), 0.07, { vol: 0.09, type: "square" });
    tone(note(12), 0.12, { vol: 0.09, type: "square", at: 0.06 });
    sfx.coin(1);
  },
  no(): void {
    sfx.no();
  },
  rustle(): void {
    sfx.rustle();
    noise(0.12, 2400, { vol: 0.05, q: 0.8, at: 0.1, slide: 1.6 });
  },
  hold(on: boolean): void {
    tone(note(on ? 5 : 0), 0.08, { vol: 0.1, type: "triangle" });
    noise(0.03, 3000, { vol: 0.06, q: 6, at: 0.04 });
  },
  xp(): void {
    sfx.pluck(4);
    sfx.pluck(6);
  },
  level(): void {
    sfx.levelUp();
  },
  acorn(i: number): void {
    if (may("acorn", 45)) sfx.coin(i);
  },
  /** Three become one: a small run upward, and a much grander one for three stars. */
  star(stars: number): void {
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
    tone(220, 0.16, { vol: 0.12, type: "sine", slide: 2.2 });
  },
  /** A trait switching on: two bell notes, higher for a higher step. */
  trait(step: number): void {
    if (!may("trait", 120)) return;
    tone(penta(4 + step * 2), 0.5, { vol: 0.13, type: "sine" });
    tone(penta(6 + step * 2), 0.7, { vol: 0.11, type: "sine", at: 0.12 });
    tone(penta(6 + step * 2) * 2.4, 0.3, { vol: 0.03, type: "sine", at: 0.12 });
  },
  give(): void {
    sfx.plop();
  },
  forge(): void {
    sfx.clank();
    tone(note(21), 0.5, { vol: 0.1, type: "sine", at: 0.1 });
    tone(note(28), 0.6, { vol: 0.06, type: "sine", at: 0.18 });
  },
  card(): void {
    sfx.paper();
  },
  choose(): void {
    sfx.pop();
    tone(note(12), 0.25, { vol: 0.1, type: "sine", at: 0.05 });
  },
  tap(): void {
    sfx.tap();
  },
  /** The two halves of the board coming together. */
  clack(): void {
    noise(0.05, 900, { vol: 0.2, q: 2 });
    tone(110, 0.14, { vol: 0.22, type: "sine", slide: 0.6 });
    noise(0.03, 2600, { vol: 0.1, q: 5, at: 0.05 });
  },
  swing(): void {
    if (may("swing", 70)) noise(0.05, 1300, { vol: 0.045, q: 1.2, slide: 2 });
  },
  shot(): void {
    if (may("shot", 70)) tone(880, 0.05, { vol: 0.035, type: "sine", slide: 1.6 });
  },
  hit(kind: "physical" | "magic" | "true", hard: boolean): void {
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
    if (may("slip", 90)) noise(0.09, 3000, { vol: 0.04, q: 0.8, slide: 0.5 });
  },
  /** An ability: a rising breath, deeper for the dear ones. */
  cast(weight: number): void {
    if (!may("cast", 80)) return;
    const base = note(12 - weight * 3);
    tone(base, 0.22, { vol: 0.1, type: "triangle", slide: 1.5 });
    noise(0.2, 1200, { vol: 0.05, q: 0.8, slide: 3 });
    tone(base * 2, 0.3, { vol: 0.05, type: "sine", at: 0.12 });
  },
  heal(): void {
    if (may("heal", 110)) {
      tone(penta(6), 0.14, { vol: 0.05, type: "sine" });
      tone(penta(8), 0.2, { vol: 0.05, type: "sine", at: 0.07 });
    }
  },
  shield(): void {
    if (may("shield", 110)) {
      tone(note(3), 0.2, { vol: 0.08, type: "triangle", slide: 1.25 });
      noise(0.08, 4000, { vol: 0.03, q: 3, at: 0.1 });
    }
  },
  stun(): void {
    if (may("stun", 110)) {
      tone(note(24), 0.06, { vol: 0.05, type: "square" });
      tone(note(21), 0.06, { vol: 0.05, type: "square", at: 0.07 });
      tone(note(24), 0.06, { vol: 0.05, type: "square", at: 0.14 });
    }
  },
  burn(): void {
    if (may("burn", 200)) noise(0.12, 2600, { vol: 0.03, q: 0.9, slide: 1.8 });
  },
  dig(): void {
    if (may("dig", 110)) noise(0.2, 300, { vol: 0.1, q: 0.9, slide: 0.5 });
  },
  leap(): void {
    if (may("leap", 90)) tone(260, 0.16, { vol: 0.08, type: "sine", slide: 2.4 });
  },
  summon(): void {
    if (may("summon", 110)) {
      sfx.pop();
      tone(note(9), 0.14, { vol: 0.07, type: "triangle", at: 0.04 });
    }
  },
  /** A figure tips over. */
  fall(big: boolean): void {
    if (!may("fall", 70)) return;
    tone(big ? 220 : 330, big ? 0.4 : 0.16, { vol: big ? 0.16 : 0.09, type: "triangle", slide: 0.4 });
    noise(0.04, 1400, { vol: big ? 0.16 : 0.09, q: 4, at: big ? 0.3 : 0.12 });
  },
  rise(): void {
    tone(200, 0.2, { vol: 0.1, type: "sine", slide: 2.2 });
    tone(penta(7), 0.2, { vol: 0.07, type: "sine", at: 0.15 });
  },
  dusk(): void {
    if (may("dusk", 900)) sfx.hoo();
  },
  win(): void {
    sfx.fanfare();
  },
  loss(): void {
    tone(note(-7), 0.3, { vol: 0.14, type: "triangle", slide: 0.85 });
    tone(note(-12), 0.5, { vol: 0.14, type: "triangle", at: 0.26, slide: 0.8 });
  },
  draw(): void {
    tone(note(-5), 0.3, { vol: 0.12, type: "triangle" });
    tone(note(-5), 0.3, { vol: 0.12, type: "triangle", at: 0.3 });
  },
  /** Something big is coming up the path. */
  boss(): void {
    sfx.horn();
  },
  stomp(): void {
    noise(0.08, 200, { vol: 0.22, q: 1 });
    tone(70, 0.2, { vol: 0.25, type: "sine", slide: 0.6 });
  },
  resolve(): void {
    tone(note(-2), 0.18, { vol: 0.1, type: "sine", slide: 0.6 });
  },
  open(): void {
    sfx.open();
  },
  close(): void {
    sfx.close();
  },
  cheer(): void {
    sfx.cheer();
  },
  leaf(): void {
    sfx.leaf(2);
    sfx.twinkle();
  },
  unlock(): void {
    sfx.clack();
    sfx.twinkle();
  },
  nudge(): void {
    sfx.pop();
  },
};
