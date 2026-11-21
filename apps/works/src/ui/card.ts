/**
 * What everything in the yard says about itself, in the kit's one card (`card.ts`). Each kind of
 * thing is registered once and named by a reference:
 *
 * - `item:<item>` a thing: its step, what it is made from and where, what it goes into, what the
 *   depot pays, and the orders asking for it (or, for one from the ground, where it lies);
 * - `machine:<kind>` a kind of machine: what it does, what it can make, its draw, pace and price;
 * - `tile:<index>` whatever stands on a tile of the yard: its machine's card with what this one is
 *   doing and holds, and what can be done with it;
 * - `plot:<id>`, `plan:<id>`, and `order:story` or `order:<slot>` for the board's orders.
 *
 * Pointing at a thing on the yard says what it is; clicking or tapping pins its card.
 */
import {
  type Action,
  close,
  type Description,
  type Entry,
  pick,
  refresh,
  register,
  type Row,
  shown,
  type Stat,
  watch,
} from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { TILE } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import {
  aim,
  at,
  costOf,
  DEPOT_SHARE,
  FUEL,
  isFilled,
  isItem,
  isKind,
  isPlanId,
  isPlotId,
  isRaw,
  ITEM,
  type Item,
  ITEMS,
  KIND,
  type Kind,
  MADE_BY,
  type PlanId,
  PLANS,
  planState,
  type PlotId,
  plotState,
  rate,
  type Raw,
  RECIPE,
  RECIPES,
  setOpen,
  setRecipe,
  status,
  STORY,
  storyOrder,
  type Tally,
  TICKS,
  tipOut,
} from "../sim/index.ts";
import { yardSfx } from "../sound.ts";
import { S, toPage, touched } from "../state.ts";
import { buyIdea, buyLand, pickFrom, takeAway, turnAt } from "../tools.ts";
import { coins } from "../yard.ts";
import { KEYS, openTools } from "./dock.ts";
import { togglePanel } from "./panels.ts";
import { fitted, yardIcon } from "./parts.ts";

const GROUND: Record<Raw, readonly [string, string]> = {
  deadfall: [
    "Deadfall",
    "Fallen branches off the forest floor. A gatherer here picks them up; a mill saws them into planks.",
  ],
  stone: ["A stone outcrop", "A gatherer here picks up stone; a mill fires it into bricks."],
  ore: ["An ore seam", "A gatherer here picks up ore; a mill smelts it into ingots."],
  clay: ["A clay bank", "A gatherer here digs clay; a mill fires it into pots."],
  sand: ["Sand", "A gatherer here shovels sand; a mill melts it into glass."],
  resin: ["Old stumps weeping resin", "A gatherer here collects resin; a mill presses it into lamp oil."],
};

const STEPS = ["From the ground", "Worked once", "Put together", "The guild's goods", "Takes the whole yard"];

/** Which machine's picture stands for a plan. */
export const PLAN_ART: Record<PlanId, Kind> = {
  rakes: "gatherer",
  barrows: "gatherer",
  tooling: "mill",
  jigs: "bench",
  waxed: "belt",
  rollers: "belt",
  boiler: "boiler",
  tunnel: "tunnel",
  workshop: "workshop",
  flywheel: "depot",
  tallpylons: "pylon",
  bigcrates: "crate",
  fourth: "depot",
};

let theArt: Art | null = null;

/** Seconds, as a card says them: "1.2s". */
const secs = (ticks: number): string => `${Math.round(ticks) / 10}s`;
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

export const itemRef = (k: Item): string => `item:${k}`;
export const machineRef = (k: Kind): string => `machine:${k}`;
export const tileRef = (i: number): string => `tile:${i}`;
export const plotRef = (id: PlotId): string => `plot:${id}`;
export const planRef = (id: PlanId): string => `plan:${id}`;
export const orderRef = (slot: number | "story"): string => `order:${slot}`;

/** A machine's picture cut to a card's slot: a tall machine is known by its head. */
const machinePic = (art: Art, kind: Kind): HTMLCanvasElement => fitted(art.icon(kind), 22, 22);

// ---------- things ----------

