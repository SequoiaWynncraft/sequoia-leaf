/**
 * Run by `big.test.ts` in a Bun of its own with JSC's collector logging (`BUN_JSC_logGC=1`): reads a
 * yard, warms the tick up, then runs a thousand ticks between two forced collections. The second
 * collection's log line says how many bytes were allocated since the first (`ca=`, in KB).
 */
import * as F from "../src/index.ts";
import { makeLand } from "./land.ts";
import { landOf } from "./sides.ts";

const [file, cols = "7", rows = "7"] = process.argv.slice(2);
const y = F.decode(await Bun.file(file ?? "").text(), landOf(makeLand(Number(cols), Number(rows), 7)));
if (!y) throw new Error("the yard does not read");
for (let k = 0; k < 3000; k++) F.step(y);
const news = y.news.length;
console.error("WINDOW");
Bun.gc(true);
for (let k = 0; k < 1000; k++) F.step(y);
Bun.gc(true);
console.error(`DONE ${y.news.length - news}`);
