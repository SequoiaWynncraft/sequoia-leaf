/** Small helpers for building the interface out of the kit's classes. */

type Child = Node | string | number | null | undefined | false;
type Props = Readonly<Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>>;

/**
 * Makes an element with the given classes. Props starting with `on` are listeners, `text` sets the
 * words, and anything else is an attribute (left out when null, undefined or false).
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes = "",
  props: Props = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === "function") node.addEventListener(k.replace(/^on/, "").toLowerCase(), v);
    else if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  add(node, ...kids);
  return node;
}

export function add(parent: Node, ...kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    parent.appendChild(typeof k === "object" ? k : document.createTextNode(String(k)));
  }
}

export type IconName =
  | "leaf"
  | "coin"
  | "acorn"
  | "close"
  | "back"
  | "sound"
  | "mute"
  | "check"
  | "lock"
  | "star"
  | "heart"
  | "gear"
  | "hammer"
  | "mail"
  | "gift"
  | "turn"
  | "tray"
  | "home"
  | "paw"
  | "visit"
  | "more"
  | "up"
  | "down"
  | "wave"
  | "cheer"
  | "laugh";

/** One of the kit's pixel icons, `scale` whole steps large. */
export function icon(name: IconName, scale = 1): HTMLElement {
  const i = el("i", `k-i k-i-${name}`);
  if (scale !== 1) i.style.setProperty("--s", String(scale));
  return i;
}

/** An amount of Leaf or Coins with its icon. */
export function amount(kind: "leaf" | "coin", n: number | string): HTMLElement {
  return el("span", kind === "leaf" ? "k-cur leaf" : "k-cur", {}, icon(kind), String(n));
}

/** A canvas drawn elsewhere, shown `scale` screen pixels to each of its own (in interface units). */
export function shown(c: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  c.classList.add("k-px");
  c.style.width = `calc(var(--u) * ${c.width * scale})`;
  c.style.height = `calc(var(--u) * ${c.height * scale})`;
  return c;
}

/** Plays an element's one-shot animation class again from the start. */
export function replay(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** One interface unit in CSS pixels, as the stylesheet has it now. */
export function unit(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u"));
  return v > 0 ? v : 2;
}
