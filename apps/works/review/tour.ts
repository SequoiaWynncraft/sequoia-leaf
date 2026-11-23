/**
 * The page with its handles (`handles.ts`) for working it from outside, as the screenshot tours do:
 * the page's own entry with this file in place of `src/main.ts`, built as
 *
 *     sed 's#./src/main.ts#./review/tour.ts#' index.html > tour.html
 *     bun build tour.html --outdir <site>/works-tour
 *
 * and opened at `/play/works-tour/tour.html` on the play server on this machine.
 */
import { page } from "../src/main.ts";
import { installHandles } from "./handles.ts";

const p = await page;
if (p) installHandles(p);
