/**
 * The Works, as a grey-box: the yard drawn plainly on a canvas, with the tools to build it. It is
 * here so the rules in `sim/` can be seen and played while the real screen is being drawn; nothing
 * about how it looks is meant to last.
 *
 * It keeps a number of Coins of its own, since it runs outside the town. The rules never hold the
 * purse: they are told the balance, say what they took, and their earnings are collected from the
 * till.
 */
import {
  at,
  type Away,
  awayLine,
  boost,
  boostLeft,
  build,
  type Building,
  buyPlan,
  buyPlot,
  claim,
  collect,
  create,
  type Dir,
  drain,
  DX,
  DY,
  isFilled,
  ITEM,
  type Item,
  ITEMS,
  KIND,
  type Kind,
  load,
  oldCoins,
  PLANS,
  planState,
  plotAt,
  plotState,
  power,
  type Raw,
  REACH,
  RECIPE,
  refusal,
  remove,
  RIGHT,
  runTo,
  save,
  setOpen,
  type Spent,
  step,
  STORY,
  storyOrder,
  swap,
  swapRefusal,
  type Tally,
  TICK_MS,
  TICKS,
  tunnelExit,
  type World,
} from "./sim/index.ts";

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the page has no ${what}`);
  return value;
}
const canvas = need(document.querySelector("canvas"), "canvas");
const g = need(canvas.getContext("2d"), "2d context");
const $ = (id: string): HTMLElement => need(document.querySelector<HTMLElement>(`#${id}`), id);

const COLOUR: Record<Item, string> = {
  deadfall: "#9a6a3a",
  stone: "#a3a9b5",
  ore: "#d0804c",
  clay: "#c98a6a",
  sand: "#e6d49a",
  resin: "#e0a030",
  plank: "#e2bd72",
  brick: "#c65a44",
  ingot: "#e8e2d4",
  pot: "#b5623f",
  glass: "#9fd8e6",
  oil: "#f0c040",
  tool: "#5aa9e6",
  gear: "#f5b95e",
  frame: "#8bbf5a",
  hamper: "#c9a06a",
  shell: "#7fc9b8",
  lantern: "#ffe08a",
  engine: "#e67fb0",
  pole: "#b07ae6",
  kit: "#6fb36a",
  beacon: "#fff3cf",
  crab: "#f08060",
};
const GROUND: Record<Raw, string> = {
  deadfall: "#2f4a2c",
  stone: "#3c4250",
  ore: "#5a3a2c",
  clay: "#5a4034",
  sand: "#5c5638",
  resin: "#57431c",
};
const LETTER: Partial<Record<Kind, string>> = {
  gatherer: "G",
  mill: "M",
  bench: "B",
  workshop: "W",
  crate: "C",
  wheel: "~",
  boiler: "F",
};
const BODY: Partial<Record<Kind, string>> = {
  gatherer: "#6a4a3a",
  mill: "#5a4a7a",
  bench: "#3f6a78",
  workshop: "#2f7a5a",
  crate: "#7a5a2f",
  wheel: "#2f5a8a",
  boiler: "#8a3f2f",
};
const TOOLS: readonly Kind[] = [
  "belt",
  "gatherer",
  "mill",
  "bench",
  "workshop",
  "splitter",
  "joiner",
  "tunnel",
  "crate",
  "pylon",
  "wheel",
  "boiler",
];
const KEY = "works.save.v2";
const PURSE = "works.coins.v2";
const OLD = "works.save.v1";

// ---------- the yard, as it was left ----------

const kept = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
let world: World = load(kept(KEY)) ?? create({ seed: Math.floor(Math.random() * 0xffffffff) });
// The grey-box's own purse: what it had, or what the yard before this one had earned.
let coins = Math.max(0, Math.floor(Number(kept(PURSE) ?? oldCoins(kept(OLD)) ?? 0) || 0));
const bank = (): void => {
  coins += collect(world);
};
const pay = (did: Spent): boolean => {
  if (!did.ok) say(did.why, true);
  else coins -= did.cost;
  return did.ok;
};

let tool: Kind | "erase" | "land" | null = "gatherer";
let dir: Dir = 0;
let hover: [number, number] | null = null;
let plansOpen = false;
/** When each thing was built, for its small pop; and words rising over the yard. */
const born = new Map<number, number>();
const pops: { x: number; y: number; text: string; t: number; colour: string }[] = [];
let pulse = 0;

