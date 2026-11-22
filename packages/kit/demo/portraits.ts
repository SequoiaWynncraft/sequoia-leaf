/**
 * The page to judge portraits on: six skins (those in `skins/` beside the page, then made-up ones),
 * each as the town's walking figure, as boxes at s 2, 3 and 5 in every pose, as its three cards
 * (animated), and as a key art for each finish.
 *
 * Skins are found from `skins/index.json` (a list of file names) if there is one, else
 * `skins/player.png` and `skins/1.png` to `skins/6.png`; `?skins=a.png,b.png` names them instead.
 * `window.portraits.at(t)` stops the clock at `t` seconds and draws the cards there; `play()` starts it.
 */
import { add, el } from "../src/dom.ts";
import { portrait, type Pose, POSES } from "../src/portrait.ts";
import { card, type Finish, FINISHES, keyArt } from "../src/pullart.ts";
import { bake, type Look, paintSkin } from "../src/skin.ts";
import { fontsReady } from "../src/text.ts";

declare global {
  interface Window {
    portraits?: { at(t: number): void; play(): void; ready: boolean };
  }
}

const SCALE = 2;
const sized = (c: HTMLCanvasElement): HTMLCanvasElement => {
  c.style.width = `${c.width * SCALE}px`;
  c.style.height = `${c.height * SCALE}px`;
  return c;
};

/** Made-up guild-mates, for when fewer than six skins are found. */
const MADE_UP: readonly (Look & { name: string; rank: string })[] = [
  {
    name: "Wrenly",
    rank: "Captain",
    skin: "#e8b48f",
    hair: "#5a3220",
    light: "#8a5a34",
    eye: "#2f5884",
    top: "#3b7340",
    legs: "#4a3a2a",
    shoes: "#2a1d14",
    style: "hood",
    sleeves: "long",
    detail: "scarf",
    trim: "#e67967",
  },
  {
    name: "Quillfeather",
    rank: "Chief",
    skin: "#c98e6b",
    hair: "#2a1d14",
    light: "#4a3326",
    eye: "#24482a",
    top: "#7a348a",
    legs: "#2f3a5a",
    shoes: "#1c1019",
    style: "cap",
    sleeves: "long",
    detail: "belt",
    trim: "#f5b95e",
  },
  {
    name: "Kestrelle",
    rank: "Strategist",
    skin: "#f2c9a0",
    hair: "#6e6d6d",
    light: "#e67967",
    eye: "#4b8c4a",
    top: "#6f3826",
    legs: "#3b2a20",
    shoes: "#1c1019",
    style: "ears",
    sleeves: "long",
    detail: "buttons",
    trim: "#ffd98a",
  },
  {
    name: "Fernwhistle",
    rank: "Recruit",
    skin: "#f0c8a8",
    hair: "#d49045",
    light: "#f5b95e",
    eye: "#2f5884",
    top: "#4a86a6",
    legs: "#593d29",
    shoes: "#3b1f19",
    style: "long",
    sleeves: "short",
    detail: "apron",
    trim: "#e6cf9c",
    glasses: true,
  },
  {
    name: "Larkspur",
    rank: "Recruiter",
    skin: "#8a5a3c",
    hair: "#1a0f1e",
    light: "#3d2050",
    eye: "#1a0f1e",
    top: "#e6cf9c",
    legs: "#2f5884",
    shoes: "#2a1519",
    style: "short",
    sleeves: "short",
    detail: "belt",
    trim: "#6f3826",
  },
  {
    name: "Thistlebee",
    rank: "Captain",
    skin: "#ffd9b8",
    hair: "#b84d84",
    light: "#e67967",
    eye: "#3d2050",
    top: "#2f5c34",
    legs: "#3d2050",
    shoes: "#1c1019",
    style: "long",
    sleeves: "long",
    detail: "scarf",
    trim: "#ffd98a",
  },
];
/** Names for the cards of skins found in `skins/`; never anybody's real one. */
const FOUND_NAMES = [
  ["Mossling", "Owner"],
  ["Brindlewick", "Chief"],
  ["Hollowmere", "Captain"],
  ["Corriwen", "Recruiter"],
  ["Pebblesworth", "Recruit"],
  ["Ashgrove", "Strategist"],
] as const;

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    img.addEventListener("load", () =>
      done(img.naturalWidth === 64 && (img.naturalHeight === 64 || img.naturalHeight === 32) ? img : null),
    );
    img.addEventListener("error", () => done(null));
    img.src = src;
  });
}

