/**
 * The review sheet (`?sheet`): every drawn thing side by side and enlarged, on the two grounds it
 * will stand on, so the art can be judged without playing to it.
 */
import { type Figure, drawFigure, type Face, type Pose } from "./figure.ts";
import { canvas, put, R, type Spr } from "./gfx.ts";
import { bannerArt, bench, board, fireArt, gears, home, pond, ROOFS, rug, shelf, signpost } from "./props.ts";
import { SHEET } from "./sprites.ts";

export function drawSheet(people: Figure[]): void {
  const Z = 4;
  const [c, g] = canvas(360, 330);
  R(g, 0, 0, 360, 330, "#2f5c34");
  R(g, 180, 0, 180, 330, "#3d2050");
  let x = 4;
  let y = 4;
  let row = 0;
  const place = (s: Spr): void => {
    if (x + s.w + 4 > 356) {
      x = 4;
      y += row + 5;
      row = 0;
    }
    put(g, s, x + s.ax, y + s.ay);
    x += s.w + 5;
    row = Math.max(row, s.h);
  };
  const b = bench();
  const f = fireArt();
  const big: Spr[] = [
    home("cabin", ROOFS.canvas!).shut,
    home("cabin", ROOFS.moss!).open,
    home("tent", ROOFS.coral!).shut,
    home("tent", ROOFS.sky!).open,
    board(),
    b.body,
    shelf(),
    signpost(),
    pond(),
    f.back,
    f.front,
    f.logN,
    rug(),
    ...gears(),
  ];
  big.forEach(place);
  for (const [, s] of SHEET) place(s);
  [0, 1, 2, 3].forEach((m) => {
    const bc = bannerArt(["#b84d84", "#3b7340", "#4a7fc0", "#d49045"][m]!, "#2a1733", m);
    g.drawImage(bc, x, y);
    x += 14;
  });
  x = 4;
  y += row + 8;
  const poses: [Face, Pose, boolean?][] = [
    ["down", "stand"],
    ["down", "walk"],
    ["up", "stand"],
    ["right", "walk"],
    ["left", "walk"],
    ["down", "stand", true],
    ["up", "wave", true],
    ["right", "cheer", true],
    ["down", "cheer"],
    ["down", "wave"],
    ["right", "cheer"],
  ];
  people.forEach((p, n) => {
    poses.forEach(([face, pose, sat], k) => {
      if (n > 0 && k > 3) return;
      if (x > 340) {
        x = 4;
        y += 38;
      }
      drawFigure(g, p, x + 10, y + 36, face, pose, 1.2, 0.1, sat ?? false);
      x += 22;
    });
  });
  const out = document.createElement("canvas");
  out.width = c.width * Z;
  out.height = c.height * Z;
  const og = out.getContext("2d")!;
  og.imageSmoothingEnabled = false;
  og.drawImage(c, 0, 0, out.width, out.height);
  out.style.cssText = "position:fixed;left:0;top:0;z-index:99";
  document.body.append(out);
}
