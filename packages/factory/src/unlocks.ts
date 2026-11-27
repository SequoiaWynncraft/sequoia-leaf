/**
 * What an unlock is, for a screen to show: the one place an `Unlocks` (what a node or a piece of
 * research gives, `content/nodes.ts`) is read into the list of things it unlocks, each of one of a
 * few kinds, with its name and the one plain sentence that says what it is, made from its own
 * numbers and the tables'. A screen gives each a picture and a card, and reads no field of an
 * `Unlocks` itself. Nothing in the rules reads this: what a yard may do is `openOf` and `locked`.
 */
import { coinsText, num, perMinute } from "@sequoia-leaf/core";

import { REACH } from "./content/machines.ts";
import { START, type Tool, type Unlocks } from "./content/nodes.ts";
import { FELLING, PLOTS } from "./content/plots.ts";
import { TIERS } from "./content/tiers.ts";
import { carried, makes } from "./planner.ts";
import {
  ALL_KINDS,
  DOES,
  drawnAt,
  type Goal,
  GOALS,
  HALF,
  type Item,
  item,
  ITEM_INFO,
  type Kind,
  kind,
  KIND_INFO,
  kindNamed,
  OWNS,
  PACE,
  PER_TILE,
  type Plot,
  plot,
  plotName,
  price,
  RECIPE,
} from "./tables.ts";
import { carries } from "./wire.ts";

/** A grade as it is written: I, II, III. */
export const numeral = (grade: number): string => ["", "I", "II", "III"][grade] ?? String(grade);

/** The numbers an unlock may raise, by what each is of. */
export type Numbered = "stops" | "crate" | "reach" | "depot" | "span" | "away" | "hooks";

/** What every unlock has: what it is called, and the sentence that says what it is. */
interface Said {
  readonly name: string;
  readonly says: string;
}

/**
 * One thing unlocked. `amount` is the number as it is shown beside its picture ("128", "6 tiles"),
 * for an unlock that is a number, and for a kind that comes with a number of its own (the first cart
 * stop: "1"); `was` is what the number was before it, 0 where there was none.
 */
export type Unlock = Said &
  (
    | { readonly is: "kind"; readonly kind: Kind; readonly amount?: string }
    | { readonly is: "grade"; readonly kind: Kind; readonly grade: number }
    | { readonly is: "recipe"; readonly item: Item }
    | { readonly is: "plot"; readonly plot: Plot; readonly price: number }
    | { readonly is: "tool"; readonly tool: Tool }
    | {
        readonly is: "blueprints";
        readonly count: number;
        readonly pieces: number;
        readonly was: { readonly count: number; readonly pieces: number };
        readonly amount: string;
      }
    | {
        readonly is: "number";
        readonly of: Numbered;
        readonly to: number;
        readonly was: number;
        readonly amount: string;
      }
    | { readonly is: "board"; readonly hooks: number }
    | { readonly is: "first" }
    | { readonly is: "ins" }
    | { readonly is: "felling" }
    | { readonly is: "mouths" }
  );

/** What each unlock that is one thing or none lets the yard do, as they are listed: a splitter's flags and ways in, felling, wide mouths. */
const FLAGS = [
  {
    is: "first",
    name: "First way",
    says: "A splitter can put one of its ways first: items go that way while it can take them, and only the rest go to its other ways.",
  },
  {
    is: "ins",
    name: "Ways in",
    says: "A splitter's ahead, left or right can be set to In on its card: it takes items in there as well as from behind, in turn, and sends them out of its other ways.",
  },
  {
    is: "felling",
    name: "Felling",
    says: `Redwoods on your land can be felled. The first costs ${coinsText(FELLING.first)}. Each one after costs 50% more than the one before.`,
  },
  {
    is: "mouths",
    name: "Wide mouths",
    says: "A tunnel takes items in from the left and right of its way in, as well as from behind.",
  },
] as const;

/** What each tool is called, and what it does. */
export const TOOL_INFO: Readonly<Record<Tool, Said>> = {
  paint: { name: "Paint", says: "Gives a belt's whole line a colour, to tell lines apart." },
  select: { name: "Select", says: "Marks out an area to move, copy, remove or save as a blueprint." },
  upgrade: {
    name: "Upgrading an area",
    says: "Select raises every piece in a marked area to the highest grade the yard may build.",
  },
  whole: {
    name: "A plan of the whole yard",
    says: "Select can save the whole yard as a blueprint, of every piece in it, and put it back where it was.",
  },
};

