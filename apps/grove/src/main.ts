import { type Creature, CREATURES } from "./art/creatures.ts";
import {
  BIRDHOUSE,
  CAMPFIRE,
  CONE_OPEN,
  CONE_SHUT,
  CONE_WARM,
  HOOK_POST,
  LANTERN,
  LEAF,
  MUSHROOMS,
  SHEARS,
  WATERING_CAN,
  WIND_CHIME,
} from "./art/items.ts";
import { RARITIES, type RarityId } from "./art/palette.ts";
import { draw, type Sprite, toCanvas } from "./art/sprite.ts";
import { ANCIENT, ANCIENT_AUTUMN, SAPLING, SPROUT, TREE_STAGES, YOUNG } from "./art/tree.ts";
import { must } from "./must.ts";
import { drawGrove, type GroveState, HEIGHT, type TimeOfDay, timeOfDay, WIDTH } from "./scene.ts";

// The Sequoia Grove prototype. Each storyboard moment is a screen you reach by
// its hash (#shop, #cone, #book…), and everything on them is live: water the
// tree, buy from the stall, open a cone by the fire.

const app = must(document.getElementById("app"), "the #app element");
const still = new URLSearchParams(location.search).has("still");

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child): child is Node | string => child != null));
  return node;
}

const art = (sprite: Sprite, scale: number) => toCanvas(sprite, scale);
const rarity = (id: RarityId) =>
  must(
    RARITIES.find((r) => r.id === id),
    `rarity ${id}`,
  );
const creature = (id: string) =>
  must(
    CREATURES.find((c) => c.id === id),
    `creature ${id}`,
  );
const leafAmount = (n: number) => n.toLocaleString("en-GB");

// ---------------------------------------------------------------- state ---

const player = {
  name: "Notes",
  rank: "treant" as RarityId,
  level: 14,
  leaf: 2_840,
  cones: 3,
  bloom: 5,
  bloomGoal: 7,
  care: 2,
  owned: new Map<string, number>([
    ["mossling", 3],
    ["conelet", 2],
    ["puffcap", 1],
    ["fernfox", 1],
  ]),
};

const STALL = [
  { id: "lantern", name: "Paper lantern", sprite: LANTERN, price: 600, rarity: "sapling" as RarityId },
  { id: "chime", name: "Glass wind chime", sprite: WIND_CHIME, price: 1_200, rarity: "sprite" as RarityId },
  { id: "birdhouse", name: "Birdhouse", sprite: BIRDHOUSE, price: 900, rarity: "sapling" as RarityId },
  { id: "mushrooms", name: "Puffcap ring", sprite: MUSHROOMS, price: 350, rarity: "leafkin" as RarityId },
];
const placed = new Set(["lantern", "mushrooms"]);

// ---------------------------------------------------------------- world ---

interface WorldOptions {
  time?: TimeOfDay;
  tree?: Sprite;
  creatures?: readonly { creature: Creature; x: number }[];
  extra?: (context: CanvasRenderingContext2D, tick: number) => void;
}

function groveState(options: WorldOptions): GroveState {
  const decorations: GroveState["decorations"][number][] = [];
  const lights: { x: number; y: number }[] = [];
  if (placed.has("lantern")) {
    decorations.push({ sprite: HOOK_POST, x: 160, y: 84 }, { sprite: LANTERN, x: 163, y: 88 });
    lights.push({ x: 167, y: 93 });
  }
  if (placed.has("chime")) decorations.push({ sprite: HOOK_POST, x: 74, y: 84 }, { sprite: WIND_CHIME, x: 76, y: 88 });
  if (placed.has("mushrooms")) decorations.push({ sprite: MUSHROOMS, x: 178, y: 122 });
  if (placed.has("birdhouse")) decorations.push({ sprite: BIRDHOUSE, x: 206, y: 108 });
  return {
    time: options.time ?? timeOfDay(new Date().getHours()),
    tree: options.tree ?? YOUNG,
    campfire: true,
    lights,
    decorations,
    creatures: options.creatures ?? [
      { creature: creature("mossling"), x: 62 },
      { creature: creature("fernfox"), x: 150 },
      { creature: creature("conelet"), x: 190 },
      { creature: creature("puffcap"), x: 86 },
    ],
  };
}

