// Review page: the atlas at 4x, and a 3x3 tiling of each tile so seams show.
import { atlasCanvas, ATLAS, CELL } from "./textures.ts";

const scale = Number(new URLSearchParams(location.search).get("s") ?? 3);
const out = document.createElement("canvas");
const per = ATLAS / CELL;
out.width = per * 16 * 3 + per * 4;
out.height = per * 16 * 3 + per * 4;
out.style.width = `${out.width * scale}px`;
const q = new URLSearchParams(location.search);
out.style.marginLeft = `${-Number(q.get("ox") ?? 0) * scale}px`;
out.style.marginTop = `${-Number(q.get("oy") ?? 0) * scale}px`;
const ctx = out.getContext("2d");
if (!ctx) throw new Error("no 2d");
ctx.fillStyle = "#3a2e40";
ctx.fillRect(0, 0, out.width, out.height);
for (let cy = 0; cy < per; cy++)
  for (let cx = 0; cx < per; cx++)
    for (let ty = 0; ty < 3; ty++)
      for (let tx = 0; tx < 3; tx++)
        ctx.drawImage(atlasCanvas, cx * CELL + 8, cy * CELL + 8, 16, 16, cx * 52 + tx * 16, cy * 52 + ty * 16, 16, 16);
document.body.appendChild(out);
