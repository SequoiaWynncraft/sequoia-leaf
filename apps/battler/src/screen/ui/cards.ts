/**
 * Cards: what each thing at the table says about itself, in the kit's one card (`card.ts`). Every
 * kind of thing is registered once and named by a reference:
 *
 * - `figure:<kind>` a figure as the stall offers it (`figure:<kind>/<stars>/lore` in the almanac);
 * - `piece:<id>` one of the party's own, with what it holds, its numbers as they stand, and Sell;
 * - `foe:<seat>` one waiting across the board; `unit:<id>` anyone in a fight;
 * - `trait:<id>`, `item:<id>` (`item:<id>@<at>` on the rack), `boon:<id>`, `room:<index>`;
 * - `acorns:` the purse, `level:` the level, and `drop:<item>:<piece>` what giving an item would do.
 *
 * Cards use the short forms; the almanac's add the long sentence and the flavour line.
 */
import {
  type Block,
  type Chip,
  type Description,
  type Entry,
  register,
  type Row,
  type Stat,
} from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import {
  abilityShort,
  abilityText,
  type BoonId,
  BOONS,
  boonShort,
  type ComponentId,
  COMPONENTS,
  drawName,
  drawOf,
  drawTip,
  ECONOMY,
  type FigureId,
  FIGURES,
  FINISHED,
  GOOD_WITH,
  isBoonId,
  isComponentId,
  isFigureId,
  isItemId,
  isTraitId,
  itemAdds,
  type ItemId,
  itemName,
  itemShort,
  itemText,
  type Party,
  pieceAt,
  pieces,
  roleLine,
  ROOMS,
  type Run,
  sellValue,
  specOf,
  spotOf,
  STALL_ODDS,
  type Stars,
  traitDraw,
  type TraitId,
  TRAITS,
  traitShort,
  traitsOf,
  traitText,
  type Unit,
  type UnitKind,
} from "@sequoia-leaf/raid";
import { regularNamed } from "@sequoia-leaf/raid/content/rooms.ts";

