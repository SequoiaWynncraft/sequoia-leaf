/**
 * The game's contract: what each of the game's routes answers, from the real routes, written by
 * `apps/api/test/game-contract.test.ts` (`WRITE_CONTRACTS=1`) one file a group, `game/<group>.json`,
 * so that two changes to different routes change different files. A group is the route's first
 * part after `/v1/game/` (`presence`, `sittings`), and a game's own for `/v1/game/play/{game}`
 * (`play-raid`, `play-works`). The game's tests read it as one record, every exchange by its name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folder of the contract's groups. */
export const GAME_CONTRACT = join(import.meta.dir, "game");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Each group's exchanges, by the group's name. */
export function gameContractGroups(): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {};
  const files = readdirSync(GAME_CONTRACT).filter((f) => f.endsWith(".json"));
  for (const file of files.toSorted()) {
    const read: unknown = JSON.parse(readFileSync(join(GAME_CONTRACT, file), "utf8"));
    if (!isRecord(read)) throw new Error(`contracts/game/${file} is not exchanges by name`);
    groups[file.slice(0, -".json".length)] = read;
  }
  return groups;
}

/** Every exchange of the contract, by its name. A name in two groups is a mistake in the files. */
export function gameContract(): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  for (const [group, exchanges] of Object.entries(gameContractGroups()))
    for (const [name, exchange] of Object.entries(exchanges)) {
      if (name in all) throw new Error(`contracts/game: ${name} is in two groups, one of them ${group}`);
      all[name] = exchange;
    }
  return all;
}
