/**
 * The town's front door. Before anything is read or drawn it finds out who the member is (the
 * kit's `start()`), opens their town and camp from Leaf (`leaf.ts`), and fetches what the town
 * needs to know of the guild (`live.ts`), from how far Leaf's town says their news has been told;
 * then it opens. Without Leaf there is no town: where it will not open, the kit's card says why.
 *
 * The town itself (`main.ts`) is only loaded after that, because the moment it loads it reads
 * what was fetched.
 */

import { serverCard, shutCard, start, troubleCard } from "@sequoia-leaf/kit/live.ts";
import type { Trouble } from "@sequoia-leaf/kit/play.ts";

import { openTown, town } from "./leaf.ts";
import { prepare } from "./live.ts";

const NEEDS_LEAF = "The town needs the guild's server.";

async function open(): Promise<void> {
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return;
  }
  const card = (why: Trouble): void => troubleCard(why, where.signIn, NEEDS_LEAF);
  const trouble = await openTown(where.me.id, card);
  if (trouble) {
    card(trouble);
    return;
  }
  if (!(await prepare(town().cursor))) {
    shutCard("closed", where.signIn);
    return;
  }
  await import("./main.ts");
}

void open();