// ---------- the view ----------

let tile = 24;
let ox = 0;
let oy = 0;
/** The tiles on show: the yard's own plots, or the whole map while choosing land. */
let view = { x0: 0, y0: 0, x1: 1, y1: 1 };
function fit(): void {
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const plots = world.land.plots.filter((p) => tool === "land" || world.plots.includes(p.id));
  view = {
    x0: Math.min(...plots.map((p) => p.x)),
    y0: Math.min(...plots.map((p) => p.y)),
    x1: Math.max(...plots.map((p) => p.x + p.w)),
    y1: Math.max(...plots.map((p) => p.y + p.h)),
  };
  const top = 96;
  const bottom = innerWidth < 700 ? 250 : 140;
  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  tile = Math.max(6, Math.floor(Math.min(innerWidth / w, (innerHeight - top - bottom) / h)));
  ox = Math.round((innerWidth - tile * w) / 2) - view.x0 * tile;
  oy = Math.round(top + (innerHeight - top - bottom - tile * h) / 2) - view.y0 * tile;
}
addEventListener("resize", fit);
const cellAt = (px: number, py: number): [number, number] => [
  Math.floor((px - ox) / tile),
  Math.floor((py - oy) / tile),
];

// ---------- the tools ----------

const hint = $("hint");
let scold = 0;
function say(text: string, bad = false): void {
  hint.textContent = text;
  hint.classList.toggle("bad", bad);
  if (bad) scold = performance.now() + 2200;
}
const tools = $("tools");
const ARROW = ["→", "↓", "←", "↑"] as const;
function button(cls: string, title: string, under: string, act: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = `<span>${title}</span><small>${under}</small>`;
  b.addEventListener("click", () => {
    act();
    fit();
    toolbar();
  });
  return b;
}
function toolbar(): void {
  tools.replaceChildren(
    ...TOOLS.map((k, i) => {
      const open = world.open.kinds.has(k);
      const cls = `tool${tool === k ? " on" : ""}${open ? "" : " locked"}`;
      const key = i < 9 ? ` · ${i + 1}` : "";
      return button(cls, KIND[k].name, open ? `${KIND[k].cost}${key}` : "locked", () => {
        if (!open) say(`The ${KIND[k].name.toLowerCase()} has not been opened yet`, true);
        else tool = tool === k ? null : k;
      });
    }),
    button("tool", `Turn ${ARROW[dir]}`, "R", () => {
      dir = RIGHT[dir];
    }),
    button(`tool${tool === "erase" ? " on" : ""}`, "Remove", "E · refunds", () => {
      tool = tool === "erase" ? null : "erase";
    }),
    button(`tool${tool === "land" ? " on" : ""}`, "Land", "L · buy plots", () => {
      tool = tool === "land" ? null : "land";
    }),
    button(`tool${plansOpen ? " on" : ""}`, "Plans", "P", () => {
      plansOpen = !plansOpen;
      showPlans();
    }),
  );
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  const n = Number(e.key);
  const picked = TOOLS[n - 1];
  if (n >= 1 && picked && world.open.kinds.has(picked)) tool = picked;
  else if (e.key === "r" || e.key === "R") dir = RIGHT[dir];
  else if (e.key === "e" || e.key === "E") tool = "erase";
  else if (e.key === "l" || e.key === "L") tool = tool === "land" ? null : "land";
  else if (e.key === "p" || e.key === "P") {
    plansOpen = !plansOpen;
    showPlans();
  } else if (e.key === "Escape") tool = null;
  else return;
  fit();
  toolbar();
});