/** The orders on the board (and the story's) that still want a thing, and how many they are owed. */
function askedFor(k: Item): Entry[] {
  const w = S.world;
  const out: Entry[] = [];
  const story = storyOrder(w);
  const owed = (want: Tally, filled: Tally): number => Math.max(0, (want[k] ?? 0) - (filled[k] ?? 0));
  if (story && owed(story.want, w.filled) > 0)
    out.push({ ref: orderRef("story"), note: `${n(owed(story.want, w.filled))} owed`, tag: "story" });
  w.board.forEach((o, slot) => {
    const left = owed(o.want, o.filled);
    if (left > 0) out.push({ ref: orderRef(slot), note: `${n(left)} owed` });
  });
  return out;
}

/** The plots a thing from the ground lies in, with how many tiles of it each has. */
function foundIn(raw: Raw): Entry[] {
  const w = S.world;
  const counts = new Map<number, number>();
  w.land.deposit.forEach((d, i) => {
    if (d !== raw) return;
    const p = w.land.plot[i] ?? -1;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  });
  return [...counts].flatMap(([p, count]) => {
    const plot = w.land.plots[p];
    if (!plot) return [];
    return [
      {
        ref: plotRef(plot.id),
        note: `${count} tiles`,
        ...(w.plots.includes(plot.id) ? { lit: true, tag: "yours" } : {}),
      },
    ];
  });
}

function itemDesc(art: Art, k: Item): Description {
  const info = ITEM[k];
  const recipe = RECIPE[k];
  const usedIn = RECIPES.filter((r) => r.from.includes(k)).map((r) => ({ ref: itemRef(r.out) }));
  const rows: Row[] = [];
  if (recipe) {
    rows.push({ label: "Made from", things: recipe.from.map((p) => ({ ref: itemRef(p), count: "×1" })) });
    rows.push({ label: "In", things: [{ ref: machineRef(recipe.by), note: `${secs(recipe.ticks)} for one` }] });
  } else if (isRaw(k)) {
    rows.push({
      label: "Gathered by",
      things: [{ ref: machineRef("gatherer"), note: `${secs(TICKS.gather)} for one` }],
    });
    rows.push({ label: "Lies in", things: foundIn(k) });
  }
  rows.push({ label: "Used in", things: usedIn });
  rows.push({ label: "Asked for by", things: askedFor(k) });
  return {
    name: info.name,
    icon: art.item(k),
    tag: STEPS[info.step] ?? "",
    aside: amount("coin", n(info.worth)),
    stats: [
      { label: "Step", value: String(info.step) },
      { label: "Orders pay", value: n(info.worth) },
      { label: "Depot pays", value: n(info.worth * DEPOT_SHARE) },
    ],
    blocks: isRaw(k) ? [{ title: GROUND[k][0], body: GROUND[k][1] }] : [],
    rows,
  };
}

// ---------- machines ----------

/** How long a machine takes over one thing, at the plain pace. */
function paceOf(kind: Kind): string {
  if (kind === "gatherer") return secs(TICKS.gather);
  if (kind === "belt" || kind === "tunnel") return `${secs(TICKS.belt)} a tile`;
  if (kind === "boiler") return `${secs(TICKS.burn)} a piece`;
  if (kind === "mill" || kind === "bench" || kind === "workshop") {
    const ticks = MADE_BY[kind].map((r) => r.ticks);
    const lo = Math.min(...ticks);
    const hi = Math.max(...ticks);
    return lo === hi ? secs(lo) : `${secs(lo)}–${secs(hi)}`;
  }
  return "";
}

