/**
 * The table for the tours (`index.html` here): the page as it ships, and once it is open, the
 * handle for staging and looking at it from outside (`window.raid`, `handle.ts`). With `?sheet` it
 * shows every figure on one sheet instead (`sheet.ts`), which needs no table; with `?sheet=hexes`,
 * every state of a hex on the board (`hexes.ts`). With `?steady`, what
 * moves by itself is recorded from the first script on, for the steadiness check (`shifts.ts`).
 */
import { fontsReady } from "@sequoia-leaf/kit/text.ts";

import { openGraid } from "./graid.ts";
import { openHandle } from "./handle.ts";
import { showHexes } from "./hexes.ts";
import { showSheet } from "./sheet.ts";
import { recordShifts } from "./shifts.ts";
import { openStandIn } from "./standin.ts";
import { openTablesHandle } from "./tables.ts";

const asked = new URLSearchParams(location.search);
if (asked.has("steady")) recordShifts();
if (asked.get("sheet") === "hexes") {
  await fontsReady();
  showHexes();
} else if (asked.has("sheet")) {
  await fontsReady();
  showSheet((asked.get("sheet") ?? "").split(",").filter(Boolean), Number(asked.get("zoom") ?? 3));
} else {
  await (
    await import("../src/main.ts")
  ).booted;
  openHandle();
  openStandIn();
  openTablesHandle();
  openGraid();
}