function take(x: number, y: number): void {
  const did = remove(world, x, y);
  if (did.ok) coins += did.refund;
}
function place(x: number, y: number, d: Dir): boolean {
  if (tool === null) {
    // With nothing in hand, a tap shuts or opens a crate.
    const there = world.cells[at(world, x, y)];
    if (there?.kind === "crate") setOpen(world, x, y, !there.open);
    return false;
  }
  if (tool === "erase") {
    take(x, y);
    return true;
  }
  if (tool === "land") {
    const plot = plotAt(world, x, y);
    if (plot && !plot.owned && pay(buyPlot(world, plot.id, coins))) say("The yard is bigger");
    return false;
  }
  const fresh = !world.cells[at(world, x, y)];
  if (!pay(build(world, tool, x, y, d, coins))) return false;
  if (fresh) born.set(at(world, x, y), performance.now());
  return true;
}
/** A drag lays belts along its path, each pointing at the next; other tools place where the pointer goes down. */
let drag: { last: [number, number]; erase: boolean } | null = null;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  const [x, y] = cellAt(e.clientX, e.clientY);
  const erase = e.button === 2 || tool === "erase";
  drag = { last: [x, y], erase };
  if (erase) take(x, y);
  else place(x, y, dir);
  canvas.setPointerCapture(e.pointerId);
  fit();
  toolbar();
});
canvas.addEventListener("pointermove", (e) => {
  const [x, y] = cellAt(e.clientX, e.clientY);
  hover = [x, y];
  if (!drag || (x === drag.last[0] && y === drag.last[1])) return;
  if (drag.erase) take(x, y);
  else if (tool === "belt") {
    // Step a tile at a time toward the pointer, so a fast drag leaves no gaps.
    let [cx, cy] = drag.last;
    while (cx !== x || cy !== y) {
      const sx = Math.abs(x - cx) >= Math.abs(y - cy) ? Math.sign(x - cx) : 0;
      const sy = sx ? 0 : Math.sign(y - cy);
      const d: Dir = sx > 0 ? 0 : sx < 0 ? 2 : sy > 0 ? 1 : 3;
      dir = d;
      const back = world.cells[at(world, cx, cy)];
      if (back?.kind === "belt") build(world, "belt", cx, cy, d, coins);
      cx += sx;
      cy += sy;
      place(cx, cy, d);
    }
    toolbar();
  }
  drag.last = [x, y];
});
const drop = (): void => {
  drag = null;
};
canvas.addEventListener("pointerup", drop);
canvas.addEventListener("pointercancel", drop);
canvas.addEventListener("pointerleave", () => (hover = null));

// ---------- what is asked for ----------

const orderEl = $("order");
const wants = (want: Tally, filled: Tally): string =>
  ITEMS.filter((k) => (want[k] ?? 0) > 0)
    .map((k) => {
      const have = filled[k] ?? 0;
      const n = want[k] ?? 1;
      return `<div class="row"><span class="chip" style="background:${COLOUR[k]}"></span><span>${ITEM[k].name}</span><span class="bar"><i style="width:${(have / n) * 100}%"></i></span><span>${have}/${n}</span></div>`;
    })
    .join("");
function showOrders(): void {
  const o = storyOrder(world);
  const opens = o
    ? [...(o.opens.kinds ?? []).map((k) => KIND[k].name), ...(o.opens.plots ?? []), ...(o.opens.plans ?? [])]
    : [];
  const story = o
    ? `<div class="label">Order ${world.story + 1} of ${STORY.length} · ${o.from}</div><div class="title">${o.title}</div>` +
      wants(o.want, world.filled) +
      `<div class="pay">Pays ${o.pay} Coins${opens.length ? ` · opens ${opens.join(", ")}` : ""}</div>`
    : `<div class="label">The story is told</div><div class="title">The Works is running</div>`;
  const board = world.board
    .map((s, slot) => {
      const full = isFilled(s.want, s.filled);
      const act = full
        ? `<button data-claim="${slot}">Hand over · ${s.pay}</button>`
        : `<button data-swap="${slot}"${swapRefusal(world, slot) === null ? "" : " disabled"}>Swap</button>`;
      return `<div class="standing${full ? " full" : ""}"><div class="label">${s.from} · pays ${s.pay}</div><div>${s.title}</div>${wants(s.want, s.filled)}${act}</div>`;
    })
    .join("");
  orderEl.innerHTML = story + board;
}
// Taken on the way down: the panel is written afresh twice a second, and a click needs its button to last.
orderEl.addEventListener("pointerdown", (e) => {
  const hit = e.target instanceof Element ? e.target.closest("button") : null;
  if (!(hit instanceof HTMLElement)) return;
  if (hit.dataset.claim !== undefined) {
    const got = claim(world, Number(hit.dataset.claim));
    if (got !== null) say(`Handed over for ${got} Coins`);
  } else if (hit.dataset.swap !== undefined && !swap(world, Number(hit.dataset.swap)))
    say(swapRefusal(world, Number(hit.dataset.swap)) ?? "", true);
  showOrders();
});

