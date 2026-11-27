/**
 * Plays a whole sitting of the raid against the local play server (`play.ts`), through its routes:
 * Tester opens one and starts it alone, the regulars taking the other seven seats; Tester plans
 * each room as the raid's bot does and takes the first figure left in each carousel
 * (`sittings-drive.ts`); and Leaf's clock is moved on to each deadline (`POST /test/play/sittings`).
 * It says, as JSON, how many deadlines the sitting went through and how long it took, Tester's
 * place and Coins before and after, their record, and the largest sitting stored on the way.
 *
 *   bun apps/api/test/play.ts <port> <public-dir> &
 *   bun apps/api/test/sittings-play.ts <port>
 */
import { playThrough, type Reach } from "./sittings-drive.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) throw new Error("Usage: bun apps/api/test/sittings-play.ts <port>");
const base = `http://127.0.0.1:${port}`;
/** Tester's session on the play server. */
const SESSION = "tester";

/** A field of a JSON object, or undefined when the value is not an object or lacks it. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;

async function answered(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`${response.status} ${response.url}: ${await response.text()}`);
  return response.json();
}
const headers = (session: string) => ({ Authorization: `Bearer ${session}`, "Content-Type": "application/json" });
const get = async (path: string, session: string) =>
  answered(await fetch(`${base}${path}`, { headers: headers(session) }));
const post = async (path: string, body: unknown, session: string) =>
  answered(await fetch(`${base}${path}`, { method: "POST", headers: headers(session), body: JSON.stringify(body) }));

let largest = 0;
/** Moves the play server's clock on, and keeps the largest sitting stored it says there is. */
async function later(ms: number): Promise<void> {
  const made = field(await post("/test/play/sittings", { stage: ms > 0 ? [{ later: ms }] : [] }, SESSION), "made");
  const bytes = field(made, "largest");
  if (typeof bytes === "number") largest = Math.max(largest, bytes);
}
const reach: Reach = { get, post, to: (at, now) => later(at - now) };

const me = await get("/v1/game/me", SESSION);
const player = String(field(field(me, "player"), "id"));
const coins = field(me, "coins");
const began = performance.now();
const id = String(field(await post("/v1/game/sittings", { player }, SESSION), "id"));
await post(`/v1/game/sittings/${id}`, { player, commands: [{ id: `start-${id}`, do: "start" }] }, SESSION);
const { deadlines, end } = await playThrough(reach, id, [{ player, session: SESSION }]);
const seconds = (performance.now() - began) / 1000;
await later(0);
const after = await get("/v1/game/me", SESSION);
const seats = field(field(await get(`/v1/game/sittings/${id}`, SESSION), "state"), "seats");
const place = Array.isArray(seats) ? field(seats[end.you ?? 0], "place") : null;
console.log(
  JSON.stringify(
    {
      sitting: id,
      deadlines,
      seconds: Math.round(seconds * 10) / 10,
      place,
      coins: { before: coins, after: field(after, "coins") },
      record: await get("/v1/game/sittings/record", SESSION),
      largest_bytes: largest,
    },
    null,
    2,
  ),
);
