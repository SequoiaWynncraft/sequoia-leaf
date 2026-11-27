/**
 * The raid's sittings in the game's contract (`game-contract.test.ts`): Alice opens one and Bob
 * finds it listed and sits; he may not start it, nor open another while he sits there; Alice's
 * page asks with the `rev` it has; she starts it, the regulars taking the empty seats; a sitting
 * that is not there; and her record, of two tables finished before.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import type { Effect } from "effect";
import type { SqlClient } from "effect/sql";

/** The contract's own call: a request recorded under `name`, as Alice unless another session is named. */
type Call = (name: string, method: string, path: string, body?: unknown, session?: string) => Promise<void>;

/** What the contract recorded of each call. */
type Recorded = Readonly<Record<string, { readonly body: unknown }>>;

type Query = (
  statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<unknown>, unknown>,
) => Promise<unknown>;

const idOf = (body: unknown): string => {
  const id = typeof body === "object" && body !== null ? Object.getOwnPropertyDescriptor(body, "id")?.value : undefined;
  if (typeof id !== "string") throw new Error("No sitting was opened");
  return id;
};

export async function sittingExchanges(
  call: Call,
  recorded: Recorded,
  query: Query,
  { alice, bob, now }: { readonly alice: PlayerId; readonly bob: PlayerId; readonly now: number },
): Promise<void> {
  await call("POST /v1/game/sittings", "POST", "/v1/game/sittings", { player: alice });
  const id = idOf(recorded["POST /v1/game/sittings"]?.body);
  const at = `/v1/game/sittings/${id}`;
  await call("GET /v1/game/sittings", "GET", "/v1/game/sittings", undefined, "bob-token");
  const sit = { player: bob, commands: [{ id: "s-1", do: "sit" }] };
  await call("POST /v1/game/sittings/{id}", "POST", at, sit, "bob-token");
  const start = { player: bob, commands: [{ id: "s-2", do: "start" }] };
  await call("POST /v1/game/sittings/{id}, a refusal", "POST", at, start, "bob-token");
  await call("POST /v1/game/sittings, seated elsewhere", "POST", "/v1/game/sittings", { player: bob }, "bob-token");
  await call("GET /v1/game/sittings/{id}, unchanged", "GET", `${at}?rev=1`);
  await call("POST /v1/game/sittings/{id}, started", "POST", at, {
    player: alice,
    commands: [{ id: "s-3", do: "start" }],
  });
  await call("GET /v1/game/sittings/{id}, no such sitting", "GET", "/v1/game/sittings/0123456789abcdef");
  for (const [sitting, place] of [
    ["0000000000000001", 1],
    ["0000000000000002", 5],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one after another
    await query(
      (sql) => sql`
        INSERT INTO raid_sitting_places (sitting, player_id, place, seats, ended)
        VALUES (${sitting}, ${alice}, ${place}, 8, ${now})
      `,
    );
  }
  await call("GET /v1/game/sittings/record", "GET", "/v1/game/sittings/record");
}
