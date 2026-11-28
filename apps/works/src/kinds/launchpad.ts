/**
 * The launch pad on the page (tier 8): a pale slab over five tiles by five, with its gantry, its rocket
 * standing on it in stages as its hull sections and fuel fill, and a band of pips round its edge that
 * fills with its charged cells and falls back on each beat (`art/launchpad.ts`). What it holds is read
 * once, by the rules' `padAt`, for its picture as for its words. At a launch its rocket rises off the
 * top of the screen and leaves a pale trail for 3 seconds (`fx.ts` holds when, as the page counted it).
 *
 * Its card shows each part filling, its charged cells by bars and in all, how long until every charged
 * cell loses a bar, the most it has held since its last launch and what came in over the last minute
 * (as the page counted them, `pads.ts`), and a button for each rocket it may be set to, which names
 * the rocket the card showed it set to.
 */
import {
  CHARGED,
  type Item,
  ITEM_INFO,
  kind,
  outsAs,
  padAt,
  type PadReading,
  ROCKETS_N,
  secondsTo,
} from "@sequoia-leaf/factory";
import type { Action, Block, Row } from "@sequoia-leaf/kit/card.ts";
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import {
  launchpadIcon,
  launchpadOf,
  launchRocket,
  launchTrail,
  PAD,
  PIPS,
  ROCKET_FOOT,
  TALL,
} from "../art/launchpad.ts";
import { LILAC } from "../art/pal.ts";
import { risenFor } from "../fx.ts";
import type { Hands, StandingPrint } from "../ui/cards.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

const LAUNCHPAD = kind("launchpad");
/** The rockets a pad may be set to now: those that come with it. */
const CHOICES = ROCKETS_N.filter((r) => r.withPad);
/** Seconds a launch is shown for: its rocket's rise and its trail fading. */
const SHOWN = 3;

const many = (n: Item): string => ITEM_INFO[n]?.many ?? "";

/** Its way out, facing `d`: the tile of its box it leaves from, counted from its box's corner (its own tile is the middle, two in), and the way things leave. */
function outOf(d: number): readonly [number, number, number] {
  const o = outsAs(LAUNCHPAD, d)[0];
  return o ? [o.dx + 2, o.dy + 2, o.way] : [4, 2, d];
}

/** How its picture stands: how far its rocket is built (0 to 4: whole only once it holds every part), and how many of its pips are lit. */
export function lookOf(p: PadReading | null): { stage: number; lit: number } {
  if (!p) return { stage: 0, lit: 0 };
  const [has, need] = p.parts.reduce(([h, n], q) => [h + q.held, n + q.need], [0, 0]);
  const stage = p.ready ? 4 : Math.min(3, Math.floor((need === 0 ? 0 : has / need) * 4));
  return { stage, lit: Math.min(PIPS, Math.round((p.charged / Math.max(1, p.rocket.cells)) * PIPS)) };
}

/** What each rocket it may be set to takes, for its kind's card. */
const rockets = (): Row[] =>
  CHOICES.map((r) => ({
    label: r.name,
    things: [
      ...r.parts.map((q) => ({ ref: itemRef(q.item), note: whole(q.need) })),
      { ref: itemRef(CHARGED.gives), note: `${whole(r.cells)} at once` },
    ],
  }));

/** What it holds: each part filling, its charged cells by bars, and the cells with no charge leaving by its front. */
function holding(p: StandingPrint): Row[] {
  const pad = p.launch?.pad;
  if (!pad) return [];
  return [
    {
      label: "Parts",
      things: pad.parts.map((q) => ({ ref: itemRef(q.item), note: `${whole(q.held)} of ${whole(q.need)}` })),
    },
    {
      label: `Charged cells, ${whole(pad.charged)} of ${whole(pad.rocket.cells)}`,
      things: CHARGED.bars
        .toReversed()
        .map((n) => ({ ref: itemRef(n), note: whole(pad.bars[CHARGED.bars.indexOf(n)] ?? 0) })),
    },
    ...(pad.plain > 0
      ? [{ label: "Leaving by its front", things: [{ ref: itemRef(CHARGED.plain), note: whole(pad.plain) }] }]
      : []),
  ];
}

