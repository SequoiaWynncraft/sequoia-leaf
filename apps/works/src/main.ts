/**
 * The Works, as a grey-box: the factory simulation drawn plainly on a canvas, with the tools to
 * build it. It is here to find out whether building and watching it is good to do. The art comes
 * after that is known.
 */
import {
  at,
  build,
  type Building,
  coreAt,
  COST,
  create,
  type Dir,
  DX,
  DY,
  type Item,
  type Kind,
  load,
  ORDERS,
  REACH,
  refusal,
  remove,
  save,
  step,
  TICKS,
  type World,
} from "./sim.ts";

const canvas = document.querySelector("canvas")!;
const g = canvas.getContext("2d")!;
const $ = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

const COLOUR: Record<Item, string> = {
  wood: "#9a6a3a",
  ore: "#d0804c",
  stone: "#a3a9b5",
  plank: "#e2bd72",
  ingot: "#e8e2d4",
  brick: "#c65a44",
  tool: "#5aa9e6",
  gear: "#f5b95e",
  frame: "#8bbf5a",
  engine: "#e67fb0",
};
const GROUND: Partial<Record<Item, string>> = { wood: "#2f4a2c", ore: "#5a3a2c", stone: "#3c4250" };
const NAME: Record<Kind, string> = {
  belt: "Belt",
  miner: "Miner",
  refinery: "Refinery",
  assembler: "Assembler",
  splitter: "Splitter",
  pylon: "Pylon",
  core: "Depot",
};
const TOOLS: readonly Kind[] = ["belt", "miner", "refinery", "assembler", "splitter", "pylon"];
const KEY = "works.save.v1";

// ---------- the factory, as it was left ----------

let world: World = (() => {
  try {
    return load(localStorage.getItem(KEY) ?? "") ?? create();
  } catch {
    return create();
  }
})();
let tool: Kind | "erase" | null = "miner";
let dir: Dir = 0;
let hover: [number, number] | null = null;
/** When each thing was built, for its small pop; and words rising from the depot. */
const born = new Map<number, number>();
const pops: { x: number; y: number; text: string; t: number; colour: string }[] = [];
let pulse = 0;

// While away: the factory is run on, as far as is cheap, and paid for the rest at the pace it showed.
const away = (() => {
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(`${KEY}.seen`) ?? 0);
  } catch {
    // No clock kept.
  }
  const secs = seen ? Math.min(8 * 3600, Math.max(0, (Date.now() - seen) / 1000)) : 0;
  if (secs < 20) return 0;
  const before = world.coins;
  const ticks = Math.min(secs * 10, 12_000);
  for (let i = 0; i < ticks; i++) step(world);
  const made = world.coins - before;
  const rest = Math.round((made / ticks) * (secs * 10 - ticks));
  world.coins += rest;
  return made + rest;
})();

// ---------- the view ----------

let tile = 24;
let ox = 0;
let oy = 0;
function fit(): void {
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const top = 70;
  const bottom = 132;
  tile = Math.max(12, Math.floor(Math.min(innerWidth / world.w, (innerHeight - top - bottom) / world.h)));
  ox = Math.round((innerWidth - tile * world.w) / 2);
  oy = Math.round(top + (innerHeight - top - bottom - tile * world.h) / 2);
}
addEventListener("resize", fit);
fit();
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
  if (bad) scold = performance.now() + 1800;
}
const tools = $("tools");
const ARROW = ["→", "↓", "←", "↑"];
function toolbar(): void {
  tools.replaceChildren(
    ...TOOLS.map((k, i) => {
      const b = document.createElement("button");
      const open = world.unlocked.includes(k);
      b.className = `tool${tool === k ? " on" : ""}${open ? "" : " locked"}`;
      b.innerHTML = `<span>${NAME[k]}</span><small>${open ? `${COST[k]} coins · ${i + 1}` : "locked"}</small>`;
      b.addEventListener("click", () => {
        if (!open) return say(`${NAME[k]} unlocks with a later order`, true);
        tool = tool === k ? null : k;
        toolbar();
      });
      return b;
    }),
    (() => {
      const b = document.createElement("button");
      b.className = "tool";
      b.innerHTML = `<span>Turn ${ARROW[dir]}</span><small>R</small>`;
      b.addEventListener("click", () => {
        dir = ((dir + 1) % 4) as Dir;
        toolbar();
      });
      return b;
    })(),
    (() => {
      const b = document.createElement("button");
      b.className = `tool${tool === "erase" ? " on" : ""}`;
      b.innerHTML = `<span>Remove</span><small>E · refunds</small>`;
      b.addEventListener("click", () => {
        tool = tool === "erase" ? null : "erase";
        toolbar();
      });
      return b;
    })(),
  );
}
toolbar();
window.addEventListener("keydown", (e: KeyboardEvent) => {
  const n = Number(e.key);
  if (n >= 1 && n <= TOOLS.length && world.unlocked.includes(TOOLS[n - 1]!)) tool = TOOLS[n - 1]!;
  else if (e.key === "r" || e.key === "R") dir = ((dir + 1) % 4) as Dir;
  else if (e.key === "e" || e.key === "E") tool = "erase";
  else if (e.key === "Escape") tool = null;
  else return;
  toolbar();
});