function machineDesc(art: Art, kind: Kind): Description {
  const w = S.world;
  const info = KIND[kind];
  const price = costOf(w, kind);
  const stats: Stat[] = [];
  if (info.draw > 0) stats.push({ label: "Draws", value: String(info.draw) });
  if (info.gives > 0) stats.push({ label: "Gives", value: String(kind === "depot" ? w.rates.depot : info.gives) });
  const pace = paceOf(kind);
  if (pace) stats.push({ label: "Pace", value: pace });
  const key = KEYS[openTools().indexOf(kind)];
  if (key) stats.push({ label: "Key", value: key });
  const rows: Row[] = [];
  if (kind === "mill" || kind === "bench" || kind === "workshop")
    rows.push({ label: "Can make", things: MADE_BY[kind].map((r) => ({ ref: itemRef(r.out) })) });
  if (kind === "gatherer")
    rows.push({ label: "Gathers", things: ITEMS.filter(isRaw).map((k) => ({ ref: itemRef(k) })) });
  if (kind === "boiler") rows.push({ label: "Burns", things: [{ ref: itemRef("deadfall") }] });
  const open = kind === "depot" || w.open.kinds.has(kind);
  const spare = w.spare[kind] ?? 0;
  const blocks =
    kind === "depot"
      ? []
      : [
          {
            body:
              spare > 0
                ? `${spare} to hand, free to stand.`
                : `${info.cost} Coin${info.cost === 1 ? "" : "s"}, and all of it back when it is taken away.`,
          },
        ];
  return {
    name: info.name,
    icon: machinePic(art, kind),
    tag: open ? info.what : `${info.what} Not to be had yet.`,
    blocks,
    ...(kind === "depot" ? {} : { aside: amount("coin", price === 0 ? "free" : price) }),
    stats,
    rows,
  };
}

/** A machine standing in the yard: its kind's card, with what this one is doing and holds, and what can be done with it. */
function standingDesc(art: Art, i: number): Description | null {
  const w = S.world;
  const b = w.cells[i];
  if (!b) return null;
  const x = i % w.land.w;
  const y = Math.floor(i / w.land.w);
  const base = machineDesc(art, b.kind);
  const st = status(w, i);
  const per = rate(w, i);
  const rows: Row[] = [];
  const held = ITEMS.filter((k) => (b.buf[k] ?? 0) > 0);
  if (held.length > 0)
    rows.push({
      label: b.kind === "boiler" ? `Holds, of ${FUEL}` : b.kind === "crate" ? `Holds, of ${w.rates.crate}` : "Holds",
      things: held.map((k) => ({ ref: itemRef(k), count: `×${b.buf[k] ?? 0}` })),
    });
  const r = aim(b);
  if (r)
    rows.push({
      label: "Making",
      things: [{ ref: itemRef(r.out), note: per > 0 ? `up to ${Math.round(per)} a minute` : "" }],
    });
  if (b.kind === "gatherer") {
    const raw = w.land.deposit[i];
    if (raw)
      rows.push({
        label: "Gathering",
        things: [{ ref: itemRef(raw), note: per > 0 ? `${Math.round(per)} a minute` : "" }],
      });
  }
  if (b.item !== null && b.kind !== "crate") rows.push({ label: "Carrying", things: [{ ref: itemRef(b.item) }] });
  rows.push(...(base.rows ?? []));

  const actions: Action[] = [];
  const maker = b.kind === "mill" || b.kind === "bench" || b.kind === "workshop" ? b.kind : null;
  if (maker) {
    actions.push({
      label: "Whatever arrives",
      look: "slot",
      icon: icon("more"),
      lit: b.recipe === null,
      hint: "Whatever arrives",
      about: "It makes whatever the things it is brought add up to.",
      on: () => {
        setRecipe(S.world, x, y, null);
        sfx.tap();
        touched();
      },
    });
    for (const rec of MADE_BY[maker])
      actions.push({
        label: `Only ${ITEM[rec.out].many}`,
        look: "slot",
        icon: art.item(rec.out),
        lit: b.recipe === rec.out,
        hint: `Only ${ITEM[rec.out].many}`,
        about: `From ${rec.from.map((k) => ITEM[k].many).join(" and ")}. It will take in nothing else.`,
        on: () => {
          setRecipe(S.world, x, y, b.recipe === rec.out ? null : rec.out);
          sfx.tap();
          touched();
        },
      });
  }
  const spare = st?.spare ?? null;
  if (b.count > 0 && (b.kind === "crate" || spare !== null || st?.state === "idle"))
    actions.push({
      label: spare ? `Tip out the ${ITEM[spare].many}` : "Tip it out",
      look: spare ? "sm" : "wood sm",
      hint: "Tip out",
      about: spare
        ? `It is full of ${ITEM[spare].many} and can take no more, so nothing behind them can get in. Tipping them out frees it; giving each part its own belt keeps it free.`
        : "Empties what it holds. What is tipped out is lost.",
      on: () => {
        if (tipOut(S.world, x, y, spare) > 0) yardSfx.take();
        touched();
      },
    });
  if (b.kind === "crate")
    actions.push({
      label: b.open ? "Shut it" : "Open it",
      hint: b.open ? "Shut" : "Open",
      about: "Shut, it takes things in and lets nothing out, and so saves them up.",
      on: () => {
        setOpen(S.world, x, y, !b.open);
        sfx.clack();
        touched();
      },
    });
  if (b.kind === "depot") {
    actions.push(
      { label: "Orders", on: () => togglePanel("orders") },
      { label: "Plans", on: () => togglePanel("plans") },
      { label: "Books", on: () => togglePanel("depot") },
    );
  } else {
    if (b.kind !== "tunnel" && b.kind !== "pylon" && b.kind !== "wheel" && b.kind !== "boiler")
      actions.push({
        label: "Turn",
        hint: "Turn (R)",
        about: "A quarter turn to the right. It costs nothing.",
        on: () => turnAt(x, y),
      });
    actions.push({
      label: "Another",
      hint: "Another (Q)",
      about: `Takes up the ${KIND[b.kind].name.toLowerCase()} as the tool in hand, facing the same way.`,
      on: () => pickFrom(x, y),
    });
    const refund = b.free ? 0 : KIND[b.kind].cost;
    actions.push({
      label: "Take away",
      look: "coral sm",
      after: refund > 0 ? amount("coin", `+${refund}`) : null,
      hint: "Take away",
      about: b.free
        ? "It goes back to hand, and can be stood again for nothing."
        : "All it cost comes back. What it is holding is lost.",
      on: () => takeAway(x, y),
    });
  }
  const advice =
    st?.state === "starved" && st.spare
      ? `A bench takes things in at its back and both sides. Bring ${ITEM[st.spare].many} in one way and ${(st.missing ?? []).map((k) => ITEM[k].many).join(" and ")} another, and it cannot fill up with the wrong one.`
      : null;
  return {
    ...base,
    tag: el("span", st?.trouble ? "k-coral" : "", { text: st?.line ?? KIND[b.kind].what }),
    blocks: [...(base.blocks ?? []), ...(advice ? [{ body: advice }] : [])],
    rows,
    actions,
  };
}

