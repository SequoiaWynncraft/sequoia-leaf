/**
 * Staff CLI for editing a player's Works yard beside the running Leaf server:
 *
 *     bun apps/api/scripts/works-staff.ts <player id> by=<staff Leaf id> [dry] <one of>
 *       learn=<goal,goal>   plots=<plot,plot>   copy=<source player id>   code=<wb1...> at=<x,y> [turn=0-3] [replace]
 *       undo=<edit id> [force]   edits   export
 *
 * Edits go through the play service (`src/play/works-staff.ts`) with rev-guarded writes and log
 * the exact before-yard in `play_staff_edits`. Prints one JSON line.
 */
import { BunRuntime } from "@effect/platform-bun";
import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { isDir } from "@sequoia-leaf/factory";
import { Effect } from "effect";

import { Services } from "../src/app.ts";
import { PlayerNames } from "../src/game/names.ts";
import { editWorks, exportWorks, type WorksAction, worksEdits } from "../src/play/works-staff.ts";

const FLAGS = new Set(["dry", "replace", "force", "edits", "export"]);
const USAGE = [
  "bun apps/api/scripts/works-staff.ts <player id> by=<staff Leaf id> [dry] <one of>",
  "  learn=<goal,goal>   plots=<plot,plot>   copy=<source player id>   code=<wb1...> at=<x,y> [turn=0-3] [replace]",
  "  undo=<edit id> [force]   edits   export",
].join("\n");

type Parsed =
  | { readonly kind: "edits"; readonly player: PlayerId }
  | { readonly kind: "export"; readonly player: PlayerId }
  | {
      readonly kind: "edit";
      readonly player: PlayerId;
      readonly by: PlayerId;
      readonly dry: boolean;
      readonly action: WorksAction;
    };

function optionOf(args: readonly string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

function csvOf(raw: string): string[] | null {
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

function parseCodeAction(args: readonly string[], code: string): WorksAction | null {
  const atRaw = optionOf(args, "at");
  if (atRaw === undefined) return null;
  const parts = atRaw.split(",");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const turn = Number(optionOf(args, "turn") ?? 0);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isDir(turn)) return null;
  return { do: "code", code, x, y, turn, replace: args.includes("replace") };
}

function parseEditAction(args: readonly string[]): WorksAction | null {
  const learn = optionOf(args, "learn");
  const plots = optionOf(args, "plots");
  const copy = optionOf(args, "copy");
  const code = optionOf(args, "code");
  const undo = optionOf(args, "undo");
  const chosen = [learn, plots, copy, code, undo].filter((v) => v !== undefined);
  if (chosen.length !== 1) return null;
  if (learn !== undefined) {
    const goals = csvOf(learn);
    return goals ? { do: "learn", goals } : null;
  }
  if (plots !== undefined) {
    const list = csvOf(plots);
    return list ? { do: "plots", plots: list } : null;
  }
  if (copy !== undefined) {
    const source = parsePlayerId(copy);
    return source === undefined ? null : { do: "copy", source };
  }
  if (code !== undefined) return parseCodeAction(args, code);
  if (undo !== undefined) {
    const editId = Number(undo);
    return Number.isInteger(editId) && editId >= 1 ? { do: "undo", editId, force: args.includes("force") } : null;
  }
  return null;
}

export function parseCliArgs(args: readonly string[]): Parsed | null {
  const player = parsePlayerId(args.find((a) => !a.includes("=") && !FLAGS.has(a)) ?? "");
  if (player === undefined) return null;
  const isEdits = args.includes("edits");
  const isExport = args.includes("export");
  const hasEditOpt = ["learn", "plots", "copy", "code", "undo"].some((k) => optionOf(args, k) !== undefined);
  const modes = (isEdits ? 1 : 0) + (isExport ? 1 : 0) + (hasEditOpt ? 1 : 0);
  if (modes !== 1) return null;
  if (isEdits) return { kind: "edits", player };
  if (isExport) return { kind: "export", player };
  const by = parsePlayerId(optionOf(args, "by") ?? "");
  const action = parseEditAction(args);
  if (by === undefined || action === null) return null;
  return { kind: "edit", player, by, dry: args.includes("dry"), action };
}

const main = Effect.gen(function* () {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed === null) return yield* Effect.die(new Error(USAGE));
  if (parsed.kind === "edits") {
    console.log(JSON.stringify(yield* worksEdits(parsed.player)));
    return;
  }
  if (parsed.kind === "export") {
    console.log(JSON.stringify(yield* exportWorks(parsed.player)));
    return;
  }
  const name = (yield* (yield* PlayerNames).of([parsed.by])).get(parsed.by) ?? "Leaf's staff";
  const result = yield* editWorks(parsed.player, parsed.action, { id: parsed.by, name }, parsed.dry);
  console.log(JSON.stringify(result));
});

if (import.meta.main) {
  BunRuntime.runMain(main.pipe(Effect.provide(Services)));
}
