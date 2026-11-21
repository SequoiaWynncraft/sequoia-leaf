/**
 * Cards: what a thing is, said in a `k-tip` beside it. Pointing at anything (or pressing on it
 * with a finger) shows its card: a figure with its numbers and its ability in a sentence, a trait
 * with what each step does and who carries it, an item with what it makes, a boon, a room.
 *
 * One card is on the page at a time. A card may be pinned (it stays, and can hold a button) or
 * passing (it goes when the pointer does).
 */
import { add, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/tip.ts";

import {
  abilityText,
  type Almanac,
  type BoonId,
  BOONS,
  boonText,
  COMPONENTS,
  ECONOMY,
  type FigureId,
  FIGURES,
  FINISHED,
  isComponentId,
  isFigureId,
  isLocked,
  type ItemId,
  itemName,
  itemText,
  MILESTONES,
  type Piece,
  ROOMS,
  type Run,
  specOf,
  STALL_ODDS,
  type Stars,
  starScale,
  TRAILS,
  type TraitId,
  TRAITS,
  traitsNow,
  traitsOf,
  traitText,
  type Unit,
  type UnitKind,
} from "../../game/index.ts";
import { boonIcon, glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { portrait, starsPic } from "../art/sprites.ts";
import { combosWithHeld, recipesOf, savings } from "../logic.ts";

/** A spot on the page for a card to sit beside, in CSS pixels. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

let box: HTMLElement | null = null;
let owner: unknown = null;

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

/** Shows a card beside a spot: above it where there is room, otherwise below; never off the page. */
export function cardAt(spot: Spot, content: HTMLElement, by: unknown, pinned = false): void {
  cardOff();
  const node = el("div", `k-tip k-float raid-card${pinned ? " pinned" : ""}`, { role: "tooltip" }, content);
  document.body.append(node);
  const r = node.getBoundingClientRect();
  const gap = 8;
  const x = Math.round(Math.min(Math.max(4, spot.x + spot.w / 2 - r.width / 2), window.innerWidth - r.width - 4));
  const above = spot.y - r.height - gap;
  const below = spot.y + spot.h + gap;
  let y =
    above >= 4
      ? above
      : below + r.height <= window.innerHeight - 4
        ? below
        : Math.max(4, window.innerHeight - r.height - 4);
  // Beside it, when neither above nor below has the room.
  if (above < 4 && below + r.height > window.innerHeight - 4) {
    const right = spot.x + spot.w + gap;
    const left = spot.x - r.width - gap;
    const sx = right + r.width <= window.innerWidth - 4 ? right : left >= 4 ? left : x;
    node.style.transform = `translate(${Math.round(sx)}px, ${Math.round(y)}px)`;
  } else {
    y = Math.round(y);
    node.style.transform = `translate(${x}px, ${y}px)`;
  }
  box = node;
  owner = by;
}
/** Puts the card away; with `by`, only if it is that owner's. */
export function cardOff(by: unknown = null): void {
  if (by !== null && owner !== by) return;
  box?.remove();
  box = null;
  owner = null;
}
export const cardOwner = (): unknown => owner;
/** Whether a point on the page is on the card that is showing. */
export const onCard = (target: EventTarget | null): boolean =>
  target instanceof Node && box !== null && box.contains(target);

const spotOf = (target: Element): Spot => {
  const r = target.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * Gives an element a card, made afresh each time it shows: on resting the mouse there, on keyboard
 * focus, and on a long press with a finger (which then does not count as a tap).
 */
export function explain(target: HTMLElement, build: () => HTMLElement | null): void {
  let rest = 0;
  let press = 0;
  let swallow = false;
  const show = (): void => {
    const content = build();
    if (content) cardAt(spotOf(target), content, target);
  };
  target.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(rest);
    rest = window.setTimeout(show, 180);
  });
  target.addEventListener("pointerleave", () => {
    window.clearTimeout(rest);
    cardOff(target);
  });
  target.addEventListener("focus", () => {
    if (target.matches(":focus-visible")) show();
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
      show();
    }, LONG_PRESS);
  });
  const lift = (): void => window.clearTimeout(press);
  target.addEventListener("pointerup", lift);
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

// ---------- what the cards say ----------

