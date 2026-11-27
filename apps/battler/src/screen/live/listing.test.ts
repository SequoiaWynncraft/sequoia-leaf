import { afterEach, beforeEach, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Reply, type Sent, type Standin, standin, until } from "@sequoia-leaf/kit/standin.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import type { Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { hearFresh } from "./heard.ts";
import { openLine } from "./line.ts";
import { followTables, knowTables, leave, readList, T } from "./listing.ts";
import { doneWithTable, liveLine, takeUp } from "./seated.ts";

const ME = { id: "leaf-0", name: "Mossback" };
const OTHER = { id: "leaf-9", name: "Sootpaw" };
const call = (now: number, player = ME): Call => ({ now, seed: 5 + now, player });
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const answer = (rev: number, t: Sitting, results: unknown[] = []) => ({
  id: "s1",
  rev,
  now: new Date(1000).toISOString(),
  state: wire(sittingView(t, ME.id)),
  results,
});
/** The id of the first command a request sent. */
const firstId = (sent: Sent): unknown => {
  const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
  return isRecord(commands[0]) ? commands[0].id : null;
};
function must(a: ReturnType<typeof command>): Sitting {
  if (!a.ok) throw new Error(a.why);
  return a.sitting;
}

let world: Standin | null = null;
// Each test starts with no table held, whatever ran before it in the process (test files share it).
beforeEach(() => doneWithTable());
afterEach(() => {
  doneWithTable();
  hearFresh();
  world?.done();
});

test("a list read answered after Leave is let go: the table just left is not followed again", async () => {
  const open = openSitting(call(0));
  const left = must(command(open, { do: "leave" }, call(5)));
  const lists: ((reply: Reply) => void)[] = [];
  world = standin({
    "GET /v1/game/sittings": () => new Promise<Reply>((reply) => lists.push(reply)),
    "GET /v1/game/sittings/s1": { status: 200, body: answer(1, open) },
    "POST /v1/game/sittings/s1": (sent) => ({ status: 200, body: answer(2, left, [{ id: firstId(sent), notes: [] }]) }),
  });
  knowTables(scope(), ME, () => undefined);
  // Two reads of the list on their way: the page opening, and the card's own.
  const first = readList();
  const second = readList();
  await until(() => lists.length >= 2, "both list reads to reach Leaf");
  lists[0]?.({ status: 200, body: { open: [], yours: "s1" } });
  await first;
  expect(liveLine()?.id).toBe("s1");
  await leave();
  expect(liveLine()).toBeNull();
  // The second read was asked before Leave: it says the member is still at s1, and is let go.
  lists[1]?.({ status: 200, body: { open: [], yours: "s1" } });
  await second;
  expect(liveLine()).toBeNull();
  expect(world.sent.filter((s) => s.method === "GET" && s.path === "/v1/game/sittings/s1")).toHaveLength(1);
});

test("a first list read Leaf did not answer is tried again on the kit's timer, with the card up or not", async () => {
  const open = openSitting(call(0));
  let asked = 0;
  world = standin({
    "GET /v1/game/sittings": () => {
      asked++;
      return asked === 1 ? { status: 503, body: null } : { status: 200, body: { open: [], yours: "s1" } };
    },
    "GET /v1/game/sittings/s1": { status: 200, body: answer(1, open) },
  });
  const held = scope();
  followTables(
    held,
    ME,
    () => undefined,
    () => false,
  );
  await until(() => liveLine() !== null, "the member's table to be followed");
  expect(asked).toBe(2);
  expect(liveLine()?.id).toBe("s1");
  held.close();
});

/**
 * The member's table, held in this tab, after they got up from it in another: somebody opened it,
 * the member sat (`sat`, which this tab holds), and the other tab left (`left`, which Leaf has).
 * Leave pressed here is answered `not_seated`, with the sitting as `shown`.
 */
async function leaveHereAfterThere(shown: "left" | "sat"): Promise<void> {
  const opened = openSitting(call(0, OTHER));
  const sat = must(command(opened, { do: "sit" }, call(10)));
  const left = must(command(sat, { do: "leave" }, call(20)));
  world = standin({
    "POST /v1/game/sittings/s1": (sent) => ({
      status: 200,
      body: answer(shown === "left" ? 3 : 2, shown === "left" ? left : sat, [
        { id: firstId(sent), refused: "not_seated", why: "You are not at that table." },
      ]),
    }),
  });
  knowTables(scope(), ME, () => undefined);
  const line = openLine(scope(), "s1", ME.id, answer(2, sat));
  if (!line) throw new Error("no line");
  takeUp(line);
  await leave();
}

test("a member's own table that did not read at first is read again on the kit's timer, so its strip comes back", async () => {
  const open = openSitting(call(0));
  let reads = 0;
  world = standin({
    "GET /v1/game/sittings": { status: 200, body: { open: [], yours: "s1" } },
    "GET /v1/game/sittings/s1": () => {
      reads++;
      return reads === 1 ? "offline" : { status: 200, body: answer(1, open) };
    },
  });
  const held = scope();
  followTables(
    held,
    ME,
    () => undefined,
    () => false,
  );
  await until(() => liveLine() !== null, "the member's table to be followed");
  expect(reads).toBe(2);
  expect(liveLine()?.id).toBe("s1");
  held.close();
});

test("left in the other tab, Leave here is answered with the member seatless: the table is let go, no complaint", async () => {
  await leaveHereAfterThere("left");
  expect(liveLine()).toBeNull();
  expect(T.why).toBeNull();
});

test("Leave answered not_seated lets the table go even while this tab's view still seats the member", async () => {
  await leaveHereAfterThere("sat");
  expect(liveLine()).toBeNull();
  expect(T.why).toBeNull();
});