async function names(): Promise<string[]> {
  const asked = new URLSearchParams(location.search).get("skins");
  if (asked) return asked.split(",").filter((n) => n.length > 0);
  try {
    const res = await fetch("skins/index.json");
    if (res.ok) {
      const list: unknown = await res.json();
      if (Array.isArray(list)) return list.filter((n): n is string => typeof n === "string");
    }
  } catch {
    // No list: try the usual names.
  }
  return ["player.png", "1.png", "2.png", "3.png", "4.png", "5.png", "6.png"];
}

interface Entry {
  sheet: HTMLImageElement | HTMLCanvasElement;
  name: string;
  rank: string;
  from: string;
}

async function skins(): Promise<Entry[]> {
  const files = await names();
  const loaded = await Promise.all(files.map(async (f) => ({ f, img: await load(`skins/${f}`) })));
  const found: Entry[] = [];
  for (const { f, img } of loaded) {
    if (!img || found.length >= 6) continue;
    const [name, rank] = FOUND_NAMES[found.length] ?? ["Mossling", "Owner"];
    found.push({ sheet: img, name, rank, from: `skins/${f}` });
  }
  for (const look of MADE_UP) {
    if (found.length >= 6) break;
    found.push({ sheet: paintSkin(look), name: look.name, rank: look.rank, from: "made up" });
  }
  return found;
}

const label = (text: string): HTMLElement => el("span", "k-label", {}, text);

function poses(sheet: Entry["sheet"], s: number): HTMLElement {
  return el(
    "div",
    "group",
    {},
    label(`s ${s}`),
    el("div", "poses", {}, ...POSES.map((pose: Pose) => sized(portrait(sheet, { s, pose })))),
  );
}

interface Live {
  g: CanvasRenderingContext2D;
  sheet: Entry["sheet"];
  name: string;
  rank: string;
  finish: Finish;
}
const live: Live[] = [];

function cards(e: Entry): HTMLElement {
  const row = el("div", "poses", {});
  for (const finish of FINISHES) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 88;
    sized(c);
    const g = c.getContext("2d");
    if (g) live.push({ g, sheet: e.sheet, name: e.name, rank: e.rank, finish });
    add(row, c);
  }
  return el("div", "group", {}, label("cards"), row);
}

function drawCards(t: number): void {
  for (const l of live) {
    l.g.clearRect(0, 0, 64, 88);
    l.g.drawImage(card(l.sheet, { name: l.name, title: l.rank, finish: l.finish, t }), 0, 0);
  }
}

/** Each finish's key art shows another pose, so the three show what the poses look like large. */
const KEY_POSES: Readonly<Record<Finish, Pose>> = { leaf: "stand", lantern: "wave", aurora: "cheer" };

function section(e: Entry): HTMLElement {
  const walk = bake(e.sheet).frames[0]?.[0];
  return el(
    "section",
    "k-panel",
    {},
    el("header", "k-head", {}, el("h2", "k-title", {}, e.name), label(`${e.rank} · ${e.from}`)),
    el(
      "div",
      "k-body",
      {},
      el(
        "div",
        "strip",
        {},
        el("div", "group", {}, label("walking"), walk ? sized(walk) : ""),
        poses(e.sheet, 2),
        poses(e.sheet, 3),
      ),
      el("div", "strip", {}, poses(e.sheet, 5), cards(e)),
      el(
        "div",
        "strip",
        {},
        ...FINISHES.map((finish) =>
          el(
            "div",
            "group",
            {},
            label(`key art · ${finish} · ${KEY_POSES[finish]}`),
            sized(keyArt(e.sheet, { w: 240, h: 150, finish, pose: KEY_POSES[finish] })),
          ),
        ),
      ),
    ),
  );
}

async function main(): Promise<void> {
  await fontsReady();
  const list = await skins();
  const host = document.getElementById("skins");
  if (!host) return;
  for (const e of list) add(host, section(e));

  let clock = 0;
  let playing = true;
  let then = performance.now();
  const tick = (now: number): void => {
    if (playing) clock += Math.min(0.1, (now - then) / 1000);
    then = now;
    drawCards(clock);
    requestAnimationFrame(tick);
  };
  drawCards(0);
  requestAnimationFrame(tick);
  window.portraits = {
    at(t: number) {
      playing = false;
      clock = t;
      drawCards(t);
    },
    play() {
      playing = true;
    },
    ready: true,
  };
}

void main();
