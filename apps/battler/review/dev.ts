/**
 * The table for the tours (`index.html` here): the page as it ships, and once it is open, the
 * handle for staging and looking at it from outside (`window.raid`, `handle.ts`). With `?sheet` it
 * shows every figure on one sheet instead (`sheet.ts`), which needs no table.
 */
import { fontsReady } from "@sequoia-leaf/kit/text.ts";

import { openHandle } from "./handle.ts";
import { showSheet } from "./sheet.ts";
import { openStandIn } from "./standin.ts";
import { openTablesHandle } from "./tables.ts";

if (new URLSearchParams(location.search).has("sheet")) {
  await fontsReady();
  showSheet();
} else {
  await (
    await import("../src/main.ts")
  ).booted;
  openHandle();
  openStandIn();
  openTablesHandle();
}
