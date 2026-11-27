/**
 * Plays members at one of the raid's sittings through Leaf's routes, as pages would with nobody
 * clever at them: each member plans each room as the raid's bot does (`planCommands`, its sensible
 * habit), takes the first figure left in a carousel when their turn comes, and Leaf's clock is moved
 * on to each deadline once everyone has done what they do before it. The tests drive the routes in
 * memory with it; `sittings-play.ts` drives the local play server.
 */
import { newTable, planCommands, type RunView, SENSIBLE, tableView } from "@sequoia-leaf/raid";
import { fields, Nonsense, readRunView } from "@sequoia-leaf/raid/save.ts";

/** How a driver reaches Leaf: a GET and a POST as a member's session, each answered with its JSON; and moving Leaf's clock to a moment. */
export interface Reach {
  readonly get: (path: string, session: string) => Promise<unknown>;
  readonly post: (path: string, body: unknown, session: string) => Promise<unknown>;
  /** Moves Leaf's clock on from `now` to `at`. */
  readonly to: (at: number, now: number) => Promise<void>;
}

/** A member at the sitting: their Leaf id and their session. */
export interface Seated {
  readonly player: string;
  readonly session: string;
}

/** What the driver reads of a sitting's answer. */
export interface Seen {
  readonly rev: number;
  readonly now: number;
  readonly at: string;
  readonly room: number;
  /** The stage's deadline (for `over`, when it ended). */
  readonly until: number;
  /** In a carousel: whose turns are open, and which places of the ring are still there. */
  readonly turns: readonly number[];
  readonly left: readonly number[];
  readonly taken: readonly number[];
  readonly you: number | null;
  readonly run: RunView | null;
}

const { record, whole, list } = fields;
const MOMENT = Number.MAX_SAFE_INTEGER;

/** A sitting's answer as the driver reads it; anything else stops it. */
export function seen(answer: unknown): Seen {
  try {
    const a = record(answer, "the answer");
    const state = record(a["state"], "the sitting");
    const stage = record(state["stage"], "the stage");
    const at = typeof stage["at"] === "string" ? stage["at"] : "";
    const ring = at === "carousel" ? list(stage["ring"], 32, "the ring").map((o) => record(o, "the ring")["by"]) : [];
    const turns = at === "carousel" ? list(stage["turns"], 8, "the turns").map((s) => whole(s, 0, 7, "a turn")) : [];
    const open = at === "carousel" ? whole(stage["open"], 0, 8, "the turns open") : 0;
    const until = at === "over" ? stage["ended"] : stage["until"];
    return {
      rev: whole(a["rev"], 0, MOMENT, "the rev"),
      now: Date.parse(typeof a["now"] === "string" ? a["now"] : ""),
      at,
      room: whole(state["room"], 0, 999, "the room"),
      until: whole(until, 0, MOMENT, "the deadline"),
      turns: turns.slice(0, open),
      left: ring.flatMap((by, i) => (by === null ? [i] : [])),
      taken: ring.flatMap((by) => (typeof by === "number" ? [by] : [])),
      you: state["you"] === null ? null : whole(state["you"], 0, 7, "your seat"),
      run: state["run"] === null ? null : readRunView(state["run"]),
    };
  } catch (err) {
    if (err instanceof Nonsense)
      throw new Error(`Not a sitting's answer (${err.message}): ${JSON.stringify(answer)}`, { cause: err });
    throw err;
  }
}

/** The page's view of a solo table the bot's planning is worked out on: only its run and its count of runs are read. */
const BLANK = tableView(newTable({ seed: 1, now: 0 }), { awards: [], now: 0 });

/** One member's turn at the sitting as it stands: their pick in a carousel, or their room planned. Gives back the sitting after. */
async function turn(reach: Reach, id: string, { player, session }: Seated, next: () => string): Promise<Seen> {
  const path = `/v1/game/sittings/${id}`;
  let now = seen(await reach.get(path, session));
  const send = async (commands: readonly object[]) =>
    seen(await reach.post(path, { player, commands: commands.map((c) => ({ id: next(), ...c })) }, session));
  const mine = now.you;
  if (now.at === "carousel" && mine !== null && now.turns.includes(mine) && !now.taken.includes(mine)) {
    const offer = now.left[0];
    if (offer !== undefined) now = await send([{ do: "pick", offer }]);
  }
  // A pick waiting is sent alone (what follows it is Leaf's to say), so planning is asked for again until it is done.
  for (let ask = 0; ask < 16 && now.at === "plan" && now.run?.stage.phase === "plan"; ask++) {
    const commands = planCommands({ ...BLANK, run: now.run, runs: now.rev }, SENSIBLE);
    if (commands.length === 0) break;
    // oxlint-disable-next-line no-await-in-loop -- each batch waits on Leaf's answer to the last
    now = await send(commands);
  }
  return now;
}

/**
 * Plays a started sitting to its end, or until `stop` says (once everyone has had their turn):
 * everyone's turn, then the clock to the next deadline, again and again. Gives back how many
 * deadlines it went through, and the sitting at its end as the last member is shown it.
 */
export async function playThrough(
  reach: Reach,
  id: string,
  members: readonly Seated[],
  { most = 1000, stop = () => false }: { readonly most?: number; readonly stop?: (now: Seen) => boolean } = {},
): Promise<{ readonly deadlines: number; readonly end: Seen }> {
  let n = 0;
  const next = () => `d-${id}-${++n}`;
  for (let deadline = 0; deadline < most; deadline++) {
    let last: Seen | undefined;
    for (const member of members) {
      // oxlint-disable-next-line no-await-in-loop -- one page after another, as people take turns
      last = await turn(reach, id, member, next);
    }
    if (last === undefined) throw new Error("Nobody at the sitting");
    if (last.at === "over" || stop(last)) return { deadlines: deadline, end: last };
    // oxlint-disable-next-line no-await-in-loop -- the clock moves once everyone has had their turn
    await reach.to(last.until, last.now);
  }
  throw new Error(`The sitting did not end in ${most} deadlines`);
}
