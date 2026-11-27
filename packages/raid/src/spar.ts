import { pick, type Stream, weighted } from "@sequoia-leaf/core";

/**
 * Sparring partners. A sparring room is fought against the party one of the regulars at the table
 * brought (`REGULARS`: Greg, Vesta and the rest, never a member), or against the board
 * another member fought it with (`opposition`). This makes a regular's up from a seed: a regular, a
 * taste for one kin and one calling, and a party about as good as a member's would be by that room,
 * made only of what a member at its level could have found at the stall. What comes out is a plain
 * `Party`, the same shape as a member's board. It holds components and what they forge into, never
 * an emblem.
 */
import { available, type Catalog } from "./content/catalog.ts";
import { type FigureId, figureIn, specOf, type Stars, starScale, traitsOf } from "./content/figures.ts";
import type { ComponentId, ItemId } from "./content/items.ts";
import { holdItem } from "./content/recipes.ts";
import { HANDLES, ROOMS, type SparStrength, STALL_ODDS, TRAILS } from "./content/rooms.ts";
import { type CallingId, isCalling, isKin, type KinId, stepFor, traitIn } from "./content/traits.ts";
import { arrange } from "./formation.ts";
import { type Carrier, countTraits, type Party, type Placed } from "./party.ts";

/** How much more a partner likes a figure of its kin, and of its calling. */
const LIKES_KIN = 5;
const LIKES_CALLING = 3;
/**
 * How often the stall must offer a figure's cost at the partner's level, out of a hundred, for the
 * partner to have found the copies for a second star, and for a third. Below it, the figure stays
 * as it is: a member at that level would not have found them either.
 */
const STAR_ODDS = { second: 12, third: 30 } as const;

/** What the next star costs: two more copies for the second, six more for the third. */
const starPrice = (cat: Catalog, c: { kind: FigureId; stars: Stars }): number =>
  figureIn(cat, c.kind).tier * (c.stars === 1 ? 2 : 6);

/** The components that suit a figure: what it hits with, what it casts with, or what keeps it standing. */
function suits(cat: Catalog, kind: FigureId): readonly ComponentId[] {
  const calling: CallingId = figureIn(cat, kind).calling;
  switch (calling) {
    case "bulwark":
      return ["bark", "chestnut", "bark", "chestnut", "thorn"];
    case "fang":
    case "sneak":
      return ["thorn", "plume", "thorn", "chestnut"];
    case "slinger":
      return ["thorn", "plume", "plume", "glowcap"];
    case "sage":
      return ["glowcap", "glowcap", "plume", "chestnut"];
    case "mender":
      return ["glowcap", "chestnut", "bark"];
  }
}

/** A figure as far as its traits go, holding nothing: a partner's party is seated before it holds anything that counts. */
const bare = (c: { readonly kind: FigureId }): Carrier => ({ kind: c.kind, items: [] });
/** A sparring partner's strength in a room, as the room says; for a room that says none, a weak one. */
const sparOf = (roomIndex: number): SparStrength => ROOMS[roomIndex]?.spar ?? { level: 3, spent: 6, components: 0 };

/**
 * The party a regular brings to a sparring room, from a seed, of the figures the catalogue has for
 * regulars: as strong as the room says, or as `strength` says; seated off the `closed` seats.
 */
export function sparParty(
  cat: Catalog,
  seed: number,
  roomIndex: number,
  trailIndex: number,
  strength: SparStrength = sparOf(roomIndex),
  closed?: ReadonlySet<number>,
): Party {
  const s: Stream = { rng: seed >>> 0 };
  const trail = TRAILS[trailIndex] ?? TRAILS[0];
  const who = pick(s, HANDLES);
  const kin: KinId = pick(s, cat.ids.traits.filter(isKin));
  const calling: CallingId = pick(s, cat.ids.traits.filter(isCalling));
  const likes = (id: FigureId): number =>
    (traitsOf(cat, id).includes(kin) ? LIKES_KIN : 1) * (traitsOf(cat, id).includes(calling) ? LIKES_CALLING : 1);
  const levelOdds = STALL_ODDS[Math.min(STALL_ODDS.length, Math.max(1, strength.level)) - 1] ?? STALL_ODDS[0];
  /** How often the stall offers a figure's cost at the partner's level, out of a hundred. */
  const odds = (id: FigureId): number => levelOdds?.[figureIn(cat, id).tier - 1] ?? 0;
  let budget = Math.round((strength.spent * (trail?.spent ?? 100)) / 100);

  // Who came: different figures the stall offers at the partner's level, each paid for, with an
  // acorn kept back for every place still to fill. A cost turns up as often as the stall offers it.
  const chosen: { kind: FigureId; stars: Stars }[] = [];
  const regulars = available(cat, { for: "regular" });
  for (let n = 0; n < strength.level; n++) {
    const left = strength.level - n - 1;
    const pool = regulars.filter(
      (id) => odds(id) > 0 && figureIn(cat, id).tier <= budget - left && !chosen.some((c) => c.kind === id),
    );
    const at = weighted(
      s,
      pool.map((id) => odds(id) * likes(id)),
    );
    const kind = pool[at];
    if (kind === undefined) break;
    chosen.push({ kind, stars: 1 });
    budget -= figureIn(cat, kind).tier;
  }
  // What is left goes on stars: two more copies for the second, six more for the third, where the
  // stall offers the figure's cost often enough for the copies to have been found.
  for (;;) {
    const able = chosen.filter(
      (c) =>
        c.stars < 3 &&
        starPrice(cat, c) <= budget &&
        (strength.anyStars === true || odds(c.kind) >= (c.stars === 1 ? STAR_ODDS.second : STAR_ODDS.third)),
    );
    const at = weighted(
      s,
      able.map((c) => likes(c.kind) / starPrice(cat, c)),
    );
    const c = able[at];
    if (c === undefined) break;
    budget -= starPrice(cat, c);
    c.stars = c.stars === 1 ? 2 : 3;
  }

  // Items go to the best of them first, two components at a time so that they forge.
  const held = chosen.map((): ItemId[] => []);
  const best = chosen
    .map((c, i) => ({ i, worth: figureIn(cat, c.kind).tier * (c.stars === 1 ? 1 : c.stars === 2 ? 3 : 9) }))
    .toSorted((a, b) => b.worth - a.worth || a.i - b.i);
  let components = strength.components + (trail?.components ?? 0);
  for (let round = 0; components > 0 && best.length > 0 && round < 12; round++) {
    const holder = best[round % best.length];
    const c = holder ? chosen[holder.i] : undefined;
    if (!holder || !c) break;
    for (let n = 0; n < 2 && components > 0; n++) {
      const got = holdItem(cat, { kind: c.kind, items: held[holder.i] ?? [] }, pick(s, suits(cat, c.kind)));
      if ("refused" in got) break;
      held[holder.i] = got.held;
      components--;
    }
  }

  const counts = countTraits(cat, chosen.map(bare));
  const seats = arrange(
    cat,
    chosen.map((c) => ({ kind: c.kind, health: specOf(cat, c.kind).hp * starScale(c.stars) })),
    stepFor(cat, "sneak", counts.sneak ?? 0) > 0,
    closed,
  );
  const figures: Placed[] = chosen.map((c, i) => ({
    kind: c.kind,
    stars: c.stars,
    seat: seats[i] ?? i,
    items: held[i] ?? [],
    fed: 0,
  }));
  return {
    who,
    title: `brought ${traitIn(cat, kin).name} ${traitIn(cat, calling).name}s`,
    figures,
    boons: [],
    might: 100,
  };
}
