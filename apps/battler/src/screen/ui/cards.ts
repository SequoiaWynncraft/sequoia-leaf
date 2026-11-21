/**
 * Cards: what a thing is, said in a `k-tip` beside it. Pointing at anything (or pressing on it
 * with a finger) shows its card: a figure with its role, traits, numbers, ability and the items
 * that suit it; a trait with its steps and every figure that carries it; an item; a boon; a room.
 * Every card on the table uses the short forms; the almanac's cards add the long sentence and the
 * flavour line.
 *
 * Two cards can be up at once: one kept (it stays, and can hold buttons) and one passing (it goes
 * when the pointer does), drawn over the kept one. A card shown beside an element stays beside it
 * when the page is laid out again, and goes with it when it goes.
 */
import { add, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { LONG_PRESS, tip } from "@sequoia-leaf/kit/tip.ts";

import {
  abilityShort,
  abilityText,
  type Almanac,
  type BoonId,
  BOONS,
  boonShort,
  COMPONENTS,
  ECONOMY,
  type FigureId,
  FIGURES,
  FINISHED,
  type FinishedId,
  GOOD_WITH,
  isComponentId,
  isFigureId,
  isLocked,
  itemAdds,
  type ItemId,
  itemName,
  itemShort,
  itemText,
  MILESTONES,
  type Party,
  type Piece,
  roleLine,
  ROOMS,
  type Run,
  specOf,
  STALL_ODDS,
  type Stars,
  TRAILS,
  type TraitId,
  TRAITS,
  traitShort,
  traitsOf,
  traitText,
  type Unit,
  type UnitKind,
} from "../../game/index.ts";
import { boonIcon, glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { portrait, starsPic } from "../art/sprites.ts";
import {
  combosWithHeld,
  membersOf,
  NUMBER_KEYS,
  type Numbers,
  ownTraitCount,
  plainNumbers,
  rackHas,
  recipesOf,
  savings,
  type TraitCount,
  traitCount,
  whereIs,
} from "../logic.ts";
import { pieces as richPieces } from "../rich.ts";

/** A spot on the page for a card to sit beside, in CSS pixels. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  node: HTMLElement;
  owner: unknown;
  /** The element it sits beside, if it was shown beside one. */
  anchor: Element | null;
  spot: Spot;
  /** Sits to the side of its spot rather than above or below it, where there is room. */
  aside: boolean;
}
let kept: Box | null = null;
let passing: Box | null = null;

/** A drawn picture on the page, `scale` interface units to each of its pixels. */
export function pic(c: HTMLCanvasElement, scale = 1, cls = ""): HTMLCanvasElement {
  c.className = `k-px ${cls}`.trim();
  c.style.width = `calc(var(--u) * ${c.width * scale})`;
  c.style.height = `calc(var(--u) * ${c.height * scale})`;
  return c;
}

/** A figure's picture on the page, sized by the place it is put in (`--fs` interface units to a pixel). */
export function figPic(c: HTMLCanvasElement): HTMLCanvasElement {
  c.className = "k-px fig";
  c.style.setProperty("--w", String(c.width));
  c.style.setProperty("--h", String(c.height));
  return c;
}

const spotOf = (target: Element): Spot => {
  const r = target.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * Puts a card beside a spot: above it where there is room, otherwise below, otherwise to the side.
 * With `aside`, to the side first; and where the window is too narrow for that (a phone held
 * upright), as a sheet along the bottom, so the table above it stays in view. Never off the page.
 */
function place(node: HTMLElement, spot: Spot, aside = false): void {
  const r = node.getBoundingClientRect();
  const gap = 8;
  const right = spot.x + spot.w + gap;
  if (aside) {
    const fits = right + r.width <= window.innerWidth - 4;
    const x = fits ? right : Math.round((window.innerWidth - r.width) / 2);
    const y = fits
      ? Math.min(Math.max(4, spot.y), window.innerHeight - r.height - 4)
      : window.innerHeight - r.height - 4;
    node.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(4, y))}px)`;
    return;
  }
  const x = Math.round(Math.min(Math.max(4, spot.x + spot.w / 2 - r.width / 2), window.innerWidth - r.width - 4));
  const above = spot.y - r.height - gap;
  const below = spot.y + spot.h + gap;
  const y = Math.round(
    above >= 4
      ? above
      : below + r.height <= window.innerHeight - 4
        ? below
        : Math.max(4, window.innerHeight - r.height - 4),
  );
  if (above < 4 && below + r.height > window.innerHeight - 4) {
    const left = spot.x - r.width - gap;
    const sx = right + r.width <= window.innerWidth - 4 ? right : left >= 4 ? left : x;
    node.style.transform = `translate(${Math.round(sx)}px, ${y}px)`;
  } else node.style.transform = `translate(${x}px, ${y}px)`;
}

function show(where: Spot | Element, content: HTMLElement, by: unknown, pin: boolean, aside = false): void {
  const anchor = where instanceof Element ? where : null;
  if (anchor && !anchor.isConnected) return;
  const spot = where instanceof Element ? spotOf(where) : where;
  const node = el("div", `k-tip k-float raid-card${pin ? " pinned" : ""}`, { role: "tooltip" }, content);
  if (content.classList.contains("wide")) node.classList.add("wide");
  if (pin) {
    kept?.node.remove();
    passing?.node.remove();
    passing = null;
  } else passing?.node.remove();
  document.body.append(node);
  place(node, spot, aside);
  const box: Box = { node, owner: by, anchor, spot, aside };
  if (pin) kept = box;
  else passing = box;
}

/** Shows a card beside a spot on the page. A kept card stays until put away; a passing one shows over it. */
export function cardAt(spot: Spot, content: HTMLElement, by: unknown, pinned = false): void {
  show(spot, content, by, pinned);
}
/** Shows a card beside an element (to its side, with `aside`), and keeps it there if the page is laid out again. */
export function cardBy(target: Element, content: HTMLElement, by: unknown, pinned = false, aside = false): void {
  show(target, content, by, pinned, aside);
}
/** Puts cards away: with `by`, only that owner's; without, both. */
export function cardOff(by: unknown = null): void {
  if (passing && (by === null || passing.owner === by)) {
    passing.node.remove();
    passing = null;
  }
  if (kept && (by === null || kept.owner === by)) {
    kept.node.remove();
    kept = null;
  }
}
/** Whose kept card is up, if any. */
export const keptOwner = (): unknown => kept?.owner ?? null;
/** Whether any card is up. */
export const cardUp = (): boolean => kept !== null || passing !== null;
/** Whether a point on the page is on a card that is showing. */
export const onCard = (target: EventTarget | null): boolean =>
  target instanceof Node && ((kept?.node.contains(target) ?? false) || (passing?.node.contains(target) ?? false));

/**
 * Puts a card in the kept card's place, over the same corner of the page and beside the same thing,
 * with a new owner: a trait's card opened from a figure's, a figure's from a trait's. Gives whether
 * there was a kept card to replace.
 */
export function swapKept(content: HTMLElement, by: unknown): boolean {
  const was = kept;
  if (!was) return false;
  const r = was.node.getBoundingClientRect();
  const node = el("div", "k-tip k-float raid-card pinned", { role: "tooltip" }, content);
  if (content.classList.contains("wide")) node.classList.add("wide");
  was.node.remove();
  passing?.node.remove();
  passing = null;
  document.body.append(node);
  const n = node.getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(4, r.left), window.innerWidth - n.width - 4));
  const y = Math.round(Math.min(Math.max(4, r.top), window.innerHeight - n.height - 4));
  node.style.transform = `translate(${x}px, ${y}px)`;
  kept = { node, owner: by, anchor: was.anchor, spot: was.spot, aside: was.aside };
  return true;
}

/**
 * The page has been laid out again: a card beside an element moves with it (or goes, if the element
 * has gone), and a card beside a spot stays where it was if `keepSpots`, or else goes.
 */
export function recard(keepSpots: boolean): void {
  for (const box of [kept, passing]) {
    if (!box) continue;
    if (box.anchor ? !box.anchor.isConnected : !keepSpots) {
      cardOff(box.owner);
      continue;
    }
    place(box.node, box.anchor ? spotOf(box.anchor) : box.spot, box.aside);
  }
}

/**
 * Gives an element a card, made afresh each time it shows: on resting the mouse there, on keyboard
 * focus, and on a long press with a finger (which then does not count as a tap). A click with the
 * mouse puts the card away for the click, and it comes back if the mouse stays.
 */
export function explain(target: HTMLElement, build: () => HTMLElement | null): void {
  let rest = 0;
  let press = 0;
  let swallow = false;
  const open = (): void => {
    if (!target.isConnected) return;
    const content = build();
    if (content) cardBy(target, content, target);
  };
  const soon = (): void => {
    window.clearTimeout(rest);
    rest = window.setTimeout(open, 180);
  };
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") soon();
  });
  target.addEventListener("pointerleave", () => {
    window.clearTimeout(rest);
    cardOff(target);
  });
  target.addEventListener("focus", () => {
    if (target.matches(":focus-visible")) open();
  });
  target.addEventListener("blur", () => cardOff(target));
  target.addEventListener("pointerdown", (e) => {
    window.clearTimeout(rest);
    if (e.pointerType === "mouse") {
      cardOff(target);
      return;
    }
    swallow = false;
    window.clearTimeout(press);
    press = window.setTimeout(() => {
      swallow = true;
      open();
    }, LONG_PRESS);
  });
  const lift = (): void => window.clearTimeout(press);
  target.addEventListener("pointerup", (e) => {
    lift();
    // The click is over and the mouse is still here: the card comes back, unless something else is showing.
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(rest);
    rest = window.setTimeout(() => {
      if (!cardUp() && target.matches(":hover")) open();
    }, 260);
  });
  target.addEventListener("pointercancel", lift);
  target.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) lift();
  });
  target.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}

// ---------- trait chips that do something ----------

/** What a trait's chip does when it is pointed at, left, or pressed; and a figure picked from a trait's card. */
export interface ChipHooks {
  point: (trait: TraitId, chip: HTMLElement) => void;
  leave: (trait: TraitId, chip: HTMLElement) => void;
  press: (trait: TraitId, chip: HTMLElement) => void;
  figure: (kind: FigureId, from: HTMLElement) => void;
}
let chipHooks: ChipHooks | null = null;
/** Says what trait chips do; `lit.ts` answers. */
export const hookChips = (hooks: ChipHooks): void => {
  chipHooks = hooks;
};

/** Makes an element a trait's chip: pointing lights the trait, pressing (or tapping) keeps it and opens its card. */
export function wireChip(chip: HTMLElement, trait: TraitId): void {
  chip.dataset.chip = trait;
  chip.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") chipHooks?.point(trait, chip);
  });
  chip.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") chipHooks?.leave(trait, chip);
  });
  chip.addEventListener("focus", () => {
    if (chip.matches(":focus-visible")) chipHooks?.point(trait, chip);
  });
  chip.addEventListener("blur", () => chipHooks?.leave(trait, chip));
  chip.addEventListener("click", () => chipHooks?.press(trait, chip));
}

// ---------- the words on a card ----------

const RICH: Readonly<Record<string, string>> = {
  number: "n",
  mend: "n mend",
  physical: "dmg phys",
  magic: "dmg magic",
  true: "dmg true",
};
/**
 * A short form with its numbers bold and gold, heals and shields green, and the kinds of damage
 * coloured; each fragment on a line of its own.
 */
export function rich(text: string, cls = "short"): HTMLElement {
  const box = el("div", cls);
  for (const fragment of text.split(/(?<=\.)\s+/)) {
    const line = el("div", "frag");
    for (const p of richPieces(fragment)) {
      const c = RICH[p.tone];
      line.append(c ? el("b", c, { text: p.text }) : p.text);
    }
    box.append(line);
  }
  return box;
}

const line = (text: string, cls = "k-d"): HTMLElement => el("div", cls, { text });
const label = (text: string): HTMLElement => el("span", "k-label", { text });
/** A thin rule between the blocks of a card. */
const block = (cls: string, ...kids: (Node | string | null)[]): HTMLElement => el("div", `blk ${cls}`, {}, ...kids);

/** A trait as a small tag: its sign and its name. */
export function traitTag(id: TraitId, lit = false): HTMLElement {
  return el("span", `k-chip${lit ? " lit" : ""}`, {}, pic(traitIcon(id)), TRAITS[id].name);
}
/** An amount of acorns with their sign. */
export const acorns = (n: number | string): HTMLElement => el("span", "k-cur", {}, icon("acorn"), String(n));

const tierName = ["", "one acorn", "two acorns", "three acorns", "four acorns", "five acorns"];

/** An item's picture in a hollow, with its name and what it does as a tip. */
function itemSlot(item: ItemId, lit = false, note = ""): HTMLElement {
  const slot = el("span", `k-slot islot${lit ? " lit" : ""}`, { tabindex: 0 }, pic(itemIcon(item)));
  tip(slot, itemName(item), () => `${itemShort(item)}${note ? ` ${note}` : ""}`);
  return slot;
}

// ---------- a figure ----------

export interface FigureExtras {
  items?: readonly ItemId[];
  /** How many times Greg has eaten. */
  fed?: number;
  /** Something to do with it, under its card: selling it, say. */
  actions?: HTMLElement | null;
  /** As it stands in a fight just now. */
  unit?: Unit;
  /** A line under the price: whose it is. */
  whose?: string;
  /** Its numbers as the next fight would start them, when they are known. */
  numbers?: Numbers | null;
  /** The run, for the traits' counts and the rack; none in the almanac. */
  run?: Run | null;
  /** The party it belongs to, for the traits' counts, when it is not the member's. */
  party?: Pick<Party, "figures" | "charms"> | null;
  /** The almanac's card: the long sentence and the flavour line too. */
  lore?: boolean;
}

/** A trait's chip on a figure's card: a small label over it, and the count as the strip shows it. */
function cardChip(trait: TraitId, over: string, count: TraitCount | null): HTMLElement {
  const chip = el(
    "button",
    "tchip",
    { type: "button", "aria-label": `${TRAITS[trait].name}, ${over.toLowerCase()}` },
    label(over),
    el(
      "span",
      `k-chip${count && count.step > 0 ? " lit" : ""}`,
      {},
      pic(traitIcon(trait)),
      TRAITS[trait].name,
      count ? el("b", "cnt", { text: `${count.count}/${count.next}` }) : null,
    ),
  );
  wireChip(chip, trait);
  return chip;
}

function numberCell(name: string, now: string, raised: number): HTMLElement {
  return el(
    "span",
    "num",
    {},
    label(name),
    el("b", raised > 0 ? "k-leafy" : raised < 0 ? "k-coral" : "", { text: now }),
  );
}

/** Any figure's card: its role, its traits, its numbers, its ability in a few words, and the items that suit it. */
export function figureCard(kind: UnitKind, stars: Stars, extras: FigureExtras = {}): HTMLElement {
  const spec = specOf(kind);
  const u = extras.unit;
  const figure = isFigureId(kind) ? FIGURES[kind] : null;
  const card = el("div", "card fig wide");

  // The head: its picture, name, stars and price, and what kind of fighter it is.
  const right = el(
    "span",
    "side",
    {},
    figure ? acorns(figure.tier) : null,
    extras.whose ? el("span", "k-d", { text: extras.whose }) : null,
  );
  add(
    card,
    el(
      "div",
      "fhead",
      {},
      el("span", "k-slot port", {}, pic(portrait(kind), 2)),
      el(
        "div",
        "cwho",
        {},
        el("div", "nameline", {}, el("b", "k-gold", { text: spec.name }), pic(starsPic(stars)), right),
        figure ? line(roleLine(figure.calling)) : null,
      ),
    ),
  );

  // Its traits, each a button that lights the trait.
  if (figure && isFigureId(kind)) {
    const count = (t: TraitId): TraitCount | null =>
      extras.party ? traitCount(extras.party, t) : extras.run ? ownTraitCount(extras.run, t) : null;
    const [kin, calling, ...more] = traitsOf(kind);
    add(
      card,
      block(
        "ftraits",
        kin ? cardChip(kin, "Kin", count(kin)) : null,
        calling ? cardChip(calling, "Calling", count(calling)) : null,
        ...more.map((t) => cardChip(t, "Also", count(t))),
      ),
    );
  }

  // Its numbers: raised by what it holds or belongs to in green, lowered in coral.
  const plain = plainNumbers(kind, stars);
  const now: Numbers = u
    ? { health: u.maxHp, attack: u.attack, speed: u.speed, reach: u.range, armour: u.armour, ward: u.ward }
    : (extras.numbers ?? plain);
  const shown = (key: (typeof NUMBER_KEYS)[number]): string => {
    if (key === "speed") return spec.speed > 0 ? `${now.speed.toFixed(2)}/s` : "none";
    if (key === "health" && u) return `${Math.max(0, Math.round(u.hp))}/${Math.round(u.maxHp)}`;
    return String(Math.round(now[key]));
  };
  const diff = (key: (typeof NUMBER_KEYS)[number]): number => {
    const d = now[key] - plain[key];
    return Math.abs(d) < (key === "speed" ? 0.005 : 0.5) ? 0 : d;
  };
  const names = { health: "Health", attack: "Attack", speed: "Speed", reach: "Reach", armour: "Armour", ward: "Ward" };
  const nums = block("nums", ...NUMBER_KEYS.map((key) => numberCell(names[key], shown(key), diff(key))));
  if (kind === "greg" && (extras.fed ?? 0) > 0)
    add(nums, el("span", "k-d fed", { text: `Has eaten ${extras.fed} times: +${(extras.fed ?? 0) * 3}% health.` }));
  add(card, nums);

  // Its ability, in a few words.
  if (spec.ability) {
    add(
      card,
      block(
        "abil",
        el(
          "div",
          "aname",
          {},
          el("b", "", { text: spec.ability.name }),
          spec.mana[1] > 0 ? el("span", "k-d", { text: `mana ${spec.mana[1]}` }) : null,
        ),
        rich(abilityShort(kind, stars)),
      ),
    );
  }

  // What it holds, and what suits it.
  const items = extras.items ?? u?.items ?? [];
  const run = extras.run ?? null;
  if (items.length > 0 || isFigureId(kind)) {
    const parts: (Node | null)[] = [];
    if (items.length > 0) parts.push(el("div", "irow", {}, label("Holds"), ...items.map((item) => itemSlot(item))));
    if (isFigureId(kind)) {
      const good = GOOD_WITH[kind].map((item: FinishedId) => {
        const has = run ? rackHas(run, item) : null;
        const [a, b] = FINISHED[item].made;
        const note =
          has === "item"
            ? "On your rack."
            : has === "parts"
              ? `${COMPONENTS[a].name} and ${COMPONENTS[b].name} are on your rack.`
              : `${COMPONENTS[a].name} and ${COMPONENTS[b].name}.`;
        return itemSlot(item, has !== null, note);
      });
      parts.push(el("div", "irow", {}, label("Good with"), ...good));
    }
    add(card, block("fitems", ...parts));
  }

  if (extras.lore) {
    add(
      card,
      block(
        "lore",
        spec.ability ? line(abilityText(kind, stars), "") : null,
        el("i", "k-dim quip", { text: spec.quip }),
      ),
    );
  }
  if (extras.actions) add(card, block("acts", extras.actions));
  return card;
}

/** One of the party's own figures, with what it holds, its numbers as they stand, and a way to sell it. */
export function pieceCard(piece: Piece, actions: HTMLElement | null, run: Run, numbers: Numbers | null): HTMLElement {
  return figureCard(piece.kind, piece.stars, { items: piece.items, fed: piece.fed, actions, run, numbers });
}

// ---------- a trait ----------

/** A figure in a trait's card: its picture, name and price; lit if fielded, tagged if on the bench or the stall, dark if not opened yet. */
function member(id: FigureId, run: Run | null, almanac: Almanac): HTMLElement {
  const where = run ? whereIs(run, id) : null;
  const locked = isLocked(id) && !almanac.opened.includes(id) && where === null;
  const how = MILESTONES.find((m) => m.figure === id)?.text ?? "";
  const name = locked && id === "crab40" ? "Uncounted" : FIGURES[id].name;
  const slot = el(
    "button",
    `k-slot mem${where === "board" ? " lit" : ""}${locked ? " locked" : ""}`,
    { type: "button", "data-member": id, "aria-label": name, disabled: locked },
    el("span", "art", {}, pic(portrait(id, { dark: locked }))),
    el("span", "k-s mname", { text: name }),
    locked ? el("span", "k-s how", { text: how }) : acorns(FIGURES[id].tier),
    where === "bench" || where === "stall" ? el("span", "k-s tag", { text: where }) : null,
  );
  if (!locked) slot.addEventListener("click", () => chipHooks?.figure(id, slot));
  return slot;
}

/** A trait's card: what it is, its steps, and every figure that carries it. */
export function traitCard(id: TraitId, run: Run | null, almanac: Almanac, lore = false): HTMLElement {
  const spec = TRAITS[id];
  const state = run ? ownTraitCount(run, id) : null;
  const count = state?.count ?? 0;
  const step = state?.step ?? 0;
  const card = el(
    "div",
    "card trait wide",
    {},
    el(
      "div",
      "thead",
      {},
      el("span", "k-slot port", {}, pic(traitIcon(id), 2)),
      el(
        "div",
        "cwho",
        {},
        el(
          "div",
          "nameline",
          {},
          el("b", "k-gold", { text: spec.name }),
          label(spec.sort === "kin" ? "Kin" : spec.sort === "calling" ? "Calling" : "Own"),
          state ? el("span", "side", {}, el("b", "cnt", { text: `${count}/${state.next}` })) : null,
        ),
        line(spec.gist),
      ),
    ),
  );
  const next = spec.steps.findIndex((need) => need > count);
  const steps = block("tsteps");
  spec.steps.forEach((need, i) => {
    const more = run && i === next ? need - count : 0;
    add(
      steps,
      el(
        "div",
        `tstep${step === i + 1 ? " on" : ""}`,
        {},
        el("b", "need", { text: String(need) }),
        rich(traitShort(id, i + 1), "short"),
        more > 0 ? el("span", "k-label more", { text: `${more} more` }) : null,
      ),
    );
  });
  add(card, steps);
  add(card, block("members", ...membersOf(id).map((f) => member(f, run, almanac))));
  if (lore) {
    add(
      card,
      block(
        "lore",
        ...spec.steps.map((need, i) => el("div", "", {}, el("b", "", { text: `${need}: ` }), traitText(id, i + 1))),
      ),
    );
  }
  if (run) {
    const charms = run.boons.filter((b) => BOONS[b].charm === id).length;
    if (charms > 0) add(card, line(`A charm counts as one more.`));
  }
  return card;
}

// ---------- an item, a boon ----------

/** What an item adds, in numbers, on one line. */
const addsLine = (id: ItemId): HTMLElement => rich(itemAdds(id).join(" · "), "adds");

/** An item's card: what it adds, what it does, and what it is made of or makes. */
export function itemCard(id: ItemId, run: Run | null, itemAt = -1, lore = false): HTMLElement {
  const component = isComponentId(id);
  const card = el(
    "div",
    "card item",
    {},
    el(
      "div",
      "thead",
      {},
      el("span", "k-slot port", {}, pic(itemIcon(id), 2)),
      el(
        "div",
        "cwho",
        {},
        el("b", "k-gold", { text: itemName(id) }),
        line(component ? "A component" : "A finished item"),
      ),
    ),
  );
  add(card, block("adds", addsLine(id), component ? null : rich(itemShort(id))));
  if (component) {
    const held = run ? combosWithHeld(run, id, itemAt) : [];
    const rows = held.length > 0 ? held : recipesOf(id);
    const recipes = block("recipes", label(held.length > 0 ? "With what you hold" : "Two on one figure make"));
    for (const r of rows) {
      add(
        recipes,
        el(
          "div",
          "recipe",
          {},
          pic(itemIcon(r.with)),
          el("span", "k-dim", { text: "makes" }),
          pic(itemIcon(r.makes)),
          el("span", "", { text: itemName(r.makes) }),
        ),
      );
    }
    add(card, recipes);
  } else {
    const [a, b] = FINISHED[id].made;
    add(
      card,
      block(
        "recipes",
        el(
          "div",
          "recipe",
          {},
          label("Made of"),
          itemSlot(a),
          el("span", "k-dim", { text: "+" }),
          itemSlot(b),
          el("span", "k-d", { text: `${COMPONENTS[a].name} and ${COMPONENTS[b].name}` }),
        ),
      ),
    );
  }
  if (lore) {
    add(
      card,
      block(
        "lore",
        line(itemText(id), ""),
        el("i", "k-dim quip", { text: component ? COMPONENTS[id].quip : FINISHED[id].quip }),
      ),
    );
  }
  return card;
}

/** What two things would become, shown while one is held over a figure. */
export function forgeCard(holding: ItemId, withItem: ItemId, makes: ItemId): HTMLElement {
  return el(
    "div",
    "card item",
    {},
    el(
      "div",
      "recipe big",
      {},
      pic(itemIcon(withItem), 2),
      el("b", "", { text: "+" }),
      pic(itemIcon(holding), 2),
      el("b", "", { text: "=" }),
      pic(itemIcon(makes), 2),
    ),
    el("b", "k-gold", { text: itemName(makes) }),
    block("adds", addsLine(makes), isComponentId(makes) ? null : rich(itemShort(makes))),
  );
}

export function boonCard(id: BoonId): HTMLElement {
  const spec = BOONS[id];
  return el(
    "div",
    "card boon",
    {},
    el(
      "div",
      "thead",
      {},
      el("span", "k-slot port", {}, pic(boonIcon(id), 2)),
      el("div", "cwho", {}, el("b", "k-gold", { text: spec.name }), line(spec.sort === "charm" ? "A charm" : "A boon")),
    ),
    block("adds", rich(boonShort(id))),
  );
}

// ---------- the rest ----------

const head = (art: HTMLElement | null, name: string, under: (Node | string | null)[]): HTMLElement =>
  el("div", "card-head", {}, art, el("div", "k-col tight", {}, el("b", "k-gold", { text: name }), ...under));

/** A room on the track: what kind it is, who is or was there, and what it gives. */
export function roomCard(index: number, run: Run): HTMLElement {
  const room = ROOMS[index];
  if (!room) return el("div", "card", { text: "" });
  const record = run.record.findLast((r) => r.room === index);
  const here = run.room === index && run.phase !== "over";
  const kind = room.kind === "spar" ? "Sparring" : room.kind === "boss" ? "A boss" : "Trouble";
  const card = el(
    "div",
    "k-col card",
    {},
    head(pic(roomIcon(room.kind), 2), `Room ${index + 1}`, [line(`${kind}, wing ${room.wing}.`)]),
  );
  if (here) add(card, el("div", "", {}, el("b", "", { text: run.foe.who }), run.foe.title ? `: ${run.foe.title}` : ""));
  if (record) add(card, line(record.result === "win" ? "Won." : record.result === "loss" ? "Lost." : "A draw.", ""));
  else if (room.kind === "spar")
    add(card, line("A guild-mate's party. It pays the same, won or lost, but a win pays an acorn more."));
  else if (room.kind === "trouble")
    add(
      card,
      line(
        `The forest's own. Win for a pick of ${ECONOMY.componentsWon} components; lose and it is ${ECONOMY.componentsLost}.`,
      ),
    );
  else
    add(
      card,
      line(
        index === ROOMS.length - 1
          ? "The last room. It is fought until it is won, or the party goes home."
          : "Beat it for two picks of components, and a boon either way.",
      ),
    );
  if (ECONOMY.boonRooms.some((r) => r === index) && room.kind !== "boss")
    add(card, line("A boon is offered after it."));
  return card;
}

