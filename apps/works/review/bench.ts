/**
 * The page with a yard of its own, for timing a frame of a yard larger than the guild's land holds
 * (`works.bench`): the rules' generator (`packages/factory/test/gen.ts`) builds it with commands, on a
 * land of 3 by 3 plots up to about 1,500 pieces and of 7 by 7 above, and it is run 3,000 ticks, as
 * the rules' own bench keeps one. Nothing is opened from Leaf (`S.alone`).
 *
 * It is the page's own entry with this file in place of `src/main.ts`, served by the play server
 * on this machine like the page (see the README's "How long a frame takes"):
 *
 *     sed 's#./src/main.ts#./review/bench.ts#' index.html > bench.html
 *     bun build bench.html --outdir <site>/works-bench
 *
 * and opened at `/play/works-bench/bench.html?pieces=5500`. Commands done there (`works.act`,
 * `works.after`) are done to that yard by the rules and sent nowhere; its member has Coins enough
 * for anything.
 */
import { step } from "@sequoia-leaf/factory";
import { generate } from "@sequoia-leaf/factory/test/gen.ts";
import { makeLand } from "@sequoia-leaf/factory/test/land.ts";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";

import { S } from "../src/state.ts";

const pieces = Number(new URLSearchParams(location.search).get("pieces") ?? 1000);
const plots = pieces > 1500 ? 7 : 3;
const made = generate(makeLand(plots, plots, 7), pieces);
for (let k = 0; k < 3000; k++) step(made.y);
S.world = made.y;
S.alone = true;
fromLeaf({ coins: 1_000_000_000, leaf: 0, version: 0 });
await import("../src/main.ts");
