/**
 * The grove's interface: plain panels laid over the world. The world is for looking at; everything
 * you do is a button here, large enough for a thumb.
 */
import { growCost, leaflingCost, leaflingRoom, MAX_LEVEL, rate, type Save, short } from "./state.ts";

export interface Hud {
  /** Shows the grove as it now is. */
  show(s: Save): void;
  /** A number rising from a point of the screen, for a tap. */
  pop(x: number, y: number, text: string): void;
  /** A card in the middle of the screen until it is tapped away. */
  card(title: string, lines: readonly string[]): void;
}
export interface Deeds {
  grow(): void;
  welcome(): void;
}

const STAGES = [
  "Seedling",
  "Sprout",
  "Sapling",
  "Young tree",
  "Pole",
  "Tall tree",
  "Old growth",
  "Elder",
  "Monarch",
  "Giant",
  "Titan",
  "Ancient",
  "Great Sequoia",
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

export function hud(root: HTMLElement, deeds: Deeds): Hud {
  const top = el("div", "panel purse");
  const sap = el("div", "sap");
  const per = el("div", "per");
  top.append(el("div", "label", "Sap"), sap, per);

  const tree = el("div", "panel tree");
  const stage = el("div", "stage");
  const rings = el("div", "label");
  tree.append(stage, rings);

  const bar = el("div", "bar");
  const grow = el("button", "deed");
  const welcome = el("button", "deed");
  grow.addEventListener("click", deeds.grow);
  welcome.addEventListener("click", deeds.welcome);
  bar.append(grow, welcome);
  root.append(top, tree, bar);

  const button = (b: HTMLButtonElement, title: string, cost: number | null, have: number, done: string): void => {
    b.replaceChildren(
      el("span", "what", cost === null ? done : title),
      el("span", "cost", cost === null ? "" : `${short(cost)} sap`),
    );
    b.disabled = cost === null || have < cost;
    b.classList.toggle("ready", cost !== null && have >= cost);
  };
  return {
    show(s) {
      sap.textContent = short(s.sap);
      per.textContent = `+${rate(s) < 10 ? rate(s).toFixed(1) : short(rate(s))} a second`;
      stage.textContent = STAGES[s.level] ?? "";
      rings.textContent = s.level >= MAX_LEVEL ? "Full grown" : `Ring ${s.level + 1} of ${MAX_LEVEL + 1}`;
      button(grow, "Grow the tree", growCost(s), s.sap, "Full grown");
      button(
        welcome,
        `Welcome a leafling (${s.leaflings}/${leaflingRoom(s)})`,
        leaflingCost(s),
        s.sap,
        `Leaflings ${s.leaflings}/${leaflingRoom(s)}${s.level >= MAX_LEVEL ? "" : " · grow for room"}`,
      );
    },
    pop(x, y, text) {
      const p = el("div", "pop", text);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      root.append(p);
      p.addEventListener("animationend", () => p.remove());
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
  };
}
