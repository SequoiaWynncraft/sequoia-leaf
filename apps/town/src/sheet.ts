/** A contact sheet of the art, for looking at it large while drawing it: open the page with `?sheet`. */

import { CREAM, GOLD, GREEN } from "@sequoia-leaf/kit/palette.ts";
import type { Body } from "@sequoia-leaf/kit/skin.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { KIND_NAMES, KINDS, THINGS } from "@sequoia-leaf/town/things.ts";

import { PETS } from "./camp.ts";
import { type CampArt, campIcon } from "./campart.ts";
import { paintBackdrop, paintGround, paintNear, paintTrunk } from "./ground.ts";
import { icon, type Sprite, type Sprites } from "./sprites.ts";
import { PLACES } from "./world.ts";

/** The art, with the members' figures (`bodies`) and the town's own in every picture (`folk`). */
export function showSheet(s: Sprites, bodies: readonly Body[], folk: readonly Sprite[]): void {
  const part = new URLSearchParams(location.search).get("sheet") ?? "";
  const zoom = part === "ground" || part === "sky" ? 2 : 4;
  const { c, g } = makeCanvas(part === "ground" ? 656 : part === "sky" ? 760 : 400, part === "ground" ? 480 : 300);
  g.fillStyle = GREEN[2];
  g.fillRect(0, 0, c.width, c.height);
  if (part === "ground") {
    g.fillStyle = "#b84d84";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(paintGround(), 0, 0);
    g.drawImage(paintNear(), 0, 270);
  } else if (part === "sky") {
    g.drawImage(paintBackdrop(), 0, 0);
    const t = paintTrunk(26, 240, 3, 120);
    g.drawImage(t.c, 300, 40);
    const u = paintTrunk(46, 280, 5, 100);
    g.drawImage(u.c, 480, 10);
  } else {
    let x = 4;
    let y = 4;
    let rowH = 0;
    const put = (sp: Sprite | HTMLCanvasElement): void => {
      const pic = sp instanceof HTMLCanvasElement ? sp : sp.c;
      if (x + pic.width > c.width - 4) {
        x = 4;
        y += rowH + 4;
        rowH = 0;
      }
      g.drawImage(pic, x, y);
      x += pic.width + 4;
      rowH = Math.max(rowH, pic.height);
    };
    const groups: (Sprite | HTMLCanvasElement)[] =
      part === "small"
        ? [
            s.post,
            s.pole,
            s.log,
            s.stump,
            s.bench,
            s.fireRing,
            s.barrel,
            s.crate,
            s.box,
            s.chest,
            s.chestOpen,
            s.pile,
            s.mushroom,
            s.mushlet,
            ...s.flowers,
            s.reeds,
            s.lily,
            s.lilyBloom,
            ...s.crab,
            s.bang,
            s.crown,
            s.mug,
            ...s.lanterns,
            ...s.bushes,
            ...s.rocks,
            ...s.ferns,
            s.signpost,
            ...PLACES.map((pl) => icon(pl.id)),
            s.shortLog,
            ...s.pieces,
            s.jar,
            ...bodies.flatMap((b) => b.frames.flat()),
            ...folk,
          ]
        : [s.treasury, s.counter, s.works, s.gate, s.board, ...s.stalls, s.tree, s.greatStump];
    for (const sp of groups) put(sp);
  }
  c.style.cssText = `position:fixed;left:0;top:0;width:${c.width * zoom}px;height:${c.height * zoom}px;image-rendering:pixelated;z-index:99`;
  document.body.append(c);
}

/**
 * Every camp thing with its name under it, kind by kind, three screen pixels to each of its own:
 * `?sheet=camp`. The pets and the cabin's roofs come last.
 */
export function showCampSheet(art: CampArt): void {
  const WIDE = 1400;
  const ZOOM = 3;
  const PAD = 14;
  interface Entry {
    pics: HTMLCanvasElement[];
    name: string;
    head?: true;
  }
  const entries: Entry[] = [];
  for (const kind of KINDS) {
    entries.push({ pics: [], name: KIND_NAMES[kind], head: true });
    for (const t of THINGS) {
      if (t.kind !== kind) continue;
      const ways = art.things[t.id] ?? [];
      // Each way round, and for the first way each state it can be in.
      const pics = ways.flatMap((way, i) => (i === 0 ? way.map((sp) => sp.c) : way.slice(0, 1).map((sp) => sp.c)));
      entries.push({ pics, name: t.name });
    }
  }
  entries.push({ pics: [], name: "Who lives there", head: true });
  for (const kind of PETS)
    for (let hue = 0; hue < (kind === "fox" ? 1 : 4); hue++) {
      const a = art.pets(kind, hue);
      const all = [...a.sit, ...a.walk, ...a.walkR.slice(0, 1), a.sleep, a.glad].flatMap((sp) => (sp ? [sp.c] : []));
      entries.push({ pics: all, name: hue === 0 ? kind : `${kind} ${hue + 1}` });
    }
  entries.push({ pics: [], name: "Cabins, and the camp's buttons", head: true });
  art.cabins.forEach((cabin, i) => entries.push({ pics: [cabin.c], name: `roof ${i + 1}` }));
  entries.push({
    pics: [
      campIcon("cabin"),
      campIcon("mailbox"),
      campIcon("signpost"),
      campIcon("town"),
      campIcon("home"),
      art.parcel.c,
    ],
    name: "buttons, and a parcel",
  });

  // Lay them out in rows, then draw.
  const probe = makeCanvas(8, 8).g;
  const placed: { e: Entry; x: number; y: number; w: number; h: number }[] = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const e of entries) {
    const picW = e.pics.reduce((n, p) => n + p.width * ZOOM + 6, 0);
    const picH = e.pics.reduce((n, p) => Math.max(n, p.height * ZOOM), 0);
    const w = Math.max(picW, widthOf(probe, e.name, e.head ? 2 : 1, e.head) + 8, 56);
    const h = e.head ? 30 : picH + 22;
    if (e.head || x + w > WIDE - PAD) {
      x = PAD;
      y += rowH + (e.head ? 22 : 12);
      rowH = 0;
    }
    placed.push({ e, x, y, w, h });
    if (e.head) {
      y += h;
      rowH = 0;
    } else {
      x += w + 14;
      rowH = Math.max(rowH, h);
    }
  }
  const { c, g } = makeCanvas(WIDE, y + rowH + PAD);
  g.fillStyle = GREEN[2];
  g.fillRect(0, 0, c.width, c.height);
  for (const p of placed) {
    if (p.e.head) {
      write(g, p.e.name, p.x, p.y + 4, { px: 2, bold: true, colour: GOLD[2] });
      continue;
    }
    let px = p.x;
    const tall = p.h - 22;
    for (const pic of p.e.pics) {
      g.drawImage(pic, px, p.y + tall - pic.height * ZOOM, pic.width * ZOOM, pic.height * ZOOM);
      px += pic.width * ZOOM + 6;
    }
    write(g, p.e.name, p.x, p.y + tall + 6, { px: 1, colour: CREAM });
  }
  c.style.cssText = `position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;image-rendering:pixelated;z-index:99`;
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
  document.body.style.height = `${c.height}px`;
  document.body.append(c);
  document.body.dataset.sheet = `${c.width}x${c.height}`;
  document.body.dataset.things = String(THINGS.length);
  document.body.dataset.undrawn = art.undrawn.join(" ");
}