import { boonIcon, glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { portrait, starsPic } from "../art/sprites.ts";
import { fightUnits } from "../fightview.ts";
import {
  combosWithHeld,
  handing,
  membersOf,
  NUMBER_KEYS,
  type Numbers,
  opening,
  ownTraitCount,
  pieceNumbers,
  plainNumbers,
  rackHas,
  recipesOf,
  savings,
  startNumbers,
  type TraitCount,
  traitCount,
  whereIs,
} from "../logic.ts";
import { pieces as richPieces } from "../rich.ts";
import { doNow, S } from "../state.ts";

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

const tierName = ["", "one acorn", "two acorns", "three acorns", "four acorns", "five acorns"];

// ---------- references ----------

export const figureRef = (kind: FigureId): string => `figure:${kind}`;
export const pieceRef = (id: number): string => `piece:${id}`;
export const foeRef = (seat: number): string => `foe:${seat}`;
export const unitRef = (id: number): string => `unit:${id}`;
export const traitRef = (id: TraitId): string => `trait:${id}`;
export const itemRef = (id: ItemId, at = -1): string => (at >= 0 ? `item:${id}@${at}` : `item:${id}`);
export const boonRef = (id: BoonId): string => `boon:${id}`;
export const dropRef = (item: number, piece: number): string => `drop:${item}:${piece}`;
/** The trait a reference names, if it names one. */
export const traitOfRef = (ref: string | null): TraitId | null => {
  const id = ref?.startsWith("trait:") ? (ref.slice(6).split("/")[0] ?? "") : "";
  return isTraitId(id) ? id : null;
};

/** An id and the flags after it: `"emberkit/3/lore"` is `emberkit` with `3` and `lore`. */
const flagsOf = (id: string): { id: string; flags: string[] } => {
  const [head = "", ...flags] = id.split("/");
  return { id: head, flags };
};
const starsOf = (flags: readonly string[]): Stars => (flags.includes("3") ? 3 : flags.includes("2") ? 2 : 1);

// ---------- a figure ----------

export interface FigureExtras {
  items?: readonly ItemId[];
  /** How many times Greg has eaten. */
  fed?: number;
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
  /** One of the party's own while planning: it can be sold. */
  sellable?: { id: number } | null;
}

const NAMES = { health: "Health", attack: "Attack", speed: "Speed", reach: "Reach", armour: "Armour", ward: "Ward" };

/** Any figure: its role, its traits, its numbers, its ability in a few words, and the items that suit it. */
export function figureDesc(kind: UnitKind, stars: Stars, extras: FigureExtras = {}): Description {
  const spec = specOf(kind);
  const u = extras.unit;
  const figure = isFigureId(kind) ? FIGURES[kind] : null;

  const count = (t: TraitId): TraitCount | null =>
    extras.party ? traitCount(extras.party, t) : extras.run ? ownTraitCount(extras.run, t) : null;
  const [kin, calling, ...more] = isFigureId(kind) ? traitsOf(kind) : [];
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

  // Its numbers: raised by what it holds or belongs to in green, lowered in coral.
  const plain = plainNumbers(kind, stars);
  const now: Numbers = u
    ? { health: u.maxHp, attack: u.attack, speed: u.speed, reach: u.range, armour: u.armour, ward: u.ward }
    : (extras.numbers ?? plain);
  const stats: Stat[] = NUMBER_KEYS.map((key) => {
    const value =
      key === "speed"
        ? spec.speed > 0
          ? `${now.speed.toFixed(2)}/s`
          : "none"
        : key === "health" && u
          ? `${Math.max(0, Math.round(u.hp))}/${Math.round(u.maxHp)}`
          : String(Math.round(now[key]));
    const d = now[key] - plain[key];
    const moved = Math.abs(d) < (key === "speed" ? 0.005 : 0.5) ? 0 : d;
    return moved === 0
      ? { label: NAMES[key], value }
      : { label: NAMES[key], value, mark: moved > 0 ? "raised" : "lowered" };
  });

  const blocks: Block[] = [];
  if (spec.ability)
    blocks.push({
      title: spec.ability.name,
      ...(spec.mana[1] > 0 ? { note: `mana ${spec.mana[1]}` } : {}),
      body: rich(abilityShort(kind, stars)),
    });
  if (kind === "greg" && (extras.fed ?? 0) > 0)
    blocks.push({ body: `Has eaten ${extras.fed} times: +${(extras.fed ?? 0) * 3}% health.` });
  if (extras.lore) {
    if (spec.ability) blocks.push({ body: abilityText(kind, stars) });
    blocks.push({ body: el("i", "k-dim quip", { text: spec.quip }) });
  }

  // What it holds, and the three finished items that suit it (lit if the rack has one, or both its halves).
  const items = extras.items ?? u?.items ?? [];
  const run = extras.run ?? null;
  const rows: Row[] = [{ label: "Holds", look: "icons", things: items.map((item) => ({ ref: itemRef(item) })) }];
  if (isFigureId(kind))
    rows.push({
      label: "Good with",
      look: "icons",
      things: GOOD_WITH[kind].map((item) => ({ ref: itemRef(item), lit: run ? rackHas(run, item) !== null : false })),
    });

  const sale = extras.sellable;
  const piece = sale && run ? pieces(run).find((p) => p.id === sale.id) : undefined;
  const draw = u ? u.draw : drawOf(kind, items);
  return {
    name: spec.name,
    icon: portrait(kind),
    tag: figure ? roleLine(figure.calling) : "",
    aside: el(
      "span",
      "fside",
      {},
      el("span", "k-row tight", {}, pic(starsPic(stars)), figure ? acorns(figure.tier) : null),
      extras.whose ? el("span", "k-d", { text: extras.whose }) : null,
    ),
    chips: [chip(kin, "Kin"), chip(calling, "Calling"), ...more.map((t) => chip(t, "Also")), drawChip(draw)].filter(
      (c): c is Chip => c !== null,
    ),
    stats,
    blocks,
    rows,
    actions:
      sale && piece && run
        ? [
            {
              label: "Sell",
              look: "wood sm wide",
              after: acorns(`+${sellValue(piece)}`),
              on: () => {
                const spot = spotOf(S.run ?? run, sale.id);
                // Sold from its card: the card goes with it.
                if (spot) doNow({ do: "sell", from: spot });
              },
            },
          ]
        : [],
  };
}

/** The chip after a figure's traits saying how it draws enemies' eyes, with a tip; none for a draw of 0. */
function drawChip(draw: number): Chip | null {
  const name = drawName(draw);
  return name ? { text: name, hint: drawTip(draw) } : null;
}

// ---------- a trait ----------

/** A figure in a trait's roster: lit if fielded, tagged if on the bench or the stall. */
function member(id: FigureId, run: Run | null): Entry {
  const where = run ? whereIs(run, id) : null;
  const own = run
    ? pieces(run)
        .filter((p) => p.kind === id)
        .toSorted((a, b) => b.stars - a.stars)[0]
    : undefined;
  return {
    ref: own ? pieceRef(own.id) : figureRef(id),
    lit: where === "board",
    name: FIGURES[id].name,
    icon: portrait(id),
    note: acorns(FIGURES[id].tier),
    ...(where === "bench" || where === "stall" ? { tag: where } : {}),
  };
}

/** A trait: what it is, its steps (the one reached lit, the next saying how many more), and every figure that carries it. */
export function traitDesc(id: TraitId, run: Run | null, lore = false): Description {
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
  if (draws)
    blocks.unshift({ body: rich(`${draws}: enemies pick them as if a hex ${draw > 0 ? "nearer" : "further"}.`) });
  if (lore) spec.steps.forEach((need, i) => blocks.push({ title: `${need}`, body: traitText(id, i + 1) }));
  if (run && run.boons.some((b) => BOONS[b].charm === id)) blocks.push({ body: "A charm counts as one more." });
  return {
    name: spec.name,
    icon: traitIcon(id),
    tag: spec.gist,
    aside: el(
      "span",
      "k-row tight",
      {},
      el("span", "k-label", { text: spec.sort === "kin" ? "Kin" : spec.sort === "calling" ? "Calling" : "Own" }),
      state ? el("b", "", { text: `${count}/${state.next}` }) : null,
    ),
    blocks,
    rows: [{ label: "Every figure", look: "tiles", things: membersOf(id).map((f) => member(f, run)) }],
  };
}

// ---------- an item, a boon ----------

/** What an item adds, in numbers, on a line; and what it does. */
const itemWords = (id: ItemId): HTMLElement =>
  el("div", "", {}, rich(itemAdds(id).join(" · "), "adds"), isComponentId(id) ? null : rich(itemShort(id)));

/**
 * An item: what it adds and does, and what it is made of or makes. A component's "makes" lines put
 * first, lit and tagged "have", the ones whose other half the party already holds.
 */
export function itemDesc(id: ItemId, run: Run | null, itemAt = -1, lore = false): Description {
  const blocks: Block[] = [{ body: itemWords(id) }];
  if (lore) {
    blocks.push({ body: itemText(id) });
    blocks.push({ body: el("i", "k-dim quip", { text: isComponentId(id) ? COMPONENTS[id].quip : FINISHED[id].quip }) });
  }
  return {
    name: itemName(id),
    icon: itemIcon(id),
    tag: isComponentId(id) ? "A component" : "A finished item",
    blocks,
    rows: isComponentId(id)
      ? [{ label: "With", things: makesLines(id, run, itemAt) }]
      : [{ label: "Made from", things: FINISHED[id].made.map((c) => ({ ref: itemRef(c) })) }],
  };
}

/** A component's "makes" lines: the other half, an arrow, and the finished item; the ones the party can finish first. */
export function makesLines(id: ItemId, run: Run | null, itemAt = -1): Entry[] {
  if (!isComponentId(id)) return [];
  const held = new Set(run ? combosWithHeld(run, id, itemAt).map((c) => c.with) : []);
  const line = (r: { with: ComponentId; makes: ItemId }): Entry =>
    held.has(r.with)
      ? { ref: itemRef(r.makes), from: itemRef(r.with), lit: true, tag: "have" }
      : { ref: itemRef(r.makes), from: itemRef(r.with) };
  return recipesOf(id)
    .map(line)
    .toSorted((a, b) => Number(b.lit ?? false) - Number(a.lit ?? false));
}

export function boonDesc(id: BoonId): Description {
  const spec = BOONS[id];
  const kin = spec.charm;
  return {
    name: spec.name,
    icon: boonIcon(id),
    tag: spec.sort === "charm" ? "A charm" : "A boon",
    blocks: [{ body: rich(boonShort(id)) }],
    chips: kin ? [{ label: "Counts for", text: TRAITS[kin].name, icon: traitIcon(kin), ref: traitRef(kin) }] : [],
  };
}

// ---------- the rest ----------

/** A room on the track: what kind it is, who is or was there, and what it gives. */
function roomDesc(index: number, run: Run): Description | null {
  const room = ROOMS[index];
  if (!room) return null;
  const record = run.record.findLast((r) => r.room === index);
  const here = run.room === index && run.phase !== "over";
  const kind = room.kind === "spar" ? "Sparring" : room.kind === "boss" ? "A boss" : "Trouble";
  const lines: string[] = [];
  if (here)
    lines.push(
      regularNamed(run.foe.who)
        ? `${opening(run.foe.who)} ${run.foe.title}.`
        : `${run.foe.who}${run.foe.title ? `: ${run.foe.title}` : ""}.`,
    );
  if (record) lines.push(record.result === "win" ? "Won." : record.result === "loss" ? "Lost." : "A draw.");
  else if (room.kind === "spar")
    lines.push("A regular's party. It pays the same, won or lost, but a win pays an acorn more.");
  else if (room.kind === "trouble")
    lines.push(
      `The forest's own. Win for a pick of ${ECONOMY.componentsWon} components; lose and it is ${ECONOMY.componentsLost}.`,
    );
  else
    lines.push(
      index === ROOMS.length - 1
        ? "The last room. It is fought until it is won, or the party goes home."
        : "Beat it for two picks of components, and a boon either way.",
    );
  if (ECONOMY.boonRooms.some((r) => r === index) && room.kind !== "boss") lines.push("A boon is offered after it.");
  return {
    name: `Room ${index + 1}`,
    icon: roomIcon(room.kind),
    tag: `${kind}, wing ${room.wing}.`,
    blocks: [{ body: lines.join(" ") }],
  };
}

/** The purse of acorns: how the savings are counted. */
function purseDesc(run: Run): Description {
  const s = savings(run);
  return {
    name: "Acorns",
    icon: glyph("acorn"),
    tag: "The money inside a raid.",
    stats: [
      { label: "Held", value: String(run.acorns) },
      { label: "Piles", value: `${s.piles}/${s.most}` },
      { label: "Pays", value: `+${s.pays}` },
    ],
    blocks: [
      {
        body: `Every room pays ${ECONOMY.roomAcorns}, and 1 more for a win. Every ${s.per} you keep earns 1 more each room, up to ${s.most}.`,
      },
      { body: s.toNext > 0 ? `${s.toNext} more for the next pile.` : "Every pile is full." },
    ],
  };
}

/** The level: how many may be fielded, and what the stall offers at it. */
function levelDesc(run: Run): Description {
  const odds = STALL_ODDS[Math.min(run.level, STALL_ODDS.length) - 1] ?? STALL_ODDS[0] ?? [100, 0, 0, 0, 0];
  const parts = odds.flatMap((share, i) => (share > 0 ? [`${tierName[i + 1] ?? ""} ${share}%`] : []));
  return {
    name: `Level ${run.level}`,
    icon: glyph("acorn"),
    tag: "How many figures you may field.",
    blocks: [
      {
        body: `${ECONOMY.xpCost} acorns buy ${ECONOMY.xpBought} experience; every room gives ${ECONOMY.xpRoom} for nothing.`,
      },
      { title: "The stall offers", body: parts.join(", ") },
    ],
  };
}

/** What giving the item on the rack to one of the party would do: what the two make, or just that it is given. */
function dropDesc(run: Run, at: number, pieceId: number): Description | null {
  const item = run.items[at];
  const spot = spotOf(run, pieceId);
  const piece = spot ? pieceAt(run, spot) : null;
  if (item === undefined || !piece) return null;
  const would = handing(piece, item);
  if (would.can && would.forged)
    return {
      name: itemName(would.forged),
      icon: itemIcon(would.forged),
      tag: `${itemName(would.with)} and ${itemName(item)} make it.`,
      blocks: [{ body: itemWords(would.forged) }],
    };
  return { name: `Give ${itemName(item)}`, tag: `to ${piece.kind === "greg" ? "Greg" : "this figure"}.` };
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
    const planning = S.mode === "plan" && run.phase === "plan" && run.choices.length === 0;
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
      whose: `${opening(run.foe.who)}'s`,
      party: run.foe,
      numbers: startNumbers(run.foe, foe.seat),
    });
  });
  register("unit", (raw) => {
    const run = S.run;
    const u = fightUnits().find((x) => x.id === Number(raw));
    if (!run || !u) return null;
    return figureDesc(u.kind, u.stars, {
      unit: u,
      whose: u.side === 0 ? "Yours" : `${opening(run.foe.who)}'s`,
      run: u.side === 0 ? run : null,
      party: u.side === 1 ? run.foe : null,
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
  register("room", (id) => (S.run ? roomDesc(Number(id), S.run) : null));
  register("acorns", () => (S.run ? purseDesc(S.run) : null));
  register("level", () => (S.run ? levelDesc(S.run) : null));
  register("drop", (raw) => {
    const [at = "", piece = ""] = raw.split(":");
    return S.run ? dropDesc(S.run, Number(at), Number(piece)) : null;
  });
}