/** The purse of acorns: how the savings are counted. */
export function purseCard(run: Run): HTMLElement {
  const s = savings(run);
  return el(
    "div",
    "k-col card",
    {},
    head(pic(glyph("acorn"), 2), "Acorns", [line("The money inside a raid.")]),
    line(`Every room pays ${ECONOMY.roomAcorns}, and 1 more for a win.`, ""),
    line(
      `Every ${s.per} you keep earns 1 more each room, up to ${s.most}. You will be paid ${s.pays} for what you hold now.`,
      "",
    ),
    s.toNext > 0 ? line(`${s.toNext} more for the next pile.`) : line("Every pile is full."),
  );
}

/** The level: how many may be fielded, and what the stall offers at it. */
export function levelCard(run: Run): HTMLElement {
  const odds = STALL_ODDS[Math.min(run.level, STALL_ODDS.length) - 1] ?? STALL_ODDS[0] ?? [100, 0, 0, 0, 0];
  const parts = odds.flatMap((share, i) => (share > 0 ? [`${tierName[i + 1] ?? ""} ${share}%`] : []));
  return el(
    "div",
    "k-col card",
    {},
    el("b", "k-gold", { text: `Level ${run.level}` }),
    line("The level is how many figures you may field.", ""),
    line(
      `${ECONOMY.xpCost} acorns buy ${ECONOMY.xpBought} experience; every room gives ${ECONOMY.xpRoom} for nothing.`,
    ),
    el("div", "k-label", { text: "The stall offers" }),
    line(parts.join(", "), ""),
  );
}

export function trailCard(index: number): HTMLElement {
  const trail = TRAILS[index];
  return el("div", "k-col card", {}, el("b", "k-gold", { text: trail?.name ?? "" }), line(trail?.text ?? "", ""));
}

/** A plain card: a name and a line about it. */
export function plainCard(title: string, text: string): HTMLElement {
  return el("div", "k-col card", {}, el("b", "k-gold", { text: title }), text ? line(text) : null);
}
