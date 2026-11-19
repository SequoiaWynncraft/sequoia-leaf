import { CREATURES } from "../src/art/creatures.ts";
import * as Items from "../src/art/items.ts";
import { toCanvas } from "../src/art/sprite.ts";
import { ANCIENT, ANCIENT_AUTUMN, TREE_STAGES } from "../src/art/tree.ts";
import { must } from "../src/must.ts";

const root = must(document.getElementById("root"), "the #root element");
const which = location.hash.slice(1);
const add = (sprite: Parameters<typeof toCanvas>[0], scale: number) => root.append(toCanvas(sprite, scale));
if (which === "growth") for (const stage of TREE_STAGES) add(stage.sprite, 4);
if (which === "seasons") {
  add(ANCIENT, 4);
  add(ANCIENT_AUTUMN, 4);
}
if (which === "cast") for (const c of CREATURES) add(c.frames[0], 6);
if (which === "items")
  for (const s of [
    Items.LEAF,
    Items.CONE_SHUT,
    Items.CONE_WARM,
    Items.CONE_OPEN,
    Items.CAMPFIRE[0],
    Items.WATERING_CAN,
    Items.SHEARS,
    Items.LANTERN,
    Items.MUSHROOMS,
    Items.BIRDHOUSE,
    Items.WIND_CHIME,
  ])
    add(s, 5);