const head = (art: HTMLElement | null, name: string, under: (Node | string | null)[]): HTMLElement =>
  el("div", "card-head", {}, art, el("div", "k-col tight", {}, el("b", "k-gold", { text: name }), ...under));

const line = (text: string, cls = "k-d"): HTMLElement => el("div", cls, { text });

/** A trait as a small tag: its sign and its name. */
export function traitTag(id: TraitId, lit = false): HTMLElement {
  return el("span", `k-chip${lit ? " lit" : ""}`, {}, pic(traitIcon(id)), TRAITS[id].name);
}
/** An amount of acorns with their sign. */
export const acorns = (n: number | string): HTMLElement => el("span", "k-cur", {}, icon("acorn"), String(n));

const tierName = ["", "one acorn", "two acorns", "three acorns", "four acorns", "five acorns"];

function stat(name: string, value: string): HTMLElement {
  return el("div", "stat", {}, el("span", "k-dim", { text: name }), el("b", "", { text: value }));
}

export interface FigureExtras {
  items?: readonly ItemId[];
  /** How many times Greg has eaten. */
  fed?: number;
  /** Something to do with it, under its card: selling it, say. */
  actions?: HTMLElement | null;
  /** As it stands in a fight just now. */
  unit?: Unit;
  /** A line above everything: whose it is. */
  whose?: string;
}

/** Any figure's card: stars, numbers, its ability in a sentence, its kin and calling, what it holds. */
export function figureCard(kind: UnitKind, stars: Stars, extras: FigureExtras = {}): HTMLElement {
  const spec = specOf(kind);
  const scale = starScale(stars);
  const u = extras.unit;
  const figure = isFigureId(kind) ? FIGURES[kind] : null;
  const under: (Node | string | null)[] = [
    el("span", "k-row tight", {}, pic(starsPic(stars)), figure ? acorns(figure.tier) : null),
  ];
  if (extras.whose) under.push(line(extras.whose));
  const card = el("div", "k-col card", {}, head(pic(portrait(kind), 2), spec.name, under));
  const hp = u ? `${Math.max(0, Math.round(u.hp))}/${u.maxHp}` : String(Math.round(spec.hp * scale));
  const atk = u ? String(u.attack) : String(Math.round(spec.attack * scale));
  add(
    card,
    el(
      "div",
      "stats",
      {},
      stat("Health", hp),
      stat("Attack", atk),
      stat("Speed", spec.speed > 0 ? `${(u?.speed ?? spec.speed).toFixed(2)}/s` : "none"),
      stat("Reach", String(u?.range ?? spec.range)),
      stat("Armour", String(u?.armour ?? spec.armour)),
      stat("Ward", String(u?.ward ?? spec.ward)),
    ),
  );
  if (spec.ability) {
    const mana = spec.mana[1] > 0 ? ` (${spec.mana[1]} mana)` : "";
    add(
      card,
      el(
        "div",
        "k-col tight",
        {},
        el("b", "", { text: `${spec.ability.name}${mana}` }),
        line(abilityText(kind, stars)),
      ),
    );
  }
  if (isFigureId(kind)) add(card, el("div", "k-wrap", {}, ...traitsOf(kind).map((t) => traitTag(t))));
  const items = extras.items ?? u?.items ?? [];
  if (items.length > 0) {
    add(
      card,
      el(
        "div",
        "k-col tight",
        {},
        ...items.map((item) =>
          el("div", "held", {}, pic(itemIcon(item)), el("span", "", { text: itemName(item) }), line(itemText(item))),
        ),
      ),
    );
  }
  if (kind === "greg" && (extras.fed ?? 0) > 0)
    add(card, line(`Has eaten ${extras.fed} times: +${(extras.fed ?? 0) * 3}% health.`));
  add(card, el("i", "k-dim quip", { text: spec.quip }));
  if (extras.actions) add(card, extras.actions);
  return card;
}
/** One of the party's own figures, with what it holds and a way to sell it. */
export function pieceCard(piece: Piece, actions: HTMLElement | null): HTMLElement {
  return figureCard(piece.kind, piece.stars, { items: piece.items, fed: piece.fed, actions });
}

