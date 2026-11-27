import { nameOf, portrait, starsPic } from "@sequoia-leaf/figures/sprites.ts";
/**
 * Cards: what each thing at the table says about itself, in the kit's one card (`card.ts`). Every
 * kind of thing is registered once and named by a reference:
 *
 * - `figure:<kind>` a figure as the stall offers it (`figure:<kind>/<stars>/lore` in the almanac);
 * - `piece:<id>` one of the party's own, with what it holds, its numbers as they stand, and Sell;
 * - `foe:<seat>` one waiting across the board; `unit:<id>` anyone in a fight;
 * - `trait:<id>`, `item:<id>` (`item:<id>@<at>` on the rack), `boon:<id>`, `room:<index>`;
 * - `acorns:` the purse, `level:` the level. (`drop:` is the tip of an item in the hand, `drop.ts`.)
 *
 * The references are named in `refs.ts`. Cards use the short forms; the almanac's add the long
 * sentence and the flavour line.
 */
import { type Block, type Chip, type Description, type Entry, register, type Stat } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import {
  abilityShort,
  abilityText,
  type BoonId,
  BOONS,
  boonShort,
  carriedTraits,
  type ComponentId,
  drawName,
  drawOf,
  drawReach,
  drawTip,
  ECONOMY,
  EMBLEMS,
  type FigureId,
  FIGURES,
  FINISHED,
  isBoonId,
  isComponentId,
  isEmblemId,
  isFigureId,
  isItemId,
  isTraitId,
  itemAdds,
  type ItemId,
  itemName,
  itemQuip,
  itemShort,
  itemText,
  type Party,
  pieceAt,
  pieces,
  roleLine,
  type RunView,
  sellValue,
  specOf,
  spotOf,
  type Stars,
  traitDraw,
  type TraitId,
  TRAITS,
  traitShort,
  traitText,
  type Unit,
  type UnitKind,
} from "@sequoia-leaf/raid";

import { boonIcon, glyph, itemIcon, traitIcon } from "../art/icons.ts";
import { FV } from "../board.ts";
import { fightUnits } from "../fightview.ts";
import { attacks, formLines, formOf, shownName } from "../forms.ts";
import {
  acrossName,
  combosWithHeld,
  membersOf,
  NUMBER_KEYS,
  type Numbers,
  ownTraitCount,
  pieceNumbers,
  plainNumbers,
  recipesOf,
  savings,
  startNumbers,
  streakNow,
  streakRule,
  type TraitCount,
  traitCount,
  whereIs,
} from "../logic.ts";
import { pieces as richPieces } from "../rich.ts";
import { doNow, S } from "../state.ts";
import { chairsSaid } from "./endless.ts";
import { feedActions } from "./feedtarget.ts";
import { figuresAt, levelOnCard, oddsStats } from "./own.ts";
import { figureRef, itemRef, pieceRef, traitRef } from "./refs.ts";
import { itemsOf, wantedBy } from "./suits.ts";
import { fedLine, sortWord } from "./words.ts";

export * from "./refs.ts";

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
 * coloured; each fragment on a line of its own. It is read, so it is in the reading face.
 */