// ---------- land, plans, orders ----------

/** What lies in a plot's ground, by thing, with how many tiles of each. */
function inTheGround(id: PlotId): Entry[] {
  const w = S.world;
  const index = w.land.plots.findIndex((p) => p.id === id);
  const counts = new Map<Raw, number>();
  w.land.deposit.forEach((d, i) => {
    if (d && w.land.plot[i] === index) counts.set(d, (counts.get(d) ?? 0) + 1);
  });
  return [...counts].map(([raw, count]) => ({ ref: itemRef(raw), note: `${count} tiles` }));
}

function plotDesc(id: PlotId): Description | null {
  const w = S.world;
  const plot = w.land.plots.find((p) => p.id === id);
  if (!plot) return null;
  const { state, why } = plotState(w, id);
  const index = w.land.plots.indexOf(plot);
  const bank = w.land.water.some((v, i) => v === 1 && w.land.plot[i] === index);
  return {
    name: plot.name,
    icon: icon("star"),
    tag: plot.why,
    aside:
      state === "owned"
        ? el("span", "k-chip lit", {}, icon("check"), "Yours")
        : amount("coin", plot.price.toLocaleString("en-US")),
    blocks: [
      ...(bank ? [{ body: "The stream runs through it: room for waterwheels." }] : []),
      ...(state === "not yet" ? [{ body: `${why ?? "Not for sale yet"}.` }] : []),
    ],
    rows: [{ label: "In the ground", things: inTheGround(id) }],
    actions:
      state === "for sale"
        ? [
            {
              label: `Buy for ${plot.price.toLocaleString("en-US")}`,
              look: coins() >= plot.price ? "sm wide" : "sm wide off",
              icon: icon("coin"),
              on: () => {
                buyLand(id);
              },
            },
          ]
        : [],
  };
}

