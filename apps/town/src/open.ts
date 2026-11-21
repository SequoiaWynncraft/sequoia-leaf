/**
 * The town's front door. Before anything is read or drawn it finds out where the game is being
 * played (the kit's `start()`): with the made-up guild the town opens as it always has; on the
 * guild's own server it first fetches the member's saves and what the town needs to know of them
 * (`live.ts`), and then opens. If the game will not open there, a card says why instead.
 *
 * The town itself (`main.ts`) is only loaded after that, because the moment it loads it reads
 * what the browser keeps.
 */

import { pull } from "@sequoia-leaf/kit/cloud.ts";
import { shutCard, start } from "@sequoia-leaf/kit/live.ts";

import { prepare } from "./live.ts";

async function open(): Promise<void> {
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  if (where.mode === "live" && !((await pull(["purse", "town"])) && (await prepare()))) {
    shutCard("closed", where.signIn);
    return;
  }
  await import("./main.ts");
}

void open();