/** Every `Unlocks` there is: what a new yard has, and what each goal gives. */
const ALL: readonly Unlocks[] = [START, ...GOALS.map((g) => g.unlocks)];
/** The largest number below `to` that anything in the tables gives of a kind: what it was before; 0 if nothing does. */
const before = (to: number, read: (u: Unlocks) => number | undefined): number =>
  Math.max(0, ...ALL.map((u) => read(u) ?? 0).filter((n) => n < to));

const s = (n: number): string => (n === 1 ? "" : "s");
const upFrom = (was: number, unit = ""): string => (was > 0 ? `, up from ${num(was)}${unit}` : "");
/** A list in words: "a, b and c". */
const listed = (parts: readonly string[]): string =>
  parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}` : (parts[0] ?? "");
const lower = (k: Kind): string => (KIND_INFO[k]?.name ?? "").toLowerCase();

/** How far a pylon's power reaches, in whole tiles, with its reach at so many hundredths of plain. */
const pylonTiles = (reach: number): number => Math.floor((REACH.pylon * reach) / 10_000);

/** A recipe in a sentence: "A bench makes hampers from 2 planks and 1 pot." One part of which it takes one is named without its count. */
export function recipeSays(out: Item): string {
  const r = RECIPE[out];
  if (!r) return "";
  const plain = r.from.length === 1 && r.need[0] === 1;
  const parts = r.from.map((p, k) => {
    const c = r.need[k] ?? 1;
    if (plain) return ITEM_INFO[p]?.many ?? "";
    return `${c} ${c === 1 ? (ITEM_INFO[p]?.name ?? "").toLowerCase() : (ITEM_INFO[p]?.many ?? "")}`;
  });
  return `A ${lower(r.by)} makes ${ITEM_INFO[out]?.many ?? ""} from ${listed(parts)}.`;
}

/** What a kind of piece at a grade above the first does more than the first, and what one costs (a tunnel under `span` tiles). */
export function gradeSays(k: Kind, grade: number, span = 0): string {
  const cost = `${PER_TILE[k] === 1 ? "A tile costs" : "Costs"} ${coinsText(price(k, grade, span))}.`;
  if (carries(k)) return `Carries up to ${perMinute(carried(grade), "items")}${upFrom(carried(grade - 1))}. ${cost}`;
  const draw = (g: number): number => drawnAt(k, g) / HALF;
  const power = `draws ${num(draw(grade))} power${upFrom(draw(grade - 1))}`;
  const does = DOES[k];
  if (does)
    return `${does[0]} ${perMinute(makes(k, grade, null), does[1])}${upFrom(makes(k, grade - 1, null))}, and ${power}. ${cost}`;
  return `Works ${num((PACE[grade] ?? 0) / (PACE[1] ?? 1))} times as fast as grade ${numeral(1)}, and ${power}. ${cost}`;
}

/** A number unlocked: what it is called, as the start of a sentence the number ends; the number as shown; the whole sentence. */
function number(of: Numbered, to: number): Unlock {
  const was = before(to, (u) => u[of]);
  const made = ((): { name: string; amount: string; says: string } => {
    switch (of) {
      case "stops":
        return {
          name: "Cart stops",
          amount: num(to),
          says: `The yard may have ${num(to)} cart stop${s(to)}${upFrom(was)}.`,
        };
      case "crate":
        return { name: "A crate holds", amount: num(to), says: `A crate holds ${num(to)} items${upFrom(was)}.` };
      case "reach": {
        const tiles = pylonTiles(to);
        return {
          name: "A pylon reaches",
          amount: `${num(tiles)} tile${s(tiles)}`,
          says: `A pylon powers the tiles up to ${num(tiles)} tile${s(tiles)} from it${upFrom(was > 0 ? pylonTiles(was) : 0)}.`,
        };
      }
      case "depot":
        return {
          name: "The depot makes",
          amount: `${num(to)} power`,
          says: `The depot makes ${num(to)} power${upFrom(was)}.`,
        };
      case "span":
        return {
          name: "A tunnel runs under",
          amount: `${num(to)} tile${s(to)}`,
          says: `A tunnel runs under up to ${num(to)} tile${s(to)}${upFrom(was)}.`,
        };
      case "away":
        return {
          name: "The yard runs unwatched",
          amount: `${num(to)} hour${s(to)}`,
          says: `The yard runs for ${num(to)} hour${s(to)} after you leave${upFrom(was)}.`,
        };
      case "hooks":
        return {
          name: "The board holds",
          amount: `${num(to)} order${s(to)}`,
          says: `The board holds ${num(to)} order${s(to)}${upFrom(was)}.`,
        };
    }
  })();
  return { is: "number", of, to, was, ...made };
}

/** The kind a number belongs to: unlocked with its kind, and with nothing before it, the number is part of the kind. */
const ofKind = (of: Numbered): Kind | undefined => ALL_KINDS.find((k) => OWNS[k]?.includes(of));
const NUMBERED: readonly Numbered[] = ["stops", "crate", "reach", "depot", "span", "away", "hooks"];

/**
 * What an `Unlocks` unlocks, each thing once, in the order a screen lists them: kinds of piece,
 * grades, recipes, tools, blueprints, numbers, the board, a way put first, and plots put up for sale. A number that
 * comes with the kind it belongs to, with nothing before it (a tunnel's first length, the first cart
 * stop), is the kind's: the kind is shown with that number beside it and says its sentence after its
 * own, and the number is not listed again.
 */
export function unlocked(u: Unlocks): Unlock[] {
  const out: Unlock[] = [];
  const kinds = (u.kinds ?? []).map(kind);
  /** The number that comes with a kind, if one does. */
  const own = (k: Kind): Unlock | undefined => {
    const of = NUMBERED.find((f) => ofKind(f) === k && u[f] !== undefined);
    const made = of === undefined ? undefined : number(of, u[of] ?? 0);
    return made?.is === "number" && made.was === 0 ? made : undefined;
  };
  for (const k of kinds) {
    const comes = own(k);
    const what = KIND_INFO[k]?.what ?? "";
    out.push({
      is: "kind",
      kind: k,
      name: KIND_INFO[k]?.name ?? "",
      says: comes ? `${what} ${comes.says}` : what,
      ...(comes?.is === "number" ? { amount: comes.amount } : {}),
    });
  }
  for (const [name, grade] of Object.entries(u.grades ?? {})) {
    const k = kindNamed(name);
    if (k === null || grade === undefined) continue;
    out.push({
      is: "grade",
      kind: k,
      grade,
      name: `${KIND_INFO[k]?.name ?? ""} ${numeral(grade)}`,
      says: gradeSays(k, grade),
    });
  }
  for (const name of u.recipes ?? []) {
    const made = item(name);
    out.push({ is: "recipe", item: made, name: ITEM_INFO[made]?.name ?? "", says: recipeSays(made) });
  }
  for (const tool of u.tools ?? []) out.push({ is: "tool", tool, ...TOOL_INFO[tool] });
  if (u.blueprints) {
    const { count, pieces } = u.blueprints;
    const was = {
      count: before(count, (o) => o.blueprints?.count),
      pieces: before(pieces, (o) => o.blueprints?.pieces),
    };
    out.push({
      is: "blueprints",
      count,
      pieces,
      was,
      name: "Blueprints",
      amount: `${num(count)} of ${num(pieces)} pieces`,
      says: `Keep ${num(count)} blueprint${s(count)} of up to ${num(pieces)} pieces${count === 1 ? "" : " each"}.`,
    });
  }
  for (const of of NUMBERED) {
    const to = u[of];
    if (to === undefined) continue;
    const made = number(of, to);
    const kindOf = ofKind(of);
    if (made.is === "number" && made.was === 0 && kindOf !== undefined && kinds.includes(kindOf)) continue;
    out.push(made);
  }
  if (u.board) {
    const hooks = Math.max(0, ...ALL.map((o) => o.hooks ?? 0));
    out.push({
      is: "board",
      hooks,
      name: "Side orders",
      says: `The guild hangs side orders on a board at the depot, ${num(hooks)} at a time.`,
    });
  }
  out.push(...FLAGS.filter((flag) => u[flag.is] === true));
  for (const name of u.plots ?? []) {
    const info = PLOTS.find((p) => p.id === name);
    const cost = info?.price ?? 0;
    out.push({
      is: "plot",
      plot: plot(name),
      price: cost,
      name: info?.name ?? plotName(plot(name)),
      says:
        cost > 0 ? `${info?.name ?? ""} is for sale, for ${coinsText(cost)}.` : `${info?.name ?? ""} is the yard's.`,
    });
  }
  return out;
}

/** What each goal unlocks, worked out once: the tables do not change. */
const BY: readonly (readonly Unlock[])[] = GOALS.map((g) => unlocked(g.unlocks));
/** What a goal unlocks, as `unlocked` lists it: what a screen asks, so that it never holds an `Unlocks`. */
export const unlockedBy = (g: Goal): readonly Unlock[] => BY[g] ?? [];

/** What a tier is called: "Tier 2: The stream", or "Tier 4" for one with no name yet. */
export const tierName = (tier: number): string => {
  const name = TIERS[tier]?.name;
  return name === undefined ? `Tier ${tier}` : `Tier ${tier}: ${name}`;
};
