/**
 * The HUD, in the Sequoia mod's language: dark slate panels with one-pixel cut-corner borders, a lit top row and a
 * shaded bottom row; outlined Minecraft-font numerals; 16×16 icons in square slots; a segmented bar.
 * Everything is drawn on one canvas at art-pixel resolution and scaled up by whole pixels.
 */
import { hex, RANKS, type Rgb, UI } from "./palette.ts";

type Icon = { rows: string[]; pal: Record<string, string> };

/** Original 16×16 tool icons, drawn pixel by pixel. */
export const ICONS: Record<string, Icon> = {
  can: {
    rows: [
      "................",
      "......oooo......",
      ".....oLLLLo.....",
      "....oLo..oHo....",
      "....oo....oo.wW.",
      "..oooooooooo.ww.",
      ".oHHLLLLLLLo....",
      ".oHLLLLLLLCo..o.",
      ".oLLLLLLLLCooLLo",
      ".oLLLLLLLCCoLLo.",
      ".oLLLLLLCCCLLo..",
      ".oCLLLLLCCCCo...",
      ".oCCCCCCCCCDo...",
      ".oDDDDDDDDDDo...",
      "..oooooooooo....",
      "................",
    ],
    pal: { o: "#2a160e", L: "#c87444", H: "#eeb27a", C: "#9c5230", D: "#6e3420", w: "#8cc8f0", W: "#e8f6ff" },
  },
  shears: {
    rows: [
      "................",
      "..oo.........oo.",
      "..oSo.......oSo.",
      "...oSo.....oSso.",
      "....oSo...oSso..",
      ".....oSo.oSso...",
      "......oSoSso....",
      ".......oGso.....",
      "......oSoSo.....",
      ".....orooro.....",
      "....oRro.oRro...",
      "...oR.ro.oR.ro..",
      "...oR..o.oR..o..",
      "...oRrro.oRrro..",
      "....ooo...ooo...",
      "................",
    ],
    pal: { o: "#1c1418", S: "#e2e4ee", s: "#8e94a8", G: "#f2c044", R: "#b04a2c", r: "#6e2a1a" },
  },
  mister: {
    rows: [
      "................",
      "......oooooo....",
      "....ooPPPPPo....",
      "m..oWoPpppPo....",
      ".m..ooooPPoo....",
      "........oPPo....",
      "........oPPo....",
      ".......oooooo...",
      "......oGGGGGGo..",
      "......oGwwwwGo..",
      "......oGwWwwGo..",
      "......oGwwwwGo..",
      "......oGBBBBGo..",
      "......oGBBBBGo..",
      ".......oooooo...",
      "................",
    ],
    pal: { o: "#1c1624", P: "#a082dc", p: "#6a4aa8", W: "#e8f6ff", m: "#b4dcf0", G: "#d8eef4", w: "#7cc4dc", B: "#4a9ab8" },
  },
  leaf: {
    rows: [
      "......ooo.",
      "....ooHLLo",
      "...oHLLLGo",
      "..oHLLLGLo",
      "..oLLLGLLo",
      ".oLLLGLLo.",
      ".oLLGLLo..",
      ".oLGLoo...",
      ".oGoo.....",
      "o.........",
    ],
    pal: { o: "#10281a", L: "#58c47a", H: "#9ce6ae", G: "#2e7a48" },
  },
  cone: {
    rows: ["..oo..", ".oLDo.", "oLDLDo", "oDLDLo", "oLDLDo", ".oDLo.", "..oo.."],
    pal: { o: "#2a140c", L: "#c47a42", D: "#7a3e1e" },
  },
  drop: {
    rows: ["..o..", ".oWo.", "oWBBo", "oBBBo", ".ooo."],
    pal: { o: "#1a2a3a", W: "#e8f6ff", B: "#6cb4e4" },
  },
  dropEmpty: {
    rows: ["..o..", ".o.o.", "o...o", "o...o", ".ooo."],
    pal: { o: "#3a3a4e" },
  },
  insignia: {
    rows: ["..o..", ".oHo.", "oHBDo", ".oDo.", "..o.."],
    pal: { o: "#2a160c", H: "#f0b070", B: "#c8813c", D: "#8a5224" },
  },
};