/** The grove canvas, scaled by whole pixels to fill its stage, animating unless the page is taken as a still. */
function world(stage: HTMLElement, options: WorldOptions, scale: number): HTMLCanvasElement {
  const canvas = el("canvas", { class: "world" });
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  stage.style.width = `${WIDTH * scale}px`;
  stage.style.height = `${HEIGHT * scale}px`;
  stage.prepend(canvas);
  const context = must(canvas.getContext("2d"), "a 2D canvas");
  let tick = 40;
  const frame = () => {
    drawGrove(context, groveState(options), tick);
    options.extra?.(context, tick);
    tick += 1;
    if (!still && canvas.isConnected) requestAnimationFrame(frame);
  };
  frame();
  return canvas;
}

function fitScale(): number {
  return Math.max(2, Math.min(5, Math.floor(Math.min((innerWidth - 16) / WIDTH, (innerHeight - 16) / HEIGHT))));
}

// ------------------------------------------------------------------ HUD ---

function hud(stage: HTMLElement, tree: Sprite = ANCIENT) {
  const stageName = TREE_STAGES.find((s) => s.sprite === tree)?.name ?? "Old sequoia";
  const nameplate = el(
    "div",
    { class: "panel nameplate" },
    el("div", { class: "who", style: `color:#5d3f7a` }, player.name),
    el(
      "div",
      { class: "sub" },
      `Treant · SEQ Lv ${player.level} · ${stageName === "Ancient" ? "Old sequoia" : stageName}`,
    ),
    el(
      "div",
      { class: "bloom" },
      "Bloom",
      el("div", { class: "bar" }, el("i", { style: `width:${(player.bloom / player.bloomGoal) * 100}%` })),
      `${player.bloom}/${player.bloomGoal}`,
    ),
  );
  const leafPill = el("div", { class: "panel pill" }, art(LEAF, 3), leafAmount(player.leaf));
  const conePill = el("div", { class: "panel pill" }, art(CONE_SHUT, 2), String(player.cones));
  stage.append(el("div", { class: "hud-top layer" }, nameplate, el("div", { class: "pills" }, leafPill, conePill)));
}

function actions(stage: HTMLElement) {
  const button = (label: string, icon: Sprite, scale: number, go: () => void, extra = "") => {
    const b = el("button", { class: `btn ${extra}` }, art(icon, scale), label);
    b.addEventListener("click", go);
    return b;
  };
  const coneButton = button("Cones", CONE_SHUT, 2, () => (location.hash = "cone"), "hot");
  coneButton.append(el("span", { class: "badge" }, String(player.cones)));
  stage.append(
    el(
      "div",
      { class: "layer" },
      el(
        "div",
        { class: "panel actions" },
        button("Water", WATERING_CAN, 2, () => water(stage)),
        button("Prune", SHEARS, 3, () => toast(stage, "Snip snip. The pads are tidy.")),
        button("Shop", LANTERN, 3, () => (location.hash = "shop")),
        coneButton,
        button("Book", creature("mossling").frames[0], 2, () => (location.hash = "book")),
      ),
    ),
  );
}

function toast(stage: HTMLElement, text: string, icon?: Sprite) {
  const t = el("div", { class: "panel toast" }, icon ? art(icon, 2) : null, text);
  stage.append(t);
  setTimeout(() => t.remove(), 1700);
}

function water(stage: HTMLElement) {
  if (player.care === 0) {
    toast(stage, "It's had plenty for today. Come back whenever.");
    return;
  }
  player.care -= 1;
  player.bloom += 1;
  if (player.bloom >= player.bloomGoal) {
    player.bloom = 0;
    player.cones += 1;
    toast(stage, "Full bloom! A cone dropped.", CONE_SHUT);
  } else {
    toast(stage, `+1 Bloom (${player.bloom}/${player.bloomGoal})`, WATERING_CAN);
  }
  render();
}

function dialog(stage: HTMLElement, speaker: Creature, name: string, text: string) {
  stage.append(
    el(
      "div",
      { class: "layer" },
      el(
        "div",
        { class: "panel dialog" },
        el("div", { class: "portrait" }, art(speaker.frames[0], 5)),
        el("div", {}, el("div", { class: "speaker" }, name), text),
        el("span", { class: "more" }, "▼"),
      ),
    ),
  );
}

