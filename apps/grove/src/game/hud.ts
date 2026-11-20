/**
 * The grove's interface: panels laid over the world. The world is where things happen; here is what
 * you have, what you can do, and the cards that say what just happened.
 */
import { HEARTS, KINDS, PITY, RANK_BONUS, RANK_COLOUR, RANKS, RATES } from "./spirits.ts";
import {
  BLOOM_WATERS,
  bonus,
  coneCost,
  CONES_MAX,
  growCost,
  hearts,
  MAX_LEVEL,
  rate,
  type Save,
  short,
  stage as stageName,
  STOKE_MS,
  WATER_MAX,
} from "./state.ts";

export interface Reveal {
  readonly id: string;
  readonly name: string;
  readonly says: string;
  readonly rank: number;
  readonly isNew: boolean;
  readonly hearts: number;
  readonly gift: number;
}
export interface Hud {
  /** Shows the grove as it now is. */
  show(s: Save, now: number): void;
  /** A word rising from a point of the screen. */
  pop(x: number, y: number, text: string, colour?: string): void;
  /** Drops of Sap flying from a point of the screen into the purse. */
  fly(x: number, y: number, n: number): void;
  /** A title sliding in at the top for a few seconds: a growth, a cone falling. */
  banner(over: string, title: string, under: string, colour?: string): void;
  toast(text: string): void;
  /** A card in the middle of the screen until it is tapped away. */
  card(title: string, lines: readonly string[]): void;
  /** The card for what came out of a cone; `done` when it is tapped away. */
  reveal(r: Reveal, done: () => void): void;
  /** While something is being played out in the world, the buttons wait. */
  busy(is: boolean): void;
  /** A line of guidance above the buttons, or none. */
  hint(text: string | null): void;
}
export interface Deeds {
  water(): void;
  grow(): void;
  forage(): void;
  sound(on: boolean): void;
  readonly soundOn: boolean;
  /** A spirit's face, 16 pixels square. */
  portrait(id: string): HTMLCanvasElement;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
const pct = (n: number): string => `+${Math.round(n * 100)}%`;

export function hud(root: HTMLElement, deeds: Deeds): Hud {
  // ----- what you have
  const purse = el("div", "panel purse");
  const sap = el("div", "sap");
  const per = el("div", "per");
  const warm = el("div", "warm");
  const warmBar = el("i", "");
  warm.append(el("span", "", "Fire stoked ×1.5"), warmBar);
  purse.append(el("div", "label", "Sap"), sap, per, warm);

  const tree = el("div", "panel tree");
  const stage = el("div", "stage");
  const rings = el("div", "label");
  tree.append(stage, rings);

  const care = el("div", "panel care");
  const bloomFill = el("i", "");
  const bloomBar = el("div", "meter");
  bloomBar.append(bloomFill);
  const pips = el("div", "pips");
  const drops = Array.from({ length: WATER_MAX }, () => el("b", ""));
  pips.append(...drops);
  const conesLine = el("div", "per");
  care.append(el("div", "label", "Bloom"), bloomBar, el("div", "label", "Water"), pips, conesLine);

  // ----- what you can do
  const dock = el("div", "dock");
  const mk = (cls: string, act: () => void): HTMLButtonElement => {
    const b = el("button", `deed ${cls}`);
    b.addEventListener("click", act);
    return b;
  };
  const water = mk("water", deeds.water);
  const grow = mk("grow", deeds.grow);
  const forage = mk("forage", deeds.forage);
  const book = mk("book", () => openBook());
  const mute = mk("mute", () => {
    deeds.sound(!deeds.soundOn);
    mute.textContent = deeds.soundOn ? "Sound on" : "Sound off";
  });
  mute.textContent = deeds.soundOn ? "Sound on" : "Sound off";
  dock.append(water, grow, forage, book, mute);
  const hintLine = el("div", "hint");
  hintLine.hidden = true;
  root.append(purse, tree, care, hintLine, dock);

  const set = (b: HTMLButtonElement, what: string, sub: string, can: boolean): void => {
    b.replaceChildren(el("span", "what", what), el("span", "cost", sub));
    b.disabled = !can;
    b.classList.toggle("ready", can);
  };
  let last: Save | null = null;
  let held = 0;
  let waiting = false;

  // ----- the spirits' book
  let bookEl: HTMLElement | null = null;
  const openBook = (): void => {
    if (bookEl || !last) return;
    const s = last;
    const back = el("div", "shade");
    const page = el("div", "panel pages");
    const grid = el("div", "grid");
    for (const k of KINDS) {
      const n = s.spirits[k.id] ?? 0;
      const cell = el("div", `cell${n ? "" : " unknown"}`);
      cell.style.setProperty("--rank", RANK_COLOUR[k.rank]!);
      const face = n ? deeds.portrait(k.id) : el("div", "what", "?");
      face.classList.add("face");
      cell.append(
        face,
        el("div", "name", n ? k.name : "???"),
        el("div", "rank", RANKS[k.rank]),
        el("div", "hearts", n ? "♥".repeat(hearts(s, k.id)) + "♡".repeat(HEARTS - hearts(s, k.id)) : ""),
        el("div", "per", n ? pct(RANK_BONUS[k.rank]! * (1 + 0.25 * hearts(s, k.id))) : ""),
      );
      if (n) cell.title = k.says;
      grid.append(cell);
    }
    const rates = el("div", "rates");
    RANKS.forEach((r, i) => {
      const c = el("div", "rate");
      c.style.setProperty("--rank", RANK_COLOUR[i]!);
      c.append(el("b", "", r), el("span", "", `${RATES[i]}%`));
      rates.append(c);
    });
    const found = KINDS.filter((k) => s.spirits[k.id]).length;
    page.append(
      el("div", "stage", `Spirits · ${found} of ${KINDS.length}`),
      el("div", "per", `Together they add ${pct(bonus(s))} to what your tree makes`),
      grid,
      el("div", "label", "What a cone can hold"),
      rates,
      el(
        "div",
        "per",
        `A Treant or better within ${PITY} cones · ${Math.max(0, PITY - s.pity)} to go · ${s.opened} opened`,
      ),
      el("div", "label", "Tap to close"),
    );
    back.append(page);
    back.addEventListener("click", () => {
      back.remove();
      bookEl = null;
    });
    root.append(back);
    bookEl = back;
  };

  return {
    show(s, now) {
      last = s;
      const text = short(s.sap);
      // The purse jumps when it takes a leap, as from a tap.
      if (sap.textContent !== text && s.sap - held > rate(s) * 1.5 + 0.9) {
        sap.classList.remove("bump");
        void sap.offsetWidth;
        sap.classList.add("bump");
      }
      held = s.sap;
      sap.textContent = text;
      const hot = s.stoked > now;
      const r = rate(s) * (hot ? 1.5 : 1);
      per.textContent = `+${r < 10 ? r.toFixed(1) : short(r)} a second`;
      warm.hidden = !hot;
      warmBar.style.width = `${Math.max(0, Math.min(1, (s.stoked - now) / STOKE_MS)) * 100}%`;
      stage.textContent = stageName(s.level);
      rings.textContent = s.level >= MAX_LEVEL ? "Full grown" : `Ring ${s.level + 1} of ${MAX_LEVEL + 1}`;
      bloomFill.style.width = `${Math.round(s.bloom * 100)}%`;
      drops.forEach((d, i) => d.classList.toggle("full", i < Math.floor(s.water)));
      conesLine.textContent = s.cones ? `${s.cones} cone${s.cones > 1 ? "s" : ""} waiting` : "";
      const left = Math.max(1, Math.round((1 - s.bloom) * BLOOM_WATERS));
      set(
        water,
        "Water the tree",
        `${Math.floor(s.water)} of ${WATER_MAX} · ${left} to a cone`,
        !waiting && s.water >= 1,
      );
      const g = growCost(s);
      set(
        grow,
        g === null ? "Full grown" : "Grow the tree",
        g === null ? "" : `${short(g)} sap`,
        !waiting && g !== null && s.sap >= g,
      );
      const c = coneCost(s);
      set(
        forage,
        "Forage a cone",
        c === null ? `no room (${CONES_MAX})` : `${short(c)} sap`,
        !waiting && c !== null && s.sap >= c,
      );
      set(
        book,
        "Spirits",
        `${KINDS.filter((k) => s.spirits[k.id]).length} of ${KINDS.length} · ${pct(bonus(s))}`,
        true,
      );
    },
    pop(x, y, text, colour) {
      const p = el("div", "pop", text);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      if (colour) p.style.color = colour;
      root.append(p);
      p.addEventListener("animationend", () => p.remove());
    },
    fly(x, y, n) {
      const to = sap.getBoundingClientRect();
      for (let i = 0; i < n; i++) {
        const m = el("i", "mote");
        const ox = (Math.random() - 0.5) * 70;
        const oy = (Math.random() - 0.5) * 50 - 20;
        m.style.left = `${x}px`;
        m.style.top = `${y}px`;
        root.append(m);
        // Out in a small scatter, then home to the purse.
        const move = m.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.6)", opacity: 1 },
            { transform: `translate(${ox}px, ${oy}px) scale(1.2)`, opacity: 1, offset: 0.3 },
            {
              transform: `translate(${to.left + to.width / 2 - x}px, ${to.top + to.height / 2 - y}px) scale(0.7)`,
              opacity: 0.9,
            },
          ],
          { duration: 520 + i * 60 + Math.random() * 120, easing: "cubic-bezier(.5,0,.6,1)" },
        );
        move.addEventListener("finish", () => m.remove());
      }
    },
    banner(over, title, under, colour) {
      root.querySelector(".banner")?.remove();
      const b = el("div", "banner");
      const name = el("div", "name", title);
      if (colour) name.style.color = colour;
      b.append(el("div", "label", over), name, el("div", "line", under));
      root.append(b);
      b.addEventListener("animationend", () => b.remove());
    },
    toast(text) {
      root.querySelector(".toast")?.remove();
      const t = el("div", "panel toast", text);
      root.append(t);
      t.addEventListener("animationend", () => t.remove());
    },
    card(title, lines) {
      const c = el("div", "panel card");
      c.append(
        el("div", "stage", title),
        ...lines.map((l) => el("div", "line", l)),
        el("div", "label", "Tap to go on"),
      );
      c.addEventListener("click", () => c.remove());
      root.append(c);
    },
    reveal(r, done) {
      const c = el("div", "panel card spirit");
      c.style.setProperty("--rank", RANK_COLOUR[r.rank]!);
      const face = deeds.portrait(r.id);
      face.classList.add("face");
      const bondLine = r.gift
        ? `Its bond is full. It left ${short(r.gift)} sap.`
        : r.isNew
          ? `Adds ${pct(RANK_BONUS[r.rank]!)} to what your tree makes`
          : `Bond ${"♥".repeat(r.hearts)}${"♡".repeat(HEARTS - r.hearts)} · now ${pct(RANK_BONUS[r.rank]! * (1 + 0.25 * r.hearts))}`;
      c.append(
        el("div", "rank", RANKS[r.rank]),
        face,
        el("div", "stage", r.name),
        el("div", "tag", r.isNew ? "New spirit" : "Again"),
        el("div", "line", `“${r.says}”`),
        el("div", "per", bondLine),
        el("div", "label", "Tap to go on"),
      );
      c.addEventListener("click", () => {
        c.remove();
        done();
      });
      root.append(c);
    },
    busy(is) {
      waiting = is;
      dock.classList.toggle("waiting", is);
    },
    hint(text) {
      hintLine.hidden = text === null;
      hintLine.textContent = text ?? "";
    },
  };
}
