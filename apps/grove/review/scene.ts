import { CREATURES } from "../src/art/creatures.ts";
import { BIRDHOUSE, HOOK_POST, LANTERN, MUSHROOMS, WIND_CHIME } from "../src/art/items.ts";
import { ANCIENT } from "../src/art/tree.ts";
import { must } from "../src/must.ts";
import { drawGrove, HEIGHT, type TimeOfDay, WIDTH } from "../src/scene.ts";

const root = must(document.getElementById("root"), "the #root element");
root.style.cssText = "display:grid;grid-template-columns:repeat(2,auto);gap:12px;padding:12px;width:max-content";
const byId = (id: string) =>
  must(
    CREATURES.find((c) => c.id === id),
    `creature ${id}`,
  );
for (const time of ["golden", "day", "dusk", "night"] as TimeOfDay[]) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = `width:${WIDTH * 3}px;height:${HEIGHT * 3}px;image-rendering:pixelated`;
  const context = must(canvas.getContext("2d"), "a 2D canvas");
  drawGrove(
    context,
    {
      time,
      tree: ANCIENT,
      campfire: true,
      lights: [{ x: 167, y: 93 }],
      decorations: [
        { sprite: HOOK_POST, x: 160, y: 84 },
        { sprite: LANTERN, x: 163, y: 88 },
        { sprite: HOOK_POST, x: 74, y: 84 },
        { sprite: WIND_CHIME, x: 76, y: 88 },
        { sprite: MUSHROOMS, x: 178, y: 122 },
        { sprite: BIRDHOUSE, x: 206, y: 108 },
      ],
      creatures: [
        { creature: byId("mossling"), x: 62 },
        { creature: byId("fernfox"), x: 150 },
        { creature: byId("conelet"), x: 190 },
        { creature: byId("puffcap"), x: 84 },
      ],
    },
    40,
  );
  root.append(canvas);
}
