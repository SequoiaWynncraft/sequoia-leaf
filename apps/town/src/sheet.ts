/** A contact sheet of the art, for looking at it large while drawing it: open the page with `?sheet`. */

import { GREEN } from "@sequoia-leaf/kit/palette.ts";
import type { Body } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { paintBackdrop, paintGround, paintNear, paintTrunk } from "./ground.ts";
import { icon, type IconName, type Sprite, type Sprites } from "./sprites.ts";

export function showSheet(s: Sprites, bodies: readonly Body[]): void {
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
            ...(
              [
                "leaf",
                "coin",
                "treasury",
                "quests",
                "market",
                "works",
                "fire",
                "pond",
                "camp",
                "sound",
                "mute",
                "visit",
              ] as IconName[]
            ).map((n) => icon(n)),
            ...bodies.flatMap((b) => b.frames.flat()),
          ]
        : [s.treasury, s.counter, s.works, s.gate, s.board, ...s.stalls, s.tree];
    for (const sp of groups) put(sp);
  }
  c.style.cssText = `position:fixed;left:0;top:0;width:${c.width * zoom}px;height:${c.height * zoom}px;image-rendering:pixelated;z-index:99`;
  document.body.append(c);
}
