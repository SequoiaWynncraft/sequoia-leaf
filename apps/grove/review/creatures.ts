import { CREATURES } from "../src/art/creatures.ts";
import { RARITIES } from "../src/art/palette.ts";
import { toCanvas } from "../src/art/sprite.ts";
import { must } from "../src/must.ts";

const root = must(document.getElementById("root"), "the #root element");
for (const background of ["bg-cream", "bg-dusk"]) {
  const row = document.createElement("div");
  row.className = `row ${background}`;
  for (const creature of CREATURES) {
    for (const frame of creature.frames) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const rarity = must(
        RARITIES.find((r) => r.id === creature.rarity),
        creature.rarity,
      );
      cell.append(
        toCanvas(frame, 5),
        Object.assign(document.createElement("span"), { textContent: creature.name, style: `color:${rarity.color}` }),
      );
      row.append(cell);
    }
  }
  root.append(row);
}