function place(x: number, y: number, d: Dir): boolean {
  if (!tool) return false;
  if (tool === "erase") return remove(world, x, y);
  const why = refusal(world, tool, x, y);
  if (why) {
    say(why, true);
    return false;
  }
  const fresh = !world.cells[at(world, x, y)];
  build(world, tool, x, y, d);
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
  if (erase) remove(world, x, y);
  else place(x, y, dir);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const [x, y] = cellAt(e.clientX, e.clientY);
  hover = [x, y];
  if (!drag || (x === drag.last[0] && y === drag.last[1])) return;
  if (drag.erase) remove(world, x, y);
  else if (tool === "belt") {
    // Step a cell at a time toward the pointer, so a fast drag leaves no gaps.
    let [cx, cy] = drag.last;
    while (cx !== x || cy !== y) {
      const sx = Math.abs(x - cx) >= Math.abs(y - cy) ? Math.sign(x - cx) : 0;
      const sy = sx ? 0 : Math.sign(y - cy);
      const d = (sx > 0 ? 0 : sx < 0 ? 2 : sy > 0 ? 1 : 3) as Dir;
      dir = d;
      const back = world.cells[at(world, cx, cy)];
      if (back?.kind === "belt") back.dir = d;
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
let shownOrder = -1;
function showOrder(): void {
  const o = ORDERS[world.order];
  if (!o) {
    orderEl.innerHTML = `<div class="label">All orders filled</div><div class="title">The Works is running</div><div class="pay">The depot still pays for everything you send it.</div>`;
    return;
  }
  orderEl.innerHTML =
    `<div class="label">Order ${world.order + 1} of ${ORDERS.length} · ${o.from}</div><div class="title">${o.title}</div>` +
    Object.entries(o.want)
      .map(([k, n]) => {
        const have = world.filled[k as Item] ?? 0;
        return `<div class="row"><span class="chip" style="background:${COLOUR[k as Item]}"></span><span>${k}</span><span class="bar"><i style="width:${(have / n) * 100}%"></i></span><span>${have}/${n}</span></div>`;
      })
      .join("") +
    `<div class="pay">Pays ${o.pay} coins${o.unlocks.length ? ` · unlocks ${o.unlocks.map((u) => NAME[u]).join(", ")}` : ""}</div>`;
}
function banner(title: string, under: string): void {
  document.querySelector("#banner")?.remove();
  const b = document.createElement("div");
  b.id = "banner";
  b.innerHTML = `<span class="label">Order filled</span><b>${title}</b><span>${under}</span>`;
  document.body.append(b);
  b.addEventListener("animationend", () => b.remove());
}
function guide(): void {
  if (performance.now() < scold) return;
  const has = (k: Kind): boolean => world.cells.some((b) => b?.kind === k);
  const delivered = Object.values(world.depot).reduce((a, b) => a + (b ?? 0), 0);
  if (!has("miner")) say("Pick Miner and put one on the green wood near the depot");
  else if (!has("refinery")) say("Put a Refinery where the miner points (its arrow). It turns wood into planks");
  else if (!has("belt") || delivered === 0)
    say("Pick Belt and drag from the refinery's arrow to the depot in the middle");
  else if (world.order === 0) say("More miners, more planks. Belts can join from the side");
  else if (world.order === 1 && !world.cells.some((b, i) => b?.kind === "miner" && world.deposit[i] !== "wood"))
    say("Ore and stone are out of the depot's power. Carry power to them with Pylons");
  else if (world.order === 2) say("An Assembler takes two different things, one from each side, and makes a third");
  else say("Right-click or Remove to take things back. R turns what you place");
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
function drawBuilding(b: Building, i: number, alpha: number, now: number): void {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  const [cx, cy] = centre(x, y);
  // A thing just built pops up a little past its size and settles.
  const age = Math.min(1, (now - (born.get(i) ?? -1e9)) / 160);
  const s = (age < 1 ? 0.6 + 0.55 * Math.sin(age * 2.2) : 1) * tile;
  const live = world.power[i] === 1;
  if (b.kind === "belt" || b.kind === "splitter") {
    g.fillStyle = b.kind === "belt" ? "#4b3d5c" : "#5a4274";
    g.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
    // Chevrons run along a belt at the pace it carries.
    const run = ((now / 1000) * (10 / TICKS.belt)) % 1;
    for (const k of [-0.5, 0, 0.5]) {
      const off = ((k + run * 0.5 + 0.75) % 1) - 0.5;
      arrow(cx + DX[b.dir] * off * tile * 0.8, cy + DY[b.dir] * off * tile * 0.8, b.dir, tile * 0.12, "#8f7fa8");
    }
    if (b.kind === "splitter") {
      g.strokeStyle = "#b07ae6";
      g.lineWidth = 2;
      g.strokeRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
    }
    if (b.item) {
      const p = Math.min(1, b.prog + (b.prog < 1 ? alpha / TICKS.belt : 0)) - 0.5;
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
    if (live) {
      g.fillStyle = `rgba(255,217,138,${0.12 + 0.08 * Math.sin(now / 300 + i)})`;
      g.beginPath();
      g.arc(cx, cy - s * 0.22, s * 0.42, 0, 6.3);
      g.fill();
    }
    return;
  }
  const body = b.kind === "miner" ? "#6a4a3a" : b.kind === "refinery" ? "#5a4a7a" : "#3f6a78";
  g.fillStyle = "#1a0f1e";
  g.fillRect(cx - s * 0.46, cy - s * 0.46, s * 0.92, s * 0.92);
  g.fillStyle = live ? body : "#3a3340";
  g.fillRect(cx - s * 0.4, cy - s * 0.4, s * 0.8, s * 0.8);
  g.fillStyle = "#ffffff22";
  g.fillRect(cx - s * 0.4, cy - s * 0.4, s * 0.8, s * 0.16);
  g.fillStyle = live ? "#fff3cf" : "#9a86a8";
  g.font = `700 ${Math.round(tile * 0.42)}px ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(b.kind === "miner" ? "M" : b.kind === "refinery" ? "R" : "A", cx, cy + 1);
  arrow(cx + DX[b.dir] * tile * 0.43, cy + DY[b.dir] * tile * 0.43, b.dir, tile * 0.13, live ? "#f5b95e" : "#6a5a80");
  // How far its work has come, along the bottom.
  const need = TICKS[b.kind as "miner" | "refinery" | "assembler"];
  if (b.work > 0) {
    g.fillStyle = "#f5b95e";
    g.fillRect(cx - s * 0.4, cy + s * 0.32, s * 0.8 * Math.min(1, (b.work + alpha) / need), s * 0.08);
  }
  if (b.out) drawItem(b.out, cx + DX[b.dir] * tile * 0.2, cy + DY[b.dir] * tile * 0.2, tile * 0.3);
  if (!live) {
    g.fillStyle = "#e67967";
    g.font = `700 ${Math.round(tile * 0.5)}px ui-monospace, monospace`;
    g.fillText("!", cx + tile * 0.3, cy - tile * 0.28);
  }
}
function draw(alpha: number, now: number): void {
  g.fillStyle = "#1b1220";
  g.fillRect(0, 0, innerWidth, innerHeight);
  const powering = tool === "pylon" || tool === "miner" || tool === "refinery" || tool === "assembler";
  for (let y = 0; y < world.h; y++)
    for (let x = 0; x < world.w; x++) {
      const i = y * world.w + x;
      const dep = world.deposit[i];
      g.fillStyle = dep ? GROUND[dep]! : (x + y) % 2 ? "#261b2e" : "#231829";
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
    }
  world.cells.forEach((b, i) => {
    if (b && b.kind !== "core") drawBuilding(b, i, alpha, now);
  });
  // The depot: three tiles square, and it swells a little each time it is paid.
  const [cx, cy] = coreAt(world);
  const [px, py] = centre(cx, cy);
  const big = tile * (1.44 + pulse * 0.08);
  g.fillStyle = "#1a0f1e";
  g.fillRect(px - big - 2, py - big - 2, big * 2 + 4, big * 2 + 4);
  g.fillStyle = "#54286a";
  g.fillRect(px - big, py - big, big * 2, big * 2);
  g.strokeStyle = "#f5b95e";
  g.lineWidth = 3;
  g.strokeRect(px - big + 3, py - big + 3, big * 2 - 6, big * 2 - 6);
  g.fillStyle = "#ffd98a";
  g.font = `700 ${Math.round(tile * 0.5)}px ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("DEPOT", px, py);
  for (const p of pops) {
    const k = (now - p.t) / 900;
    g.globalAlpha = Math.max(0, 1 - k);
    g.fillStyle = p.colour;
    g.font = `700 ${Math.round(tile * 0.5)}px ui-monospace, monospace`;
    g.fillText(p.text, p.x, p.y - k * tile * 1.4);
  }
  g.globalAlpha = 1;
  // What would be built where the pointer is.
  if (hover && tool && tool !== "erase" && at(world, hover[0], hover[1]) >= 0) {
    const [hx, hy] = centre(hover[0], hover[1]);
    const ok = refusal(world, tool, hover[0], hover[1]) === null;
    g.strokeStyle = ok ? "#8bbf5a" : "#e67967";
    g.lineWidth = 2;
    g.strokeRect(hx - tile / 2 + 1, hy - tile / 2 + 1, tile - 2, tile - 2);
    if (tool !== "pylon") arrow(hx, hy, dir, tile * 0.2, ok ? "#8bbf5aaa" : "#e67967aa");
    else {
      g.beginPath();
      g.arc(hx, hy, REACH.pylon * tile, 0, 6.3);
      g.stroke();
    }
  } else if (hover && tool === "erase" && at(world, hover[0], hover[1]) >= 0) {
    const [hx, hy] = centre(hover[0], hover[1]);
    g.strokeStyle = "#e67967";
    g.lineWidth = 2;
    g.strokeRect(hx - tile / 2 + 1, hy - tile / 2 + 1, tile - 2, tile - 2);
  }
}

// ---------- the clock ----------

let before = performance.now();
let owed = 0;
let kept = 0;
let paid = Object.values(world.depot).reduce((a, b) => a + (b ?? 0), 0);
let coinsShown = -1;
function frame(now: number): void {
  owed += Math.min(250, now - before);
  before = now;
  while (owed >= 100) {
    owed -= 100;
    const order = world.order;
    const coins = world.coins;
    step(world);
    const total = Object.values(world.depot).reduce((a, b) => a + (b ?? 0), 0);
    if (total > paid) {
      paid = total;
      pulse = 1;
      const [cx, cy] = centre(...coreAt(world));
      if (pops.length < 6)
        pops.push({
          x: cx + (Math.random() - 0.5) * tile * 2,
          y: cy - tile * 1.2,
          text: `+${world.coins - coins}`,
          t: now,
          colour: "#f5b95e",
        });
    }
    if (world.order !== order) {
      const o = ORDERS[order]!;
      banner(
        o.title,
        `+${o.pay} coins${o.unlocks.length ? ` · ${o.unlocks.map((u) => NAME[u]).join(", ")} unlocked` : ""}`,
      );
      toolbar();
    }
  }
  pulse *= 0.9;
  while (pops.length && now - pops[0]!.t > 900) pops.shift();
  draw(owed / 100, now);
  if (world.coins !== coinsShown) {
    coinsShown = world.coins;
    $("coins").textContent = Math.floor(world.coins).toLocaleString("en-US");
  }
  if (world.order !== shownOrder || world.tick % 5 === 0) {
    shownOrder = world.order;
    showOrder();
    guide();
  }
  if (now - kept > 3000) {
    kept = now;
    keep();
  }
  requestAnimationFrame(frame);
}
function keep(): void {
  try {
    localStorage.setItem(KEY, save(world));
    localStorage.setItem(`${KEY}.seen`, String(Date.now()));
  } catch {
    // Not kept this time.
  }
}
addEventListener("pagehide", keep);
showOrder();
guide();
if (away > 0) {
  pops.push({
    x: innerWidth / 2,
    y: innerHeight / 2,
    text: `While you were away: +${Math.round(away)} coins`,
    t: performance.now() + 600,
    colour: "#ffd98a",
  });
}
requestAnimationFrame(frame);

Object.assign(window, {
  works: {
    get world() {
      return world;
    },
    /** Starts a new plot, or builds from a list, for review. */
    reset(): void {
      world = create();
      paid = 0;
      fit();
      toolbar();
    },
    build: (k: Kind, x: number, y: number, d: Dir): boolean => build(world, k, x, y, d),
    run(ticks: number): void {
      for (let i = 0; i < ticks; i++) step(world);
    },
  },
});