export function rich(text: string, cls = "short"): HTMLElement {
  const box = el("div", `k-read ${cls}`);
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

/** An amount of acorns with their sign. */
export const acorns = (n: number | string): HTMLElement => el("span", "k-cur", {}, icon("acorn"), String(n));

/** An id and the flags after it: `"emberkit/3/lore"` is `emberkit` with `3` and `lore`. */
const flagsOf = (id: string): { id: string; flags: string[] } => {
  const [head = "", ...flags] = id.split("/");
  return { id: head, flags };
};
const starsOf = (flags: readonly string[]): Stars => (flags.includes("3") ? 3 : flags.includes("2") ? 2 : 1);

// ---------- a figure ----------

export interface FigureExtras {
  items?: readonly ItemId[];
  /** What Greg has gained from eating, in percent of his health. */
  fed?: number;
  /** Its level, in a run with the member's own figures or among the figures they have pulled. */
  level?: number;
  /** As it stands in a fight just now. */
  unit?: Unit;
  /** A line under the price: whose it is. */
  whose?: string;
  /** Its numbers as the next fight would start them, when they are known. */
  numbers?: Numbers | null;
  /** The run, for the traits' counts and the rack; none in the almanac. */
  run?: RunView | null;
  /** The party it belongs to, for the traits' counts, when it is not the member's. */
  party?: Pick<Party, "figures"> | null;
  /** The almanac's card: the long sentence and the flavour line too. */
  lore?: boolean;
  /** One of the party's own while planning: it can be sold. */
  sellable?: { id: number } | null;
}

const NAMES = { health: "Health", attack: "Attack", speed: "Speed", reach: "Reach", armour: "Armour", ward: "Ward" };

/** A figure's numbers for its card: raised by what it holds, belongs to or its level in green, lowered in coral. */
function statsOf(kind: UnitKind, stars: Stars, extras: FigureExtras, level: number): Stat[] {
  const u = extras.unit;
  const plain = plainNumbers(kind, stars);
  const now: Numbers = u
    ? { health: u.maxHp, attack: u.attack, speed: u.speed, reach: u.range, armour: u.armour, ward: u.ward }
    : (extras.numbers ?? plainNumbers(kind, stars, level));
  return NUMBER_KEYS.map((key) => {
    const value =
      key === "speed"
        ? attacks(kind, u)
          ? `${now.speed.toFixed(2)}/s`
          : "none"
        : key === "health" && u
          ? `${whole(Math.max(0, u.hp))}/${whole(u.maxHp)}`
          : whole(now[key]);
    const d = now[key] - plain[key];
    const moved = Math.abs(d) < (key === "speed" ? 0.005 : 0.5) ? 0 : d;
    return moved === 0
      ? { label: NAMES[key], value }
      : { label: NAMES[key], value, mark: moved > 0 ? "raised" : "lowered" };
  });
}

/** Any figure: its role, its traits, its numbers, its ability in a few words, and the items that suit it. */
export function figureDesc(kind: UnitKind, stars: Stars, extras: FigureExtras = {}): Description {
  const spec = specOf(kind);
  const u = extras.unit;
  const figure = isFigureId(kind) ? FIGURES[kind] : null;

  const count = (t: TraitId): TraitCount | null =>
    extras.party ? traitCount(extras.party, t) : extras.run ? ownTraitCount(extras.run, t) : null;
  const items = extras.items ?? u?.items ?? [];
  // Its own traits, then the kin of any emblem it holds.
  const [kin, calling, ...more] = carriedTraits(kind, items);
  const chip = (t: TraitId | undefined, label: string): Chip | null => {
    if (!t) return null;
    const c = count(t);
    return {
      label,
      text: TRAITS[t].name,
      icon: traitIcon(t),
      ...(c ? { count: `${c.count}/${c.next}`, lit: c.step > 0 } : {}),
      ref: traitRef(t),
    };
  };

  const lv = levelOnCard(kind, extras);

  const blocks: Block[] = lv.blocks; // What its level gives comes first, under the numbers it raises.
  if (spec.ability)
    blocks.push({
      title: spec.ability.name,
      ...(spec.mana[1] > 0 ? { note: `mana ${spec.mana[1]}` } : {}),
      body: rich(abilityShort(kind, stars)),
    });
  // In its true form, the one change that form brings.
  blocks.push(...formLines(kind, u).map((body) => ({ body })));
  if (kind === "greg" && (extras.fed ?? 0) > 0) blocks.push({ body: fedLine(extras.fed ?? 0) });
  if (extras.lore) {
    if (spec.ability) blocks.push({ body: abilityText(kind, stars) });
    blocks.push({ body: el("i", "k-dim quip", { text: spec.quip }) });
  }

  // What it holds, and the three finished items that suit it: for one of the party's own, with their buttons.
  const run = extras.run ?? null;
  const sale = extras.sellable;
  const piece = sale && run ? pieces(run).find((p) => p.id === sale.id) : undefined;
  const held = itemsOf(kind, items, run, piece);
  blocks.push(...held.blocks);
  const draw = u ? u.draw : drawOf(kind, items);
  return {
    name: shownName(kind, u),
    icon: portrait(kind, { form: formOf(u) }),
    tag: isFigureId(kind) ? roleLine(kind) : "",
    aside: el(
      "span",
      "fside",
      {},
      el("span", "k-row tight", {}, lv.tag, pic(starsPic(stars)), figure ? acorns(figure.tier) : null),
      extras.whose ? el("span", "k-dim", { text: extras.whose }) : null,
    ),
    chips: [
      chip(kin, "Origin"),
      chip(calling, "Class"),
      ...more.map((t) => chip(t, sortWord(t))),
      drawChip(draw),
    ].filter((c): c is Chip => c !== null),
    stats: statsOf(kind, stars, extras, lv.level),
    blocks,
    rows: held.rows,
    actions:
      sale && piece && run
        ? [
            {
              label: "Sell",
              look: "wood sm wide",
              after: soldFor(piece),
              on: () => {
                const spot = spotOf(S.run ?? run, sale.id);
                // Sold from its card: the card goes with it.
                if (spot) doNow({ do: "sell", from: spot });
              },
            },
            ...feedActions(run, piece),
          ]
        : [],
  };
}

/** What selling a figure gives: its acorns, and the pictures of the items it holds, which go back to the rack as they are. */
function soldFor(piece: { readonly items: readonly ItemId[] } & Parameters<typeof sellValue>[0]): HTMLElement {
  const back =
    piece.items.length > 0
      ? el(
          "span",
          "k-row tight",
          { "aria-label": `and ${piece.items.map(itemName).join(", ")} back to the rack` },
          ...piece.items.map((item) => pic(itemIcon(item))),
        )
      : null;
  return el("span", "k-row tight", {}, acorns(`+${sellValue(piece)}`), back);
}

/** The chip after a figure's traits saying how it draws enemies' eyes, with a tip; none for a draw of 0. */
function drawChip(draw: number): Chip | null {
  const name = drawName(draw);
  return name ? { text: name, hint: drawTip(draw) } : null;
}

// ---------- a trait ----------

/** A figure in a trait's roster: lit if fielded, tagged if on the bench or the stall. */
function member(id: FigureId, run: RunView | null): Entry {
  const where = run ? whereIs(run, id) : null;
  const own = run
    ? pieces(run)
        .filter((p) => p.kind === id)
        .toSorted((a, b) => b.stars - a.stars)[0]
    : undefined;
  return {
    ref: own ? pieceRef(own.id) : figureRef(id),
    lit: where === "board",
    name: nameOf(id),
    icon: portrait(id),
    note: acorns(FIGURES[id].tier),
    ...(where === "bench" || where === "stall" ? { tag: where } : {}),
  };
}

/** A trait: what it is, its steps (the one reached lit, the next saying how many more), and every figure that carries it. */
export function traitDesc(id: TraitId, run: RunView | null, lore = false): Description {
  const spec = TRAITS[id];
  const state = run ? ownTraitCount(run, id) : null;
  const count = state?.count ?? 0;
  const step = state?.step ?? 0;
  const next = spec.steps.findIndex((need) => need > count);
  const blocks: Block[] = spec.steps.map((need, i) => {
    const more = run && i === next ? need - count : 0;
    return {
      line: true,
      title: String(need),
      body: rich(traitShort(id, i + 1)),
      lit: step === i + 1,
      ...(more > 0 ? { note: `${more} more` } : {}),
    };
  });
  // A calling that draws says so first, whatever its step.
  const draw = traitDraw(id);
  const draws = drawName(draw);
  if (draws) blocks.unshift({ body: rich(`${draws}: enemies pick them as if ${drawReach(draw)}.`) });
  if (lore) spec.steps.forEach((need, i) => blocks.push({ title: `${need}`, body: traitText(id, i + 1) }));
  return {
    name: spec.name,
    icon: traitIcon(id),
    tag: spec.gist,
    aside: el(
      "span",
      "k-row tight",
      {},
      el("span", "k-label", { text: sortWord(id) }),
      state ? el("b", "", { text: `${count}/${state.next}` }) : null,
    ),
    blocks,
    rows: [{ label: "Every figure", look: "tiles", things: membersOf(id, figuresAt(run)).map((f) => member(f, run)) }],
  };
}

// ---------- an item, a boon ----------

/** What an item adds, in numbers, on a line (an emblem adds none); and what it does. */
export const itemWords = (id: ItemId): HTMLElement => {
  const adds = itemAdds(id);
  return el(
    "div",
    "",
    {},
    adds.length > 0 ? rich(adds.join(" · "), "adds") : null,
    isComponentId(id) ? null : rich(itemShort(id)),
  );
};

/** What an item is in a line, for a tip: what it adds, and what it does unless that is all it does. */
const itemBrief = (id: ItemId): string =>
  [itemAdds(id).join(" · "), isComponentId(id) ? "" : itemShort(id)].filter((part) => part !== "").join(". ");

/**
 * An item: what it adds and does, and what it is made of or makes (or for an emblem, its kin). A
 * component's "makes" lines put first, lit and tagged "have", the ones whose other half the party
 * already holds. At the end of each line, the fielded figures that want what it makes (`wantedBy`).
 */
export function itemDesc(id: ItemId, run: RunView | null, itemAt = -1, lore = false): Description {
  const blocks: Block[] = [{ body: itemWords(id) }];
  if (lore) {
    blocks.push({ body: itemText(id) });
    blocks.push({ body: el("i", "k-dim quip", { text: itemQuip(id) }) });
  }
  if (isEmblemId(id)) {
    const kin = EMBLEMS[id];
    return {
      name: itemName(id),
      icon: itemIcon(id),
      brief: itemBrief(id),
      tag: "An emblem",
      blocks,
      chips: [{ label: "Origin", text: TRAITS[kin].name, icon: traitIcon(kin), ref: traitRef(kin) }],
    };
  }
  return {
    name: itemName(id),
    icon: itemIcon(id),
    brief: itemBrief(id),
    tag: isComponentId(id) ? "A component" : "A finished item",
    blocks,
    rows: isComponentId(id)
      ? [{ label: "With", things: makesLines(id, run, itemAt) }]
      : [{ label: "Made from", things: FINISHED[id].made.map((c) => ({ ref: itemRef(c) })) }],
  };
}

/** Where a "makes" line goes: the ones the party can finish first, and among those and the rest, the ones somebody fielded wants. */
const weight = (e: Entry): number => (e.lit ? 2 : 0) + (e.note ? 1 : 0);

/** A component's "makes" lines: the other half, an arrow, and the finished item; the ones the party can finish first. */
export function makesLines(id: ItemId, run: RunView | null, itemAt = -1): Entry[] {
  if (!isComponentId(id)) return [];
  const held = new Set(run ? combosWithHeld(run, id, itemAt).map((c) => c.with) : []);
  const line = (r: { with: ComponentId; makes: ItemId }): Entry => {
    const by = wantedBy(run, r.makes);
    return {
      ref: itemRef(r.makes),
      from: itemRef(r.with),
      ...(held.has(r.with) ? { lit: true, tag: "have" } : {}),
      ...(by ? { note: by } : {}),
    };
  };
  return recipesOf(id)
    .map(line)
    .toSorted((a, b) => weight(b) - weight(a));
}

export function boonDesc(id: BoonId): Description {
  const spec = BOONS[id];
  const kin = isEmblemId(id) ? EMBLEMS[id] : undefined;
  return {
    name: spec.name,
    icon: boonIcon(id),
    brief: boonShort(id),
    tag: spec.sort === "charm" ? "A charm" : "A boon",
    blocks: [{ body: rich(boonShort(id)) }],
    chips: kin ? [{ label: "Counts for", text: TRAITS[kin].name, icon: traitIcon(kin), ref: traitRef(kin) }] : [],
  };
}

// ---------- the rest ----------

/** The purse of acorns: how the savings are counted. */
function purseDesc(run: RunView): Description {
  const s = savings(run);
  return {
    name: "Acorns",
    icon: glyph("acorn"),
    tag: "The money inside a raid.",
    stats: [
      { label: "Held", value: whole(run.acorns) },
      { label: "Piles", value: `${s.piles}/${s.most}` },
      { label: "Pays", value: `+${s.pays}` },
    ],
    blocks: [
      {
        body: `Every room pays ${ECONOMY.roomAcorns}, and 1 more for a win. Every ${s.per} you keep earns 1 more each room, up to ${s.most}.`,
      },
      { body: s.toNext > 0 ? `${s.toNext} more for the next pile.` : "Every pile is full." },
      { body: [streakRule(), streakNow(run)].filter((line) => line !== null).join(" ") },
    ],
  };
}

/** The level: how many may be fielded, how XP comes, and what the stall offers at it, a tier a line. */
function levelDesc(run: RunView): Description {
  return {
    name: `Level ${run.level}`,
    icon: glyph("acorn"),
    tag: "How many figures you may field.",
    stats: oddsStats(run),
    blocks: [
      { body: `${ECONOMY.xpBought} XP for ${ECONOMY.xpCost} acorns. Every room gives ${ECONOMY.xpRoom} XP.` },
      ...chairsSaid(run).map((body) => ({ body })),
    ],
  };
}

/** Says what every kind of thing at the table is. */
export function registerCards(): void {
  register("figure", (raw) => {
    const { id, flags } = flagsOf(raw);
    if (!isFigureId(id)) return null;
    const lore = flags.includes("lore");
    return figureDesc(id, starsOf(flags), lore ? { lore } : { run: S.run });
  });
  register("piece", (raw) => {
    const run = S.run;
    const id = Number(raw);
    const spot = run ? spotOf(run, id) : null;
    const piece = run && spot ? pieceAt(run, spot) : null;
    if (!run || !spot || !piece) return null;
    const planning = S.screen.at === "plan" && run.stage.phase === "plan" && run.stage.picks.length === 0;
    return figureDesc(piece.kind, piece.stars, {
      items: piece.items,
      fed: piece.fed,
      run,
      numbers: pieceNumbers(run, spot),
      sellable: planning ? { id } : null,
    });
  });
  register("foe", (raw) => {
    const run = S.run;
    const foe = run?.foe.figures.find((p) => p.seat === Number(raw));
    if (!run || !foe) return null;
    return figureDesc(foe.kind, foe.stars, {
      items: foe.items,
      level: foe.level ?? 0,
      whose: `${acrossName(run.foe)}'s`,
      party: run.foe,
      numbers: startNumbers(run.era, run.foe, foe.seat),
    });
  });
  register("unit", (raw) => {
    const run = S.run;
    const u = fightUnits().find((x) => x.id === Number(raw));
    if (!run || !u) return null;
    return figureDesc(u.kind, u.stars, {
      unit: u,
      whose: u.side === FV.ours ? "Yours" : `${acrossName(run.foe)}'s`,
      run: u.side === FV.ours ? run : null,
      party: u.side === FV.ours ? null : run.foe,
    });
  });
  register("trait", (raw) => {
    const { id, flags } = flagsOf(raw);
    if (!isTraitId(id)) return null;
    const lore = flags.includes("lore");
    return traitDesc(id, lore ? null : S.run, lore);
  });
  register("item", (raw) => {
    const { id: head, flags } = flagsOf(raw);
    const [id = "", at = "-1"] = head.split("@");
    if (!isItemId(id)) return null;
    const lore = flags.includes("lore");
    return itemDesc(id, lore ? null : S.run, Number(at), lore);
  });
  register("boon", (id) => (isBoonId(id) ? boonDesc(id) : null));
  register("acorns", () => (S.run ? purseDesc(S.run) : null));
  register("level", () => (S.run ? levelDesc(S.run) : null));
}
