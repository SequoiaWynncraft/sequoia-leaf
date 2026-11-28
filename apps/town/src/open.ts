/**
 * The town's front door. Before anything is read or drawn it finds out who the member is (the
 * kit's `openLeaf`, which in a Discord call has Discord sign them in first), asks a member with no
 * Minecraft account linked to link one (`askToLink`), opens
 * their town and camp from Leaf (`leaf.ts`), and fetches what the town
 * needs to know of the guild (`live.ts`), from how far Leaf's town says their news has been told;
 * then it opens. Without Leaf there is no town: where it will not open, the kit's card says why.
 *
 * The town itself (`main.ts`) is only loaded after that, because the moment it loads it reads
 * what was fetched.
 */

import { openLeaf } from "@sequoia-leaf/kit/call.ts";
import { askToLink, serverCard, shutCard } from "@sequoia-leaf/kit/live.ts";
import { failedToOpen } from "@sequoia-leaf/kit/report.ts";

import { openCallLine } from "./callline.ts";
import { NEEDS_LEAF, openTown, town, troubleCard } from "./leaf.ts";
import { prepare } from "./live.ts";

async function open(): Promise<void> {
  const where = await openLeaf("town");
  if (where === null) return;
  if (where.mode === "shut") {
    shutCard(where.why);
    return;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return;
  }
  await askToLink(where);
  const trouble = await openTown(where.me.id, troubleCard);
  if (trouble) {
    failedToOpen(trouble);
    troubleCard(trouble);
    return;
  }
  if (!(await prepare(town().cursor))) {
    failedToOpen("closed");
    shutCard("closed");
    return;
  }
  await import("./main.ts");
  openCallLine();
}

void open();