const iconCache = new Map<string, HTMLCanvasElement>();
function iconCanvas(name: string): HTMLCanvasElement {
  const hit = iconCache.get(name);
  if (hit) return hit;
  const icon = ICONS[name];
  if (!icon) throw new Error(`no icon ${name}`);
  const c = document.createElement("canvas");
  c.width = icon.rows[0]?.length ?? 16;
  c.height = icon.rows.length;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d");
  icon.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const colour = icon.pal[ch];
      if (!colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  iconCache.set(name, c);
  return c;
}

const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Tooltip {
  name: string;
  rank: number;
  lore: string[];
  job: string;
  start: number;
  x: number;
  y: number;
}

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;
  scale = 3;
  w = 0;
  h = 0;
  state = { leaf: 12480, tool: 0, bloom: 0.6, charges: 4, level: 8, stage: "Mature", leafPop: 0 };
  tooltip: Tooltip | null = null;
  private slots: { x: number; y: number; s: number }[] = [];
  private fontReady = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "hud";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    this.ctx = ctx;
    this.scratch = document.createElement("canvas");
    this.scratch.width = 512;
    this.scratch.height = 32;
    const s = this.scratch.getContext("2d", { willReadFrequently: true });
    if (!s) throw new Error("no 2d");
    this.sctx = s;
    void document.fonts.load("10px Minecraft").then(() => {
      this.fontReady = true;
    });
  }

  get ready(): boolean {
    return this.fontReady;
  }

  resize(cssW: number, cssH: number): void {
    this.scale = cssW >= 1000 && cssH >= 640 ? 3 : 2;
    this.w = Math.ceil(cssW / this.scale);
    this.h = Math.ceil(cssH / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
  }

  /** Renders text as a crisp one-bit mask at 8 px, so the pixel font never blurs. */
  private mask(text: string, bold = false): { data: Uint8Array; w: number; h: number } {
    const s = this.sctx;
    s.clearRect(0, 0, this.scratch.width, this.scratch.height);
    s.font = `${bold ? "bold " : ""}10px Minecraft`;
    s.textBaseline = "top";
    s.fillStyle = "#fff";
    s.fillText(text, 1, 1);
    const w = Math.min(this.scratch.width, Math.ceil(s.measureText(text).width) + 3);
    const h = 14;
    const img = s.getImageData(0, 0, w, h);
    const data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = (img.data[i * 4 + 3] ?? 0) > 110 ? 1 : 0;
    return { data, w, h };
  }

  textWidth(text: string, size = 1): number {
    const m = this.mask(text);
    let max = 0;
    for (let x = 0; x < m.w; x++) for (let y = 0; y < m.h; y++) if (m.data[y * m.w + x]) max = x;
    return (max + 1) * size;
  }

  /** Draws text at art pixel (x, top). Outline draws all eight neighbours; shadow is the Minecraft drop shadow. */
  text(text: string, x: number, top: number, colour: Rgb, o: { size?: number; outline?: Rgb; shadow?: Rgb; bold?: boolean; alpha?: number } = {}): number {
    const size = o.size ?? 1;
    const m = this.mask(text, o.bold);
    const ctx = this.ctx;
    const a = o.alpha ?? 1;
    const at = (mx: number, my: number) => mx >= 0 && my >= 0 && mx < m.w && my < m.h && m.data[my * m.w + mx] === 1;
    const y0 = top - 1 * size;
    const plot = (c: Rgb, test: (mx: number, my: number) => boolean) => {
      ctx.fillStyle = css(c, a);
      for (let my = -1; my <= m.h; my++)
        for (let mx = -1; mx <= m.w; mx++) if (test(mx, my)) ctx.fillRect(x + (mx - 1) * size, y0 + my * size, size, size);
    };
    if (o.shadow) plot(o.shadow, (mx, my) => at(mx - 1, my - 1));
    if (o.outline) {
      const ol = o.outline;
      plot(ol, (mx, my) => !at(mx, my) && (at(mx - 1, my) || at(mx + 1, my) || at(mx, my - 1) || at(mx, my + 1) || at(mx - 1, my - 1) || at(mx + 1, my + 1) || at(mx - 1, my + 1) || at(mx + 1, my - 1)));
    }
    plot(colour, at);
    let max = 0;
    for (let mx = 0; mx < m.w; mx++) for (let my = 0; my < m.h; my++) if (m.data[my * m.w + mx]) max = mx;
    return max * size;
  }

  /** PixelArt.pixelPanel: fill, a cut-corner border, a lit inner top row, a shaded bottom row. */
  panel(x: number, y: number, w: number, h: number, accent: Rgb, fill = "rgba(40,40,55,0.94)"): void {
    const c = this.ctx;
    c.fillStyle = fill;
    c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = css(accent);
    c.fillRect(x + 1, y, w - 2, 1);
    c.fillRect(x + 1, y + h - 1, w - 2, 1);
    c.fillRect(x, y + 1, 1, h - 2);
    c.fillRect(x + w - 1, y + 1, 1, h - 2);
    c.fillStyle = css(accent, 0.42);
    c.fillRect(x + 1, y + 1, w - 2, 1);
    if (h >= 8) {
      c.fillStyle = css(accent, 0.16);
      c.fillRect(x + 1, y + 2, w - 2, 1);
    }
    c.fillStyle = css(mix(accent, [0, 0, 0], 0.6), 0.4);
    c.fillRect(x + 1, y + h - 2, w - 2, 1);
  }

  /** A segmented bar like the XP bar: dark outline with cut corners, sunken track, lit fill with notches. */
  bar(x: number, y: number, w: number, h: number, ratio: number, fill: Rgb, notches: number): void {
    const c = this.ctx;
    c.fillStyle = "rgba(8,6,12,0.85)";
    c.fillRect(x + 1, y, w - 2, h);
    c.fillRect(x, y + 1, w, h - 2);
    c.fillStyle = css(mix(fill, [20, 20, 30], 0.78));
    c.fillRect(x + 1, y + 1, w - 2, h - 2);
    const fw = Math.round((w - 2) * Math.max(0, Math.min(1, ratio)));
    if (fw > 0) {
      c.fillStyle = css(fill);
      c.fillRect(x + 1, y + 1, fw, h - 2);
      c.fillStyle = css(mix(fill, [255, 255, 255], 0.45));
      c.fillRect(x + 1, y + 1, fw, 1);
      c.fillStyle = css(mix(fill, [0, 0, 0], 0.35));
      c.fillRect(x + 1, y + h - 2, fw, 1);
    }
    c.fillStyle = "rgba(8,6,12,0.55)";
    for (let i = 1; i < notches; i++) c.fillRect(x + 1 + Math.round(((w - 2) * i) / notches), y + 1, 1, h - 2);
  }

  icon(name: string, x: number, y: number, size = 1): void {
    const ic = iconCanvas(name);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(ic, x, y, ic.width * size, ic.height * size);
  }

  draw(time: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!this.fontReady) return;
    const W = this.w;
    const H = this.h;
    const green: Rgb = hex(UI.leaf);
    const outline: Rgb = [16, 30, 22];
    // Leaf balance, top right: a big outlined numeral and the pixel leaf glyph.
    const big = 2;
    const label = this.state.leaf.toLocaleString("en-US");
    const tw = this.textWidth(label, big);
    const pop = this.state.leafPop > 0 ? Math.round(Math.sin(Math.min(1, this.state.leafPop) * Math.PI) * 2) : 0;
    const lx = W - 8 - 22 - tw;
    this.text(label, lx, 8 - pop, green, { size: big, outline, bold: false });
    this.icon("leaf", W - 8 - 20, 7 - pop, 2);
    this.text("LEAF", W - 8 - 22 - this.textWidth("LEAF"), 27, mix(green, [255, 255, 255], 0.1), { shadow: [10, 20, 14] });

    // Stage, top left: level badge and stage name.
    const lvl = `${this.state.level}`;
    const bw = 18;
    this.panel(6, 6, bw, 18, hex(UI.leaf), "rgba(20,30,24,0.92)");
    const lw = this.textWidth(lvl, 1);
    this.text(lvl, 6 + Math.floor((bw - lw) / 2), 11, [230, 255, 236], { shadow: [10, 30, 16] });
    const narrow = W < 300;
    if (!narrow) this.text("SEQUOIA LEVEL", 28, 8, green, { shadow: [10, 20, 14] });
    this.text(this.state.stage, 28, narrow ? 11 : 17, [255, 255, 255], { shadow: [24, 20, 30] });

    // Hotbar: three tool slots, the selected one lifted with the Sequoia purple border.
    const slot = 22;
    const gap = 2;
    const n = 3;
    const hbW = n * slot + (n - 1) * gap;
    const hx = Math.floor((W - hbW) / 2);
    const hy = H - slot - 6;
    this.slots = [];
    const names = ["can", "shears", "mister"];
    for (let i = 0; i < n; i++) {
      const sx = hx + i * (slot + gap);
      const sel = i === this.state.tool;
      const sy = hy - (sel ? 2 : 0);
      this.panel(sx, sy, slot, slot, sel ? hex(UI.purpleHover) : [80, 80, 100], sel ? "rgba(52,40,78,0.95)" : "rgba(26,26,36,0.9)");
      this.icon(names[i] ?? "can", sx + 3, sy + 3);
      this.slots.push({ x: sx, y: sy, s: slot });
    }
    const tools = ["Watering can", "Shears", "Mister"];
    const tName = tools[this.state.tool] ?? "";
    this.text(tName, Math.floor(W / 2 - this.textWidth(tName) / 2), hy - 30, [255, 255, 255], { shadow: [30, 24, 40] });

    // Bloom: a segmented bar above the hotbar; care charges as droplets beside it.
    const barW = Math.max(hbW + 40, 110);
    const bx = Math.floor((W - barW) / 2);
    const by = hy - 9;
    const gold = hex(UI.gold);
    const pulse = this.state.bloom >= 1 ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
    this.bar(bx, by, barW, 5, this.state.bloom, mix(gold, [255, 240, 200], pulse * 0.5), 10);
    this.icon("cone", bx - 9, by - 1);
    this.text("BLOOM", bx, by - 10, gold, { shadow: [40, 28, 10] });
    for (let i = 0; i < 6; i++) this.icon(i < this.state.charges ? "drop" : "dropEmpty", bx + barW - 6 * 6 + i * 6, by - 8);

    // Tooltip card for a reveal.
    if (this.tooltip) this.drawTooltip(this.tooltip, time);
  }

  private drawTooltip(t: Tooltip, time: number): void {
    const age = time - t.start;
    if (age < 0) return;
    const rank = RANKS[t.rank] ?? RANKS[0];
    const rc = hex(rank.color);
    const lines = t.lore;
    const nameSize = 2;
    const nameW = this.textWidth(t.name, nameSize);
    const loreW = Math.max(...lines.map((l) => this.textWidth(l)), this.textWidth(t.job) + 12, 60);
    const w = Math.max(nameW, loreW) + 16;
    const h = 60 + lines.length * 10;
    // Pops in by whole pixels: a short grow, then holds.
    const grow = Math.min(1, age / 0.18);
    const cw = Math.max(6, Math.round(w * (0.6 + 0.4 * grow)));
    const ch = Math.max(6, Math.round(h * (0.6 + 0.4 * grow)));
    const x = Math.round(Math.min(this.w - cw - 4, Math.max(4, t.x - cw / 2)));
    const y = Math.round(Math.min(this.h - ch - 40, Math.max(32, t.y - ch)));
    const c = this.ctx;
    c.fillStyle = "rgba(8,4,14,0.5)";
    c.fillRect(x + 2, y + 2, cw, ch);
    this.panel(x, y, cw, ch, hex(UI.purple), "rgba(22,16,34,0.96)");
    // An inner border in the rank colour, Minecraft-tooltip style.
    c.fillStyle = css(rc, 0.55);
    c.fillRect(x + 2, y + 2, cw - 4, 1);
    c.fillStyle = css(rc, 0.3);
    c.fillRect(x + 2, y + ch - 3, cw - 4, 1);
    c.fillRect(x + 2, y + 3, 1, ch - 6);
    c.fillRect(x + cw - 3, y + 3, 1, ch - 6);
    if (grow < 1) return;
    const tx = x + 8;
    let ty = y + 7;
    this.text(t.name, tx, ty, rc, { size: nameSize, shadow: mix(rc, [0, 0, 0], 0.75) });
    ty += 20;
    this.icon("insignia", tx, ty);
    this.text(rank.name, tx + 8, ty, rc, { shadow: mix(rc, [0, 0, 0], 0.75) });
    const kind = "Forest spirit";
    this.text(kind, x + cw - 8 - this.textWidth(kind), ty, [150, 150, 170], { shadow: [20, 16, 28] });
    ty += 13;
    for (const line of lines) {
      this.text(line, tx, ty, hex(UI.lore), { shadow: [30, 20, 44] });
      ty += 10;
    }
    ty += 3;
    this.icon("leaf", tx, ty - 1);
    this.text(t.job, tx + 13, ty, hex(UI.leaf), { shadow: [10, 24, 16] });
    // A twinkle on the card's corner.
    const tw = Math.sin(time * 4) > 0;
    c.fillStyle = css([255, 246, 210], tw ? 1 : 0.5);
    c.fillRect(x + cw - 6, y + 5, 1, 3);
    c.fillRect(x + cw - 7, y + 6, 3, 1);
  }

  /** Which hotbar slot, if any, is under a CSS-pixel point. */
  hit(cssX: number, cssY: number): number {
    const ax = cssX / this.scale;
    const ay = cssY / this.scale;
    return this.slots.findIndex((s) => ax >= s.x && ax < s.x + s.s && ay >= s.y && ay < s.y + s.s + 2);
  }
}