const plansEl = $("plans");
function showPlans(): void {
  plansEl.hidden = !plansOpen;
  if (!plansOpen) return;
  plansEl.innerHTML =
    `<div class="label">Plans</div>` +
    PLANS.map((p) => {
      const { state, why } = planState(world, p.id);
      const under = state === "owned" ? "bought" : state === "for sale" ? `${p.price} Coins` : (why ?? "");
      return `<button data-plan="${p.id}" class="plan ${state.replace(" ", "-")}"><b>${p.name}</b> · ${under}<br /><small>${p.what}</small></button>`;
    }).join("");
}
plansEl.addEventListener("pointerdown", (e) => {
  const hit = e.target instanceof Element ? e.target.closest("button") : null;
  const plan = PLANS.find((p) => hit instanceof HTMLElement && p.id === hit.dataset.plan);
  if (!plan) return;
  if (pay(buyPlan(world, plan.id, coins))) say(`${plan.name}: ${plan.what}`);
  showPlans();
  toolbar();
});

function banner(label: string, title: string, under: string): void {
  document.querySelector("#banner")?.remove();
  const b = document.createElement("div");
  b.id = "banner";
  b.innerHTML = `<span class="label">${label}</span><b>${title}</b><span>${under}</span>`;
  document.body.append(b);
  b.addEventListener("animationend", () => b.remove());
}
function guide(): void {
  if (performance.now() < scold) return;
  const has = (k: Kind): boolean => world.cells.some((b) => b?.kind === k);
  const taken = ITEMS.reduce((sum, k) => sum + (world.depot[k] ?? 0), 0);
  const p = power(world);
  if (tool === "land") say("Tap a plot that is for sale to buy it");
  else if (!has("gatherer")) say("Pick Gatherer and put one on the green deadfall near the depot");
  else if (!has("mill")) say("Put a Mill where the gatherer points (its arrow). It saws deadfall into planks");
  else if (!has("belt") || taken === 0) say("Pick Belt and drag from the mill's arrow to the depot in the middle");
  else if (p.pace < 1) say(`Short of power: everything is working at ${Math.round(p.pace * 100)}% of its pace`);
  else if (world.story === 0) say("More gatherers, more planks. Belts can join from the side");
  else if (world.story === 1 && !has("pylon"))
    say("Ore and stone are out of the depot's power. Carry it to them with Pylons");
  else if (world.story === 2) say("A Bench takes two different things, one from each side, and makes a third");
  else say(storyOrder(world)?.say ?? "Right-click or Remove to take things back. R turns what you place");
}

// ---------- drawing ----------

