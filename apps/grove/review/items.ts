import * as Items from "../src/art/items.ts";
import { toCanvas } from "../src/art/sprite.ts";
import { must } from "../src/must.ts";

const root = must(document.getElementById("root"), "the #root element");
const list = [
  ["Leaf", Items.LEAF],
  ["Cone", Items.CONE_SHUT],
  ["Warming", Items.CONE_WARM],
  ["Open", Items.CONE_OPEN],
  ["Campfire", Items.CAMPFIRE[0]],
  ["Campfire 2", Items.CAMPFIRE[1]],
  ["Watering can", Items.WATERING_CAN],
  ["Shears", Items.SHEARS],
  ["Lantern", Items.LANTERN],
  ["Mushrooms", Items.MUSHROOMS],
  ["Birdhouse", Items.BIRDHOUSE],
  ["Wind chime", Items.WIND_CHIME],
] as const;
for (const background of ["bg-cream", "bg-dusk"]) {
  const row = document.createElement("div");
  row.className = `row ${background}`;
  for (const [name, art] of list) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.append(toCanvas(art, 5), Object.assign(document.createElement("span"), { textContent: name }));
    row.append(cell);
  }
  root.append(row);
}
const stand = document.createElement("div");
stand.className = "row bg-cream";
stand.append(toCanvas(Items.STAND, 4));
root.append(stand);
