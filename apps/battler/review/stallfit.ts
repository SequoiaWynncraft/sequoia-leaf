/**
 * The stall's fit check: `bun review/stallfit.ts [<out-dir>] [desktop | phone | large]`. At 1280x760,
 * 390x844 and 1920x1080, where the unit is 3 pixels (or the size named), as a tour against a play server of its own (`tour.ts`), it starts a
 * run and has `window.fit` (`fit.ts`) put every figure of every era's catalogue on the stall, owned
 * and not, its level shown and not, held and not; prints every card where a word or a tab comes
 * within the frame's inset or lies over another, a trait's name is in another face than the small
 * one, a name is cut short without its card saying it whole, or a card is off the pixel grid; prints
 * which names were cut at each size; then has `window.fit.column()` look at the level's column on
 * that run (no chairs) and on an endless run with every chair, and prints every line that runs out
 * of the column or over another; and fails on any fault.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SIZES = [
  ["desktop", 1280, 760],
  ["phone", 390, 844],
  ["large", 1920, 1080],
] as const;
const given = process.argv.slice(2);
const out = resolve(given.find((a) => !SIZES.some(([n]) => n === a)) ?? join(tmpdir(), "raid-stallfit"));
mkdirSync(out, { recursive: true });

/** What `fit.check()` gives back, and `fit.column()`. */
interface Found {
  readonly cards: number;
  readonly faults: readonly string[];
  readonly cut: readonly string[];
}
interface Column {
  readonly looks: number;
  readonly faults: readonly string[];
}
const isFound = (v: unknown): v is Found =>
  typeof v === "object" && v !== null && "cards" in v && "faults" in v && Array.isArray(v.faults) && "cut" in v;
const isColumn = (v: unknown): v is Column =>
  typeof v === "object" && v !== null && "looks" in v && "faults" in v && Array.isArray(v.faults);

/** The level's column measured on the run on the table, and the run as it says itself. */
const COLUMN = "JSON.stringify(window.fit.column())";
/** An endless run deep enough for every chair a boss gives, its first pick taken. */
const ENDLESS_RUN =
  "(async () => { const r = window.raid; await r.endless('wilds', 47, 60); for (let i = 0; i < 4 && r.state().choice; i++) { await r.send({ do: 'choose', option: 0 }); await r.settled(); } return r.state().room; })()";

/** One size's tour: a run on the table, then every card measured, then the level's column on it and on an endless run. */
async function measure(name: string, w: number, h: number): Promise<{ found: Found; columns: Column[] } | null> {
  const steps = [
    ["size", w, h, 1],
    ["wait", 900],
    [
      "eval",
      "(async () => { const r = window.raid; await r.fresh(); r.hold(true); await r.start(11, 0); r.taught(); await r.settled(); return r.state().choice; })()",
    ],
    ["click", "[data-pick='0']"],
    ["eval", "window.raid.settled()"],
    ["move", 2, 2],
    ["eval", "JSON.stringify(window.fit.check())"],
    ["shot", `stallfit-${name}`],
    ["eval", COLUMN],
    ["eval", ENDLESS_RUN],
    ["eval", COLUMN],
    ["move", 3, 3],
    ["shot", `stallfit-${name}-chairs`],
  ];
  const path = join(out, `stallfit-${name}.json`);
  await Bun.write(path, JSON.stringify(steps));
  const tour = Bun.spawn(["bun", join(import.meta.dir, "tour.ts"), path, out], { stdout: "pipe", stderr: "inherit" });
  const said = await new Response(tour.stdout).text();
  await tour.exited;
  let found: Found | null = null;
  const columns: Column[] = [];
  for (const line of said.split("\n")) {
    try {
      const v: unknown = JSON.parse(line);
      const told: unknown = typeof v === "string" && v.startsWith("{") ? JSON.parse(v) : null;
      if (isFound(told)) found = told;
      else if (isColumn(told)) columns.push(told);
    } catch {
      // A line of the tour's own: a picture's path, or a staging's answer.
    }
  }
  if (found && columns.length === 2) return { found, columns };
  console.error(`${name}: the check gave nothing back:\n${said}`);
  return null;
}

let fits = true;
const named = SIZES.filter(([n]) => given.includes(n));
for (const [name, w, h] of named.length > 0 ? named : SIZES) {
  // oxlint-disable-next-line no-await-in-loop -- one browser and play server at a time
  const measured = await measure(name, w, h);
  if (!measured) {
    fits = false;
    continue;
  }
  const { found, columns } = measured;
  console.log(`\n${name} (${w}x${h}): ${found.cards} cards, ${found.faults.length} faults`);
  for (const f of found.faults) console.log(`  ${f}`);
  console.log(`  names cut short: ${found.cut.length > 0 ? found.cut.join(", ") : "none"}`);
  if (found.cards === 0 || found.faults.length > 0) fits = false;
  for (const [i, c] of columns.entries()) {
    console.log(
      `  the level's column, ${i === 0 ? "no chairs" : "every chair"}: ${c.looks} looks, ${c.faults.length} faults`,
    );
    for (const f of c.faults) console.log(`    ${f}`);
    if (c.looks === 0 || c.faults.length > 0) fits = false;
  }
}
console.log(`\n${fits ? "Every card and the level's column fit." : "Not everything fits."}`);
if (!fits) process.exit(1);
