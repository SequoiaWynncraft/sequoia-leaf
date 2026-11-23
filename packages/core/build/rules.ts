/**
 * The version of each game's rules (`rulesVersions`), read from the files in this repository as a
 * page is built and as Leaf starts: a Bun macro, so that what it gives is written into what imports
 * it, `import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" }`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GameId } from "../src/play.ts";
import { rulesVersions as versionsOf } from "../src/version.ts";

/** The repository's root, two folders over this one's package. */
const ROOT = join(import.meta.dir, "..", "..", "..");

function read(path: string): string | null {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return null;
  }
}

export const rulesVersions = (): Readonly<Record<GameId, string>> => versionsOf(read);
