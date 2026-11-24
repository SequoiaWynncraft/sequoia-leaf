/**
 * The town's front door. Before anything is read or drawn it finds out who the member is (the
 * kit's `start()`), opens their town and camp from Leaf (`leaf.ts`), and fetches what the town
 * needs to know of the guild (`live.ts`), from how far Leaf's town says their news has been told;
 * then it opens. Without Leaf there is no town: where it will not open, the kit's card says why.
 *
 * The town itself (`main.ts`) is only loaded after that, because the moment it loads it reads
 * what was fetched.
 */

import { serverCard, shutCard, start } from "@sequoia-leaf/kit/live.ts";
import { failedToOpen, watchPage } from "@sequoia-leaf/kit/report.ts";

import { NEEDS_LEAF, openTown, town, troubleCard } from "./leaf.ts";
import { prepare } from "./live.ts";

async function open(): Promise<void> {
  watchPage("town");
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return;
  }
  const trouble = await openTown(where.me.id, troubleCard);
  if (trouble) {
    failedToOpen(trouble);
    troubleCard(trouble);
    return;
  }
  if (!(await prepare(town().cursor))) {
    failedToOpen("closed");
    shutCard("closed", where.signIn);
    return;
  }
  await import("./main.ts");
}

void open();
