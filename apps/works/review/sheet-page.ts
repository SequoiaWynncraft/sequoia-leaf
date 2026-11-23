/**
 * The yard's art laid out with names (`sheets.ts`): the page's own entry with this file in place of
 * `src/main.ts`, built as the tour is (`tour.ts`) and opened with `?sheet=machines`, `?sheet=items`
 * or `?sheet=grades`.
 */
import { LAND } from "@sequoia-leaf/factory";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";

import { makeArt } from "../src/art/index.ts";
import { sheets } from "./sheets.ts";

await fontsReady();
sheets(makeArt(LAND), new URLSearchParams(location.search).get("sheet") ?? "");