function planDesc(art: Art, id: PlanId): Description | null {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) return null;
  const { state, why } = planState(S.world, id);
  const opens = plan.effect.opens ?? [];
  return {
    name: plan.name,
    icon: machinePic(art, PLAN_ART[id]),
    tag: plan.what,
    aside:
      state === "owned"
        ? el("span", "k-chip lit", {}, icon("check"), "Yours")
        : amount("coin", plan.price.toLocaleString("en-US")),
    blocks: state === "not yet" && why ? [{ body: `${why}.` }] : [],
    rows: [
      { label: "Opens", things: opens.map((k) => ({ ref: machineRef(k) })) },
      {
        label: "Needs",
        things: plan.needs.map((p) => ({
          ref: planRef(p),
          ...(S.world.plans.includes(p) ? { lit: true, tag: "yours" } : {}),
        })),
      },
    ],
    actions:
      state === "for sale"
        ? [
            {
              label: plan.price.toLocaleString("en-US"),
              look: coins() >= plan.price ? "sm wide" : "sm wide off",
              icon: icon("coin"),
              on: () => {
                buyIdea(id);
              },
            },
          ]
        : [],
  };
}

/** What an order wants, each thing with how many have come of how many. */
const wantsOf = (want: Tally, filled: Tally): Entry[] =>
  ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
    const of = want[k] ?? 0;
    const have = Math.min(filled[k] ?? 0, of);
    return { ref: itemRef(k), note: `${n(have)} / ${n(of)}`, lit: have >= of };
  });

function orderDesc(slot: string): Description | null {
  const w = S.world;
  if (slot === "story") {
    const o = storyOrder(w);
    if (!o) return null;
    const opens = o.opens;
    const things: Entry[] = [
      ...(opens.kinds ?? []).map((k) => ({ ref: machineRef(k) })),
      ...(opens.plots ?? []).map((p) => ({ ref: plotRef(p) })),
      ...(opens.plans ?? []).map((p) => ({ ref: planRef(p) })),
    ];
    return {
      name: o.title,
      icon: yardIcon("orders"),
      tag: `Order ${w.story + 1} of ${STORY.length}, from ${o.from}`,
      aside: amount("coin", o.pay.toLocaleString("en-US")),
      blocks: [{ body: o.say }, ...(opens.board ? [{ body: "Puts up the board of standing orders." }] : [])],
      rows: [
        { label: "Wants", things: wantsOf(o.want, w.filled) },
        { label: "Opens", things },
      ],
    };
  }
  const o = w.board[Number(slot)];
  if (!o) return null;
  return {
    name: o.title,
    icon: yardIcon("orders"),
    tag: `From ${o.from}`,
    aside: amount("coin", o.pay.toLocaleString("en-US")),
    blocks: [
      { body: o.line },
      ...(isFilled(o.want, o.filled) ? [{ body: "Filled, and waiting to be handed over." }] : []),
    ],
    rows: [{ label: "Wants", things: wantsOf(o.want, o.filled) }],
  };
}

// ---------- the yard's tiles ----------

/** What a tile of the yard stands for: what is built on it, the land it is part of, or what lies in it. */
export function refAt(x: number, y: number): string | null {
  const w = S.world;
  const i = at(w, x, y);
  if (i < 0) return null;
  const plot = w.land.plots[w.land.plot[i] ?? -1];
  if (plot && !w.plots.includes(plot.id)) return plotRef(plot.id);
  if (w.cells[i]) return tileRef(i);
  const raw = w.land.deposit[i];
  if (raw) return itemRef(raw);
  if (w.land.water[i] === 1 || w.land.trunk[i] === 1) return tileRef(i);
  return null;
}

/** What is riding a belt on a tile, if anything: pointing there is asking about it. */
export function riderAt(x: number, y: number): string | null {
  const w = S.world;
  const b = w.cells[at(w, x, y)];
  return b &&
    (b.kind === "belt" || b.kind === "tunnel" || b.kind === "joiner" || b.kind === "splitter") &&
    b.item !== null
    ? itemRef(b.item)
    : null;
}