/** A figure in a list of a trait's members: lit if fielded, plain if owned, dim if not, a dark outline if not opened yet. */
function member(id: FigureId, run: Run | null, almanac: Almanac): HTMLElement {
  const locked = isLocked(id) && !almanac.opened.includes(id);
  const onBoard = run?.board.some((p) => p?.kind === id) ?? false;
  const owned = run?.bench.some((p) => p?.kind === id) ?? false;
  const how = MILESTONES.find((m) => m.figure === id)?.text ?? "";
  const cls = locked ? "member locked" : onBoard ? "member on" : owned ? "member owned" : "member";
  const name = locked && id === "crab40" ? "Uncounted" : FIGURES[id].name;
  return el(
    "div",
    cls,
    {},
    pic(portrait(id, { dark: locked })),
    el("span", "", { text: name }),
    locked ? el("span", "k-dim how", { text: how }) : null,
  );
}

/** A trait's card: what each step does, who carries it, and how many the party fields. */
export function traitCard(id: TraitId, run: Run | null, almanac: Almanac): HTMLElement {
  const spec = TRAITS[id];
  const state = run ? traitsNow(run).find((t) => t.trait === id) : undefined;
  const count = state?.count ?? 0;
  const step = state?.step ?? 0;
  const card = el(
    "div",
    "k-col card",
    {},
    head(pic(traitIcon(id), 2), spec.name, [
      line(
        spec.sort === "kin"
          ? "A kin: what a figure is."
          : spec.sort === "calling"
            ? "A calling: what a figure does."
            : "There is one.",
      ),
      el("i", "k-dim", { text: spec.gist }),
    ]),
  );
  spec.steps.forEach((need, i) => {
    add(
      card,
      el(
        "div",
        `step${step === i + 1 ? " on" : ""}`,
        {},
        el("b", "", { text: String(need) }),
        el("span", "", { text: traitText(id, i + 1) }),
      ),
    );
  });
  const members = Object.keys(FIGURES)
    .filter(isFigureId)
    .filter((f) => traitsOf(f).includes(id));
  add(card, el("div", "members", {}, ...members.map((f) => member(f, run, almanac))));
  if (run) {
    const charms = run.boons.filter((b) => BOONS[b].charm === id).length;
    const next = spec.steps.find((need) => need > count);
    const say =
      count === 0
        ? "You field none of them."
        : `You field ${count}${charms > 0 ? ` (a charm counts for ${charms})` : ""}.${next ? ` ${next - count} more for the next step.` : " That is all of it."}`;
    add(card, line(say));
  }
  if (id === "crab") add(card, el("i", "k-dim quip", { text: "Every roll call, one crab is unaccounted for." }));
  return card;
}

/** An item's card: what it adds, and what it makes with the other components the party holds. */
export function itemCard(id: ItemId, run: Run | null, itemAt = -1): HTMLElement {
  const quip = isComponentId(id) ? COMPONENTS[id].quip : FINISHED[id].quip;
  const card = el(
    "div",
    "k-col card",
    {},
    head(pic(itemIcon(id), 2), itemName(id), [line(isComponentId(id) ? "A component." : "A finished item.")]),
    line(itemText(id), ""),
  );
  if (isComponentId(id)) {
    const held = run ? combosWithHeld(run, id, itemAt) : [];
    const rows = held.length > 0 ? held : recipesOf(id);
    add(card, el("div", "k-label", { text: held.length > 0 ? "With what you hold" : "Two on one figure make" }));
    for (const r of rows) {
      add(
        card,
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
  } else {
    const [a, b] = FINISHED[id].made;
    add(
      card,
      el(
        "div",
        "recipe",
        {},
        pic(itemIcon(a)),
        el("span", "k-dim", { text: "and" }),
        pic(itemIcon(b)),
        el("span", "k-dim", { text: "made it" }),
      ),
    );
  }
  add(card, el("i", "k-dim quip", { text: quip }));
  return card;
}

/** What two things would become, shown while one is held over a figure. */
export function forgeCard(holding: ItemId, withItem: ItemId, makes: ItemId): HTMLElement {
  return el(
    "div",
    "k-col card",
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
    line(itemText(makes)),
  );
}

export function boonCard(id: BoonId): HTMLElement {
  const spec = BOONS[id];
  return el(
    "div",
    "k-col card",
    {},
    head(pic(boonIcon(id), 2), spec.name, [line(spec.sort === "charm" ? "A charm." : "A boon.")]),
    line(boonText(id), ""),
    el("i", "k-dim quip", { text: spec.quip }),
  );
}

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