// -------------------------------------------------------------- screens ---

type Screen = (stage: HTMLElement, scale: number) => void;

const screens: Record<string, Screen> = {
  grove(stage, scale) {
    world(stage, { tree: ANCIENT, time: "golden" }, scale);
    hud(stage);
    actions(stage);
  },

  welcome(stage, scale) {
    world(stage, { tree: SPROUT, time: "morning", creatures: [{ creature: creature("conelet"), x: 150 }] }, scale);
    dialog(
      stage,
      creature("conelet"),
      "Conelet",
      "Oh! A seed came in on the wind for you. Every raid and war you play with the guild helps it grow. Want to give it some water?",
    );
  },

  care(stage, scale) {
    world(
      stage,
      {
        tree: YOUNG,
        time: "day",
        extra(context, tick) {
          // The can tips over the pot and water falls in a short stream.
          draw(context, WATERING_CAN, 132, 64, 1);
          context.fillStyle = "#9fcfe0";
          for (let i = 0; i < 6; i += 1) {
            const y = 74 + ((tick * 2 + i * 5) % 22);
            context.fillRect(133 - Math.floor(i / 2), y, 1, 2);
          }
        },
      },
      scale,
    );
    player.bloom = 6;
    hud(stage, YOUNG);
    actions(stage);
    stage.append(
      el(
        "div",
        { class: "panel toast", style: "animation:none" },
        art(WATERING_CAN, 2),
        "+1 Bloom (6/7) · 1 more for a cone",
      ),
    );
  },

  shop(stage, scale) {
    world(stage, { tree: ANCIENT, time: "golden" }, scale);
    hud(stage);
    const card = (item: (typeof STALL)[number]) => {
      const owned = placed.has(item.id);
      const node = el(
        "div",
        { class: `card${owned ? " sold" : ""}` },
        el("div", { class: "art" }, art(item.sprite, 5)),
        el("div", { class: "name" }, item.name),
        el("span", { class: "rarity", style: `background:${rarity(item.rarity).color}` }, rarity(item.rarity).name),
        owned
          ? el("div", { class: "price" }, "In your grove")
          : el("div", { class: "price" }, art(LEAF, 2), leafAmount(item.price)),
      );
      node.addEventListener("click", () => {
        if (owned || player.leaf < item.price) return;
        player.leaf -= item.price;
        placed.add(item.id);
        render();
      });
      return node;
    };
    const seasonal = el(
      "div",
      { class: "card" },
      el("span", { class: "tag" }, "Autumn only"),
      el("div", { class: "art" }, art(ANCIENT_AUTUMN, 1)),
      el("div", { class: "name" }, "Maple canopy (tree style)"),
      el("span", { class: "rarity", style: `background:${rarity("treant").color}` }, "Treant"),
      el("div", { class: "price" }, art(LEAF, 2), "12,000"),
    );
    stage.append(
      el(
        "div",
        { class: "veil" },
        el(
          "div",
          { class: "panel sheet" },
          el(
            "div",
            { class: "merchant" },
            el("div", { class: "portrait" }, art(creature("fernfox").frames[0], 5)),
            el(
              "div",
              {},
              el("h2", {}, "Fennel's Wandering Stall"),
              el(
                "div",
                { class: "speech" },
                "Fresh off the cart from Cinfras! New stock every morning, and I keep the good stuff till you come back.",
              ),
            ),
          ),
          el(
            "div",
            { class: "tabs" },
            el("button", { class: "tab on" }, "Today's stall"),
            el("button", { class: "tab" }, "Pots"),
            el("button", { class: "tab" }, "Tree styles"),
            el("button", { class: "tab" }, "Seasonal"),
          ),
          el("div", { class: "grid" }, ...STALL.map(card), seasonal),
        ),
      ),
    );
  },

  cone(stage, scale) {
    ceremony(stage, scale, "warm");
  },
  reveal(stage, scale) {
    ceremony(stage, scale, "reveal");
  },

  book(stage, scale) {
    world(stage, { tree: ANCIENT, time: "golden" }, scale);
    const seen = CREATURES.map((c) => {
      const count = player.owned.get(c.id) ?? 0;
      const r = rarity(c.rarity);
      return el(
        "div",
        { class: `card${count === 0 ? " unknown" : ""}`, style: `border-top:8px solid ${r.color}` },
        el("div", { class: "art" }, count === 0 ? silhouette(c.frames[0], 5) : art(c.frames[0], 5)),
        el("div", { class: "name" }, count === 0 ? "???" : c.name),
        el("span", { class: "rarity", style: `background:${r.color}` }, r.name),
        count === 0
          ? null
          : el(
              "div",
              { class: "bond" },
              `${"♥".repeat(Math.min(count, 5))}${"♡".repeat(Math.max(0, 5 - count))}  ×${count}`,
            ),
      );
    });
    stage.append(
      el(
        "div",
        { class: "veil" },
        el(
          "div",
          { class: "panel sheet book" },
          el("h2", {}, "Sprite Book"),
          el(
            "div",
            { class: "lede" },
            "4 of 42 found · Duplicates deepen your bond: 2 ♥ gives a shiny coat, 3 ♥ puts it by your nametag in game, 5 ♥ earns its Discord role icon.",
          ),
          el("div", { class: "grid" }, ...seen),
        ),
      ),
    );
  },

  activity(stage) {
    activityFrame(stage);
  },

  leafle(stage) {
    leafleFrame(stage);
  },

  great(stage) {
    greatSequoia(stage);
  },
};