function tileDesc(art: Art, i: number): Description | null {
  const w = S.world;
  if (w.cells[i]) return standingDesc(art, i);
  if (w.land.water[i] === 1)
    return {
      name: "The stream",
      tag: "Nothing is built on it. A waterwheel on its bank turns for nothing, and a tunnel goes under.",
    };
  if (w.land.trunk[i] === 1)
    return {
      name: "A redwood",
      tag: "Nothing here fells a living tree. Belts go round it, or under its roots by tunnel.",
    };
  return null;
}

/** Says what every kind of thing in the yard is. */
export function initCard(art: Art): void {
  theArt = art;
  register("item", (k) => (isItem(k) ? itemDesc(art, k) : null));
  register("machine", (k) => (isKind(k) ? machineDesc(art, k) : null));
  register("tile", (i) => tileDesc(art, Number(i)));
  register("plot", (id) => (isPlotId(id) ? plotDesc(id) : null));
  register("plan", (id) => (isPlanId(id) ? planDesc(art, id) : null));
  register("order", (slot) => orderDesc(slot));
}

/** What the card that is up is about would say differently now: a key that changes when it would. */
export function cardKey(ref: string | null): string {
  const w = S.world;
  if (!ref) return "";
  if (ref.startsWith("tile:")) {
    const i = Number(ref.slice(5));
    const b = w.cells[i];
    const st = b ? status(w, i) : null;
    const held = b ? ITEMS.map((k) => b.buf[k] ?? 0).join("") : "";
    return `${ref}|${S.rev}|${b?.kind}|${st?.line}|${held}|${b?.recipe}|${b?.open}|${b?.item}|${Math.floor(coins() / 50)}`;
  }
  const filled = [w.filled, ...w.board.map((o) => o.filled)]
    .map((f) => ITEMS.map((k) => f[k] ?? 0).join(","))
    .join("|");
  return `${ref}|${S.rev}|${w.story}|${w.plans.join()}|${w.plots.join()}|${Math.floor(coins() / 50)}|${filled}`;
}

/** The art the cards draw from, once it is made. */
export const cardArt = (): Art | null => theArt;

/** Where a tile is on the page, for a card to sit beside. */
export function tileBox(x: number, y: number): { x: number; y: number; w: number; h: number } {
  const a = toPage(x * TILE, y * TILE);
  const b = toPage((x + 1) * TILE, (y + 1) * TILE);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Pins the card for whatever is on a tile (or puts it away, if it was the one pinned). Gives whether one is up. */
export function openCard(x: number, y: number): boolean {
  const ref = refAt(x, y);
  if (!ref) {
    close();
    return false;
  }
  const b = tileBox(x, y);
  return pick(ref, b.x, b.y, b.w, b.h);
}

export function closeCard(): void {
  close();
}

let lastKey = "";
/** The card that is up says again what its thing is, when what it would say has changed. */
export function refreshCard(): void {
  const key = cardKey(shown()?.ref ?? null);
  if (key === lastKey) return;
  lastKey = key;
  refresh();
}

/**
 * Keeps the yard in step with the cards: the tile whose card is pinned is marked on the yard, and
 * a sheet along the bottom (a finger's card) does not cover what it is about.
 */
export function followCards(pan: (dx: number, dy: number) => void): void {
  watch((_pointed, pinned) => {
    const was = S.picked;
    S.picked = pinned?.startsWith("tile:") ? Number(pinned.slice(5)) : -1;
    if (S.picked < 0 || S.picked === was) return;
    if (S.picked !== was) sfx.tap();
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".k-info.sheet");
      if (!sheet || S.picked < 0) return;
      const w = S.world;
      const spot = toPage((S.picked % w.land.w) * TILE + 8, Math.floor(S.picked / w.land.w) * TILE + 8);
      const top = sheet.getBoundingClientRect().top;
      // Moved up just far enough to stand clear of the card.
      if (spot.y > top - 24) pan(0, top - 40 - spot.y);
    });
  });
}
