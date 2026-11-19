import { toCanvas } from "../src/art/sprite.ts";
import { TREE_STAGES } from "../src/art/tree.ts";
import { must } from "../src/must.ts";

const root = must(document.getElementById("root"), "the #root element");
for (const background of ["bg-cream", "bg-dusk"]) {
  const row = document.createElement("div");
  row.className = `row ${background}`;
  for (const stage of TREE_STAGES) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.append(toCanvas(stage.sprite, 4), Object.assign(document.createElement("span"), { textContent: stage.name }));
    row.append(cell);
  }
  root.append(row);
}
document.body.dataset.ready = "1";