/** A creature you haven't found, shown as a dark shape. */
function silhouette(source: Sprite, scale: number): HTMLCanvasElement {
  return art({ ...source, pixels: source.pixels.map((key) => (key === "." ? key : "O")) }, scale);
}

/** The cone ceremony: the cone warms over the campfire, cracks open, and the Sprite inside steps out. */
function ceremony(stage: HTMLElement, scale: number, phase: "warm" | "reveal") {
  stage.style.width = `${WIDTH * scale}px`;
  stage.style.height = `${HEIGHT * scale}px`;
  const found = creature("glimmerwing");
  const r = rarity(found.rarity);
  const root = el("div", { class: "ceremony", style: `--glow:${r.color}` });
  const fire = el("div", { class: "fire" }, art(CAMPFIRE[0], scale * 2));
  if (phase === "warm") {
    root.append(
      el("div", { class: "rays", style: "opacity:0.1" }),
      el("div", { class: "cone warm" }, art(CONE_WARM, scale * 4)),
      fire,
      el("div", { class: "caption" }, "The cone warms by the fire… its scales begin to part"),
    );
  } else {
    root.append(
      el("div", { class: "rays" }),
      el(
        "div",
        { class: "panel reveal" },
        el("span", { class: "new" }, "NEW!"),
        el(
          "div",
          { class: "meta" },
          art(CONE_OPEN, 3),
          el("span", { class: "rarity", style: `background:${r.color}` }, `${r.name} · 1 in 40`),
        ),
        art(found.frames[0], scale * 3),
        el("div", { class: "title" }, found.name),
        el("div", { class: "blurb" }, found.blurb),
      ),
    );
  }
  stage.append(root);
  if (!still && phase === "warm") {
    setTimeout(() => (location.hash = "reveal"), 1600);
  }
}

// ----------------------------------------------------- Discord Activity ---

const FRIENDS = [
  { name: "Notes", rank: "treant", tree: ANCIENT, color: "#5d3f7a" },
  { name: "gaz", rank: "druid", tree: YOUNG, color: "#8a9a2c" },
  { name: "crab5", rank: "dryad", tree: SAPLING, color: "#3f8fa0" },
  { name: "Mechanistor", rank: "sprite", tree: YOUNG, color: "#3f6fa8" },
] as const;

function discordSide(channel: string): HTMLElement {
  return el(
    "div",
    { class: "side" },
    el("div", {}, "VOICE CHANNELS"),
    el(
      "div",
      { style: "color:#dbdee1;font-weight:600" },
      `🔊 ${channel}`,
      el("span", { class: "live", style: "margin-left:8px" }, "● Sequoia Grove"),
    ),
    ...FRIENDS.map((f) =>
      el(
        "div",
        { class: "member" },
        el("i", { style: `background:${f.color}` }, f.name[0]?.toUpperCase() ?? ""),
        f.name,
      ),
    ),
    el("div", { style: "margin-top:12px" }, "🔊 war-room"),
    el("div", {}, "🔊 afk"),
  );
}