const centre = (x: number, y: number): [number, number] => [ox + (x + 0.5) * tile, oy + (y + 0.5) * tile];
function arrow(cx: number, cy: number, d: Dir, size: number, colour: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate((d * Math.PI) / 2);
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(size, 0);
  g.lineTo(-size * 0.6, -size * 0.8);
  g.lineTo(-size * 0.6, size * 0.8);
  g.fill();
  g.restore();
}
function drawItem(item: Item, px: number, py: number, size: number): void {
  g.fillStyle = "#1a0f1e";
  g.fillRect(px - size / 2 - 1, py - size / 2 - 1, size + 2, size + 2);
  g.fillStyle = COLOUR[item];
  g.fillRect(px - size / 2, py - size / 2, size, size);
  g.fillStyle = "#ffffff40";
  g.fillRect(px - size / 2, py - size / 2, size, Math.max(1, size * 0.25));
}
const letters = (size: number): void => {
  g.font = `700 ${Math.round(size)}px ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
};
function drawBuilding(b: Building, i: number, alpha: number, now: number): void {
  const x = i % world.land.w;
  const y = Math.floor(i / world.land.w);
  const [cx, cy] = centre(x, y);
  // A thing just built pops up a little past its size and settles.
  const age = Math.min(1, (now - (born.get(i) ?? -1e9)) / 160);
  const s = (age < 1 ? 0.6 + 0.55 * Math.sin(age * 2.2) : 1) * tile;
  const live = world.power[i] === 1;
  const along = world.rates.belt / TICKS.belt;
  if (b.kind === "belt" || b.kind === "splitter" || b.kind === "joiner" || b.kind === "tunnel") {
    g.fillStyle = b.kind === "belt" ? "#4b3d5c" : b.kind === "tunnel" ? "#1a0f1e" : "#5a4274";
    g.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
    // Chevrons run along a belt at the pace it carries.
    const run = ((now / 1000) * 10 * along) % 1;
    for (const k of [-0.5, 0, 0.5]) {
      const off = ((k + run * 0.5 + 0.75) % 1) - 0.5;
      arrow(cx + DX[b.dir] * off * tile * 0.8, cy + DY[b.dir] * off * tile * 0.8, b.dir, tile * 0.12, "#8f7fa8");
    }
    if (b.kind !== "belt") {
      g.strokeStyle = b.kind === "splitter" ? "#b07ae6" : b.kind === "joiner" ? "#5aa9e6" : "#d49045";
      g.lineWidth = 2;
      g.strokeRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
    }
    if (b.item) {
      const p = Math.min(1, b.prog + (b.prog < 1 ? alpha * along : 0)) - 0.5;
      drawItem(b.item, cx + DX[b.dir] * p * tile, cy + DY[b.dir] * p * tile, tile * 0.36);
    }
    return;
  }
  if (b.kind === "pylon") {
    g.fillStyle = "#1a0f1e";
    g.fillRect(cx - s * 0.12, cy - s * 0.3, s * 0.24, s * 0.66);
    g.fillStyle = live ? "#ffd98a" : "#6a5a80";
    g.beginPath();
    g.arc(cx, cy - s * 0.22, s * 0.2, 0, 6.3);
    g.fill();
    return;
  }
  g.fillStyle = "#1a0f1e";
  g.fillRect(cx - s * 0.46, cy - s * 0.46, s * 0.92, s * 0.92);
  g.fillStyle = live || b.kind === "crate" ? (BODY[b.kind] ?? "#3a3340") : "#3a3340";
  g.fillRect(cx - s * 0.4, cy - s * 0.4, s * 0.8, s * 0.8);
  g.fillStyle = "#ffffff22";
  g.fillRect(cx - s * 0.4, cy - s * 0.4, s * 0.8, s * 0.16);
  g.fillStyle = b.kind === "boiler" && b.fuel > 0 ? "#ffb060" : live ? "#fff3cf" : "#9a86a8";
  letters(tile * 0.42);
  g.fillText(b.kind === "crate" ? (b.open ? String(b.count) : `[${b.count}]`) : (LETTER[b.kind] ?? "?"), cx, cy + 1);
  if (b.kind !== "wheel" && b.kind !== "boiler")
    arrow(cx + DX[b.dir] * tile * 0.43, cy + DY[b.dir] * tile * 0.43, b.dir, tile * 0.13, live ? "#f5b95e" : "#6a5a80");
  // How far its work has come, along the bottom.
  const needs = b.kind === "gatherer" ? TICKS.gather : b.making ? (RECIPE[b.making]?.ticks ?? 0) : 0;
  if (b.work > 0 && needs > 0) {
    g.fillStyle = "#f5b95e";
    g.fillRect(cx - s * 0.4, cy + s * 0.32, s * 0.8 * Math.min(1, b.work / needs), s * 0.08);
  }
  if (b.out && b.kind !== "crate")
    drawItem(b.out, cx + DX[b.dir] * tile * 0.2, cy + DY[b.dir] * tile * 0.2, tile * 0.3);
  if (!live && b.kind !== "crate") {
    g.fillStyle = "#e67967";
    letters(tile * 0.5);
    g.fillText("!", cx + tile * 0.3, cy - tile * 0.28);
  }
}
function draw(alpha: number, now: number): void {
  const { land } = world;
  g.fillStyle = "#1b1220";
  g.fillRect(0, 0, innerWidth, innerHeight);
  const powering =
    tool !== null &&
    tool !== "erase" &&
    tool !== "land" &&
    (KIND[tool].draw > 0 || KIND[tool].gives > 0 || tool === "pylon");
  const owned = land.plots.map((p) => world.plots.includes(p.id));
  for (let y = view.y0; y < view.y1; y++)
    for (let x = view.x0; x < view.x1; x++) {
      const i = y * land.w + x;
      const dep = land.deposit[i];
      g.fillStyle = land.water[i]
        ? "#24507a"
        : land.trunk[i]
          ? "#3b1f19"
          : dep
            ? GROUND[dep]
            : (x + y) % 2
              ? "#261b2e"
              : "#231829";
      g.fillRect(ox + x * tile, oy + y * tile, tile, tile);
      if (dep) {
        g.fillStyle = COLOUR[dep];
        const k = (x * 7 + y * 13) % 5;
        g.fillRect(ox + x * tile + tile * (0.2 + k * 0.1), oy + y * tile + tile * 0.3, tile * 0.14, tile * 0.14);
        g.fillRect(ox + x * tile + tile * (0.6 - k * 0.06), oy + y * tile + tile * 0.62, tile * 0.12, tile * 0.12);
      }
      // Where power reaches is shown while placing something that needs it.
      if (powering && world.power[i]) {
        g.fillStyle = "rgba(245,185,94,0.09)";
        g.fillRect(ox + x * tile, oy + y * tile, tile, tile);
      }
      if (!owned[land.plot[i] ?? -1]) {
        g.fillStyle = "rgba(10,6,14,0.6)";
        g.fillRect(ox + x * tile, oy + y * tile, tile, tile);
      }
    }
  world.cells.forEach((b, i) => {
    if (b && b.kind !== "depot") drawBuilding(b, i, alpha, now);
  });
  // The depot: three tiles square, and it swells a little each time something arrives.
  const [px, py] = centre(...land.depot);
  const big = tile * (1.44 + pulse * 0.08);
  g.fillStyle = "#1a0f1e";
  g.fillRect(px - big - 2, py - big - 2, big * 2 + 4, big * 2 + 4);
  g.fillStyle = "#54286a";
  g.fillRect(px - big, py - big, big * 2, big * 2);
  g.strokeStyle = "#f5b95e";
  g.lineWidth = 3;
  g.strokeRect(px - big + 3, py - big + 3, big * 2 - 6, big * 2 - 6);
  g.fillStyle = "#ffd98a";
  letters(tile * 0.5);
  g.fillText("DEPOT", px, py);
  // Plots, by name, while choosing land.
  if (tool === "land")
    for (const p of land.plots) {
      const { state } = plotState(world, p.id);
      g.strokeStyle = state === "owned" ? "#8bbf5a" : state === "for sale" ? "#f5b95e" : "#5a4a6a";
      g.lineWidth = 2;
      g.strokeRect(ox + p.x * tile + 2, oy + p.y * tile + 2, p.w * tile - 4, p.h * tile - 4);
      g.fillStyle = state === "not yet" ? "#9a86a8" : "#fff3cf";
      letters(Math.max(10, tile * 0.9));
      g.fillText(p.name, ox + (p.x + p.w / 2) * tile, oy + (p.y + 1.2) * tile);
      if (state !== "owned")
        g.fillText(
          state === "for sale" ? `${p.price} Coins` : "not yet",
          ox + (p.x + p.w / 2) * tile,
          oy + (p.y + 2.6) * tile,
        );
    }
  for (const p of pops) {
    const k = (now - p.t) / 2600;
    if (k < 0) continue;
    g.globalAlpha = Math.max(0, 1 - k * k);
    g.fillStyle = p.colour;
    letters(Math.min(18, Math.max(12, innerWidth / 44)));
    g.fillText(p.text, p.x, p.y - k * 30);
  }
  g.globalAlpha = 1;
  // What would be built where the pointer is.
  if (!hover || tool === null || tool === "land" || at(world, hover[0], hover[1]) < 0) return;
  const [hx, hy] = centre(hover[0], hover[1]);
  const ok = tool === "erase" ? false : refusal(world, tool, hover[0], hover[1], coins, dir) === null;
  g.strokeStyle = ok ? "#8bbf5a" : "#e67967";
  g.lineWidth = 2;
  g.strokeRect(hx - tile / 2 + 1, hy - tile / 2 + 1, tile - 2, tile - 2);
  if (tool === "erase") return;
  if (tool === "pylon") {
    g.beginPath();
    g.arc(hx, hy, REACH.pylon * world.rates.reach * tile, 0, 6.3);
    g.stroke();
  } else arrow(hx, hy, dir, tile * 0.2, ok ? "#8bbf5aaa" : "#e67967aa");
  // A tunnel shows where it would come up.
  const exit = tool === "tunnel" ? tunnelExit(world, hover[0], hover[1], dir) : null;
  if (exit) g.strokeRect(ox + exit.x * tile + 1, oy + exit.y * tile + 1, tile - 2, tile - 2);
}

// ---------- the clock ----------

let keptAt = 0;
let shown = "";
let taken = ITEMS.reduce((sum, k) => sum + (world.depot[k] ?? 0), 0);
function welcome(away: Away | null): void {
  if (!away) return;
  pops.push({
    x: innerWidth / 2,
    y: innerHeight * 0.4,
    text: awayLine(away),
    t: performance.now() + 400,
    colour: "#ffd98a",
  });
}
function frame(now: number): void {
  welcome(runTo(world, Date.now()));
  bank();
  for (const news of drain(world)) {
    if (news.kind === "story") banner("Order filled", news.title, `+${news.pay} Coins`);
    else if (news.kind === "filled") banner("Ready to hand over", news.title, `${news.pay} Coins waiting`);
    toolbar();
    fit();
  }
  const total = ITEMS.reduce((sum, k) => sum + (world.depot[k] ?? 0), 0);
  if (total > taken) pulse = 1;
  taken = total;
  pulse *= 0.9;
  while (pops[0] && now - pops[0].t > 2600) pops.shift();
  draw(Math.min(1, Math.max(0, (Date.now() - world.seen) / TICK_MS)), now);
  const p = power(world);
  const left = boostLeft(world, Date.now());
  const line = `${Math.floor(coins)}|${p.demand}|${p.supply}|${Math.ceil(left / 1000)}|${world.tick - (world.tick % 5)}|${world.story}`;
  if (line !== shown) {
    shown = line;
    $("coins").textContent = Math.floor(coins).toLocaleString("en-US");
    $("power").textContent =
      `Power ${p.demand} of ${p.supply}${p.pace < 1 ? ` · ${Math.round(p.pace * 100)}%` : ""}` +
      (left > 0 ? ` · second shift ${Math.ceil(left / 60_000)} min` : "");
    showOrders();
    guide();
  }
  if (now - keptAt > 3000) {
    keptAt = now;
    keep();
  }
  requestAnimationFrame(frame);
}
function keep(): void {
  try {
    localStorage.setItem(KEY, save(world));
    localStorage.setItem(PURSE, String(Math.floor(coins)));
  } catch {
    // Not kept this time.
  }
}
addEventListener("pagehide", keep);
fit();
toolbar();
showPlans();
requestAnimationFrame(frame);

Object.assign(window, {
  works: {
    get world() {
      return world;
    },
    get coins() {
      return coins;
    },
    set coins(n: number) {
      coins = n;
    },
    /** Starts a new yard, some way into the story if asked, for review. */
    reset(story = 0, seed = 1): void {
      world = create({ seed, story });
      world.seen = Date.now();
      coins = 0;
      taken = 0;
      fit();
      toolbar();
      showPlans();
    },
    build: (k: Kind, x: number, y: number, d: Dir): boolean => pay(build(world, k, x, y, d, coins)),
    plot(id: Parameters<typeof buyPlot>[1]): boolean {
      const ok = pay(buyPlot(world, id, coins));
      fit();
      return ok;
    },
    plan(id: Parameters<typeof buyPlan>[1]): boolean {
      const ok = pay(buyPlan(world, id, coins));
      toolbar();
      showPlans();
      return ok;
    },
    /** Runs the yard on by hand, since a headless page draws about a frame a second. */
    run(ticks: number): void {
      for (let i = 0; i < ticks; i++) step(world);
      world.seen = Date.now();
    },
    /** Starts a second shift of so many minutes. */
    boost: (minutes: number): void => boost(world, Date.now(), minutes * 60_000),
    pick(t: typeof tool): void {
      tool = t;
      fit();
      toolbar();
    },
    /** Where a tile is on the page, for a script to tap. */
    page: (x: number, y: number): { x: number; y: number } => ({ x: ox + (x + 0.5) * tile, y: oy + (y + 0.5) * tile }),
  },
});
