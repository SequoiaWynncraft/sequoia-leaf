/**
 * Run by `budgets.test.ts`, once for each yard, in a Bun of its own with JSC's collector logging
 * (`BUN_JSC_logGC=1`) and its compiler on the main thread (`BUN_JSC_useConcurrentJIT=0`): reads a yard as `encode` keeps one, on the generator's land (`generated`) or
 * the guild's (`guild`), warms the tick up, then works in windows. Each is between `BEGIN name` and `END name
 * filled came`, and opened by a forced collection. Every collection the log shows in a window, young
 * or full, says how many bytes were allocated since the last (`ca=`, in KB); `filled` is how many
 * orders the window filled, `came` how many things the depot took in. Each window runs the tick
 * through `ticks`, which the warming has compiled already. One yard to a Bun: the compiler, set to
 * the shapes of one yard, compiles again for another's, and what it compiles it keeps in the
 * collector's heap, which a window would count as allocated.
 *
 * - `steady`: a thousand ticks, the plumbing worked out.
 * - `changed`: the first tick after the yard is changed: the plumbing worked out again.
 * - `repowered`: the first tick after power may have moved: power and the plumbing worked out again.
 * - `filled`: a tick in which a standing order is filled, if anything comes in to the depot.
 */
import * as F from "../src/index.ts";
import { makeLand } from "./land.ts";

const [file, on] = process.argv.slice(2);
const text = await Bun.file(file ?? "").text();
const y = F.decode(text, on === "generated" ? makeLand(7, 7, 7) : F.LAND);
if (!y) throw new Error("the yard does not read");
/** Runs the yard on `n` ticks. */
const ticks = (n: number): void => {
  for (let k = 0; k < n; k++) F.step(y);
};
const came = (): number => y.depot.reduce((a, b) => a + b, 0);
// Warmed up, and then through a few collections: the compiler throws code away at a collection and
// compiles it again, and what it compiles is counted as allocated, so a window that opens with a
// collection measures that until it has settled. `step` holds no loop of its own, so the compiler's
// last tier takes it up only after about 7,000 ticks. A tick that allocates allocates in every window.
ticks(3000);
for (let k = 0; k < 4; k++) {
  Bun.gc(true);
  ticks(3000);
}
let news = 0;
let depot = 0;

news = y.news.length;
depot = came();
console.error("BEGIN steady");
Bun.gc(true);
ticks(1000);
Bun.gc(true);
console.error(`END steady ${y.news.length - news} ${came() - depot}`);

F.changed(y);
news = y.news.length;
depot = came();
console.error("BEGIN changed");
Bun.gc(true);
ticks(1);
Bun.gc(true);
console.error(`END changed ${y.news.length - news} ${came() - depot}`);

y.powered = false;
F.changed(y);
news = y.news.length;
depot = came();
console.error("BEGIN repowered");
Bun.gc(true);
ticks(1);
Bun.gc(true);
console.error(`END repowered ${y.news.length - news} ${came() - depot}`);

// The next thing the depot takes in, found on a copy run on until something comes in; the first
// order on the board then wants one more of it than has come in, and nothing else.
const copy = F.decode(F.encode(y), y.land);
if (!copy) throw new Error("the yard does not copy");
let ahead = 0;
let next: F.Item | undefined;
for (; next === undefined && ahead < 600; ahead++) {
  const had = Float64Array.from(copy.depot);
  F.step(copy);
  next = F.ALL_ITEMS.find((n) => (copy.depot[n] ?? 0) > (had[n] ?? 0));
}
const order = y.board[0];
if (next !== undefined && order) {
  ticks(ahead - 1);
  order.want.fill(0);
  order.want[next] = (order.filled[next] ?? 0) + 1;
  news = y.news.length;
  depot = came();
  console.error("BEGIN filled");
  Bun.gc(true);
  ticks(1);
  Bun.gc(true);
  console.error(`END filled ${y.news.length - news} ${came() - depot}`);
}