function activityFrame(stage: HTMLElement) {
  stage.style.width = "1160px";
  stage.style.height = "646px";
  const frame = el("div", { class: "discord", style: "position:absolute;inset:0" });
  const chrome = el(
    "div",
    { class: "chrome" },
    "🔊 raid-lobby",
    el("span", { class: "dim" }, "· Sequoia Grove"),
    el(
      "div",
      { class: "people" },
      ...FRIENDS.map((f) => el("span", { style: `background:${f.color}` }, f.name[0]?.toUpperCase() ?? "")),
    ),
  );
  // The gathering: everyone in the call brings their tree to one clearing.
  const canvas = el("canvas", { style: "position:absolute;left:200px;top:46px;width:960px;height:600px" });
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = must(canvas.getContext("2d"), "a 2D canvas");
  drawGrove(
    context,
    {
      time: "dusk",
      tree: ANCIENT,
      centrePiece: false,
      campfire: true,
      decorations: [],
      creatures: [
        { creature: creature("mossling"), x: 60 },
        { creature: creature("fernfox"), x: 200 },
      ],
    },
    40,
  );
  const tags: HTMLElement[] = [];
  const centres = [40, 98, 150, 202];
  FRIENDS.forEach((friend, i) => {
    const cx = centres[i] ?? 0;
    const y = 116 - friend.tree.height;
    draw(context, friend.tree, cx - Math.floor(friend.tree.width / 2), y, 1);
    tags.push(
      el(
        "div",
        {
          class: "nametag",
          style: `left:${200 + cx * 4}px;top:${46 + (y - 8) * 4}px;color:${rarity(friend.rank).color}`,
        },
        friend.name,
        el("small", {}, rarity(friend.rank).name),
      ),
    );
  });
  const party = el(
    "div",
    { class: "panel", style: "position:absolute;right:18px;top:64px;width:300px;font-size:16px" },
    el("b", { style: "font-size:19px" }, "Cone party!"),
    el(
      "div",
      { style: "margin:6px 0" },
      "crab5 is warming a cone by the fire. Everyone in the call gets to watch it open.",
    ),
    el(
      "div",
      { style: "display:flex;gap:10px;align-items:center" },
      art(CONE_WARM, 4),
      el("span", { style: "font-size:22px;font-weight:700" }, "3… 2…"),
    ),
  );
  frame.append(chrome, discordSide("raid-lobby"), canvas, ...tags, party);
  stage.append(frame);
}

function leafleFrame(stage: HTMLElement) {
  stage.style.width = "1160px";
  stage.style.height = "720px";
  const frame = el("div", { class: "discord", style: "position:absolute;inset:0" });
  frame.append(el("div", { class: "chrome" }, "💬 #general", el("span", { class: "dim" }, "· Sequoia Grove — Leafle")));
  // Today's word is GAVEL, the province.
  const rows: [string, string][] = [
    ["RAIDS", "ngnnn"],
    ["GROVE", "gnnyy"],
    ["GAVEL", "ggggg"],
  ];
  const grid = el(
    "div",
    { class: "leafle" },
    ...rows.map(([word, marks]) =>
      el(
        "div",
        { class: "row" },
        ...word.split("").map((letter, i) => el("div", { class: `t ${marks[i] ?? "n"}` }, letter)),
      ),
    ),
  );
  const board = el(
    "div",
    {
      class: "panel",
      style:
        "position:absolute;left:50%;top:80px;transform:translateX(-50%);width:430px;display:flex;flex-direction:column;align-items:center;gap:12px",
    },
    el("b", { style: "font-size:24px" }, "Leafle #12"),
    el(
      "div",
      { style: "font-size:15px;color:#4a3140;text-align:center" },
      "Today's Wynncraft word, played together. Everyone sees how the others did once they've solved it.",
    ),
    grid,
    el(
      "div",
      { style: "display:flex;gap:8px;align-items:center;font-size:16px" },
      "Solved in 3 · +1 Bloom ",
      art(LEAF, 2),
    ),
  );
  const side = el(
    "div",
    {
      class: "panel dark",
      style:
        "position:absolute;right:18px;top:80px;width:250px;font-size:15px;display:flex;flex-direction:column;gap:8px",
    },
    el("b", { style: "font-size:17px" }, "In this call"),
    ...FRIENDS.map((f, i) =>
      el(
        "div",
        { style: "display:flex;justify-content:space-between" },
        el("span", { style: `color:${rarity(f.rank).color}` }, f.name),
        el("span", {}, ["🌿🌿🌿🌿", "🌿🌿🌿", "…", "🌿🌿🌿🌿🌿"][i] ?? ""),
      ),
    ),
  );
  frame.append(board, side);
  stage.append(frame);
}

