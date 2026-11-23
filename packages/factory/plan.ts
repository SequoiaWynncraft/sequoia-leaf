/**
 * The planner's table for every thing the slice can make: `bun plan.ts`. For each, what one machine
 * (or gatherer) at grade 1 makes a minute, and the line that feeds one flat out, every piece at
 * grade 1: how many of each piece, by what it makes, all the way down.
 */
import * as F from "./src/index.ts";

const name = (n: F.Item): string => F.ITEM_INFO[n]?.many ?? "";
const kind = (k: F.Kind): string => (F.KIND_INFO[k]?.name ?? "").toLowerCase();
const num = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ""));

const slice = F.create({ tier: 4 });
console.log("| thing | made by | a minute | the line that feeds one flat out |");
console.log("| --- | --- | ---: | --- |");
for (const n of F.makeableOn(
  F.LAND,
  slice.open,
  F.LAND.plots.map((p) => p.plot),
)) {
  const { kind: k, recipe } = F.makerOf(n);
  const often = F.makes(k, 1, recipe);
  const feeds = F.bill(F.tree(n, often)).map((b) => `${num(b.count)} ${kind(b.kind)} (${name(b.item)})`);
  console.log(`| ${name(n)} | ${kind(k)} | ${num(often)} | ${feeds.join(", ") || "-"} |`);
}
console.log(`\nA Study at grade 1 takes in ${num(F.makes(F.STUDY, 1, null))} folios a minute.`);