/** The beat to come, the most it has held since its last launch, and what came in over the last minute, as its card says them. */
function said(p: StandingPrint): Block[] {
  const l = p.launch;
  const pad = l?.pad;
  if (!l || !pad) return [];
  const blocks: Block[] = [{ body: `Every charged cell loses a bar in ${secondsTo(l.toBeat)}.` }];
  const c = l.counted;
  if (c && pad.ready) {
    const flat = c.stood && c.most < pad.rocket.cells ? " Cells go flat as fast as they come." : "";
    blocks.push({ body: `The most it has held since its last launch is ${whole(c.most)}.${flat}` });
    const over = c.seconds >= 60 ? "the last minute" : `the last ${c.seconds} second${c.seconds === 1 ? "" : "s"}`;
    const holds = whole(pad.rocket.cells);
    blocks.push({
      body: `In ${over}, ${whole(c.came)} charged cells came in. About ${whole(pad.rocket.cells * 1.1)} a minute hold ${holds}.`,
    });
  }
  return blocks;
}

/** What setting it to another rocket tips out, in words: what it holds beyond that rocket's number of each part, and charged cells beyond its cells. */
function tipsOut(pad: PadReading, to: (typeof CHOICES)[number]): string {
  const lost = pad.parts.flatMap((q) => {
    const keeps = to.parts.find((t) => t.item === q.item)?.need ?? 0;
    return q.held > keeps ? [`${whole(q.held - keeps)} ${many(q.item)}`] : [];
  });
  if (pad.charged > to.cells) lost.push(`${whole(pad.charged - to.cells)} charged cells`);
  const last = lost.pop();
  return last === undefined
    ? "Nothing it holds is tipped out."
    : `Tips out ${lost.length > 0 ? `${lost.join(", ")} and ` : ""}${last}.`;
}

/** A button for each rocket it may be set to: the one it is set to lit; each names the rocket the card shows it set to. */
export function rocketButtons(p: StandingPrint, hands: Hands): Action[] {
  const pad = p.launch?.pad;
  if (!pad) return [];
  return CHOICES.map((r) => ({
    label: r.name,
    look: "wood sm",
    lit: r === pad.rocket,
    about: r === pad.rocket ? "It is set to this rocket." : tipsOut(pad, r),
    on: () => {
      if (r === pad.rocket) return;
      if (hands.act({ do: "recipe", x: p.x, y: p.y, item: r.counts, was: pad.rocket.counts })) sfx.tap();
    },
  }));
}

export const launchpad: KindPage = {
  picture: () => launchpadIcon(),
  draw(_art, y, at) {
    const pad = at.real ? padAt(y, at.i) : null;
    const { stage, lit } = lookOf(pad);
    const test = (pad?.rocket.id ?? "test") === "test";
    at.put(
      launchpadOf(outOf(at.d), test, stage, lit, pad?.ready === true),
      at.x - PAD,
      at.top - PAD - TALL,
      at.z,
      at.a,
    );
    // A launch: its rocket rises off the top of the screen, faster and faster, and its pale trail fades.
    const since = at.real && !lessMotion() ? risenFor(at.i, y.tick, at.t, SHOWN) : null;
    if (since !== null) {
      const fx = at.x + ROCKET_FOOT.x;
      const foot = at.top + ROCKET_FOOT.y;
      const rise = Math.round(30 * since + 220 * since * since);
      const gone = foot - rise < -at.seenY - 80;
      const trail = launchTrail(Math.min(rise, foot + at.seenY + 80));
      at.put(trail, fx - 1, foot - trail.height, at.z + 0.02, Math.max(0, 1 - since / SHOWN));
      const up = launchRocket(test);
      if (!gone) at.put(up, fx - up.width / 2, foot - rise - up.height + 6, at.z + 0.03, at.a);
    }
    return at.top + 4;
  },
  lamps: (y, i, x, foot, _at, out) => {
    // Its one small lilac light, at the top of its gantry, while it holds all its rocket takes but its cells.
    if (padAt(y, i)?.ready) out.push({ x: x - 20, y: foot - 74, r: 2, power: 0.35, reach: false });
  },
  pointer: "bare",
  rows: rockets,
  standing: { rows: holding, blocks: said, actions: (_art, p, hands) => rocketButtons(p, hands) },
  holdsOwn: true,
  map: [LILAC[2], LILAC[1]],
  mapMid: { colour: LILAC[4], lit: (y, i) => padAt(y, i)?.ready === true },
  dot: LILAC[3],
  dock: 22,
  faces: true,
};