// --------------------------------------------------- The Great Sequoia ---

function greatSequoia(stage: HTMLElement) {
  stage.style.width = "1160px";
  stage.style.height = "660px";
  const site = el("div", { class: "site", style: "position:absolute;inset:0" });
  site.append(
    el(
      "header",
      {},
      el("b", {}, "SEQUOIA"),
      el("span", {}, "Raids"),
      el("span", {}, "Wars"),
      el("span", { style: "color:#f3d06a" }, "The Grove"),
      el("span", {}, "Members"),
    ),
  );
  const canvas = el("canvas", { style: "position:absolute;left:0;top:60px;width:960px;height:600px" });
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = must(canvas.getContext("2d"), "a 2D canvas");
  drawGrove(
    context,
    {
      time: "night",
      tree: ANCIENT,
      campfire: true,
      lights: [{ x: 120, y: 70 }],
      decorations: [],
      creatures: [
        { creature: creature("stag"), x: 196 },
        { creature: creature("glimmerwing"), x: 70 },
      ],
    },
    40,
  );
  // Every member who watered this week hangs a light on the guild's tree.
  context.fillStyle = "#f3d06a";
  for (const [x, y] of [
    [97, 98],
    [104, 86],
    [134, 92],
    [141, 80],
    [110, 74],
    [128, 68],
    [116, 58],
    [123, 49],
    [100, 104],
    [146, 99],
    [119, 40],
    [131, 59],
  ] as const) {
    context.fillRect(x, y, 1, 1);
  }
  const goal = (label: string, have: number, want: number) =>
    el(
      "div",
      { class: "goal" },
      el(
        "div",
        { style: "display:flex;justify-content:space-between" },
        el("span", {}, label),
        el("b", {}, `${have.toLocaleString("en-GB")} / ${want.toLocaleString("en-GB")}`),
      ),
      el("div", { class: "bar" }, el("i", { style: `width:${Math.min(100, (have / want) * 100)}%` })),
    );
  site.append(
    canvas,
    el(
      "div",
      {
        class: "panel",
        style: "position:absolute;right:28px;top:96px;width:360px;display:flex;flex-direction:column;gap:14px",
      },
      el("h2", { style: "margin:0;font-size:28px" }, "The Great Sequoia"),
      el(
        "div",
        { style: "font-size:16px;color:#4a3140" },
        "The whole guild's tree. Every raid, war and watering this week helps it into bloom, and when it blooms, everyone gets the season's gift.",
      ),
      goal("Guild raids this week", 812, 1_000),
      goal("Wars won", 143, 150),
      goal("Trees watered", 2_310, 2_500),
      el(
        "div",
        { style: "display:flex;gap:10px;align-items:center;font-size:16px" },
        art(LANTERN, 4),
        el("span", {}, el("b", {}, "Season gift: "), "an autumn lantern for every member's grove"),
      ),
    ),
  );
  stage.append(site);
}

// ---------------------------------------------------------------- router ---

function render() {
  const name = location.hash.replace("#", "") || "grove";
  const screen = must(screens[name] ?? screens["grove"], "the grove screen");
  const stage = el("div", { class: "stage" });
  const fit = el("div", { class: "fit" }, stage);
  app.replaceChildren(fit);
  screen(stage, fitScale());
  // Screens wider than the window (a phone, or the Discord and website frames) shrink to fit.
  const width = stage.offsetWidth;
  const height = stage.offsetHeight;
  const room = Math.min(1, (innerWidth - 16) / width, (innerHeight - 16) / height);
  if (room < 1) {
    stage.style.transform = `scale(${room})`;
    stage.style.transformOrigin = "0 0";
    fit.style.width = `${width * room}px`;
    fit.style.height = `${height * room}px`;
  }
  document.body.dataset.ready = "1";
}

addEventListener("hashchange", render);
addEventListener("resize", render);
render();
