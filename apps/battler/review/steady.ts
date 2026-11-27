/**
 * The steadiness check: `bun review/steady.ts [<out-dir>] [front | table] [desktop | phone | small |
 * narrow | mini | short | low | shortphone]`. It walks the raid's front page and the screens it opens,
 * and the table through planning and a fight, at 1280x760, 390x844, 640x480, 900x600, 360x640 and the
 * short windows 1366x420, 1280x480 and 390x600 (or the parts and sizes named), as a tour against a
 * play server of its own (`tour.ts`, on the tours' page with `?steady`, which records what moves:
 * `shifts.ts`), with Leaf's reads coming back late as over a real connection; prints every shift with
 * its score and the parts that moved, keeps them in `<out-dir>/shifts.json` beside a picture of each
 * moment, and fails on any shift at all: a part that moved by itself, the bottom panel's frame
 * changing size, or the stage fitted again (its zoom, or where the board is) while the window stayed
 * the same; and on the top bar's corner (help, settings, the front page) or either of the front
 * page's Leave the table not wholly in the window. The walk never scrolls but to bring a button into
 * view, so nothing it records is the member's own scrolling.
 *
 * The front page: the first paint, while Leaf's reads are out and once they are back, and drawn
 * again; each category and mode, the Wilds' two boards and a trail not open yet; the strip with no
 * run, the run in hand, an endless run and both; the Versus card with no tables, one opened by
 * another member, another sitting down, and the table started and gone; a live table opened and
 * left; the line that a room was taken and the rooms held coming in with the Deep Woods' card up;
 * Set out; and End this raid, asked and done, to the end page and back to the front page. The table:
 * see `tableWalk`, which ends at a live table: its tracker counting down, a player's board scouted by
 * the keyboard and by their row, back, and a stage's banner.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Shift } from "./shifts.ts";

const BY: ReadonlySet<unknown> = new Set(["browser", "page", "stage", "fit"]);
/** A shift as the page wrote it down. */
const isShift = (s: unknown): s is Shift =>
  typeof s === "object" &&
  s !== null &&
  "score" in s &&
  typeof s.score === "number" &&
  "by" in s &&
  BY.has(s.by) &&
  "input" in s &&
  typeof s.input === "boolean" &&
  "parts" in s &&
  Array.isArray(s.parts) &&
  s.parts.every((p) => typeof p === "string");

type Step = readonly (string | number)[];

/** The parts of the walk: the front page and what it opens, and the table while planning and fighting. */
type Part = "front" | "table";
const PARTS: readonly Part[] = ["front", "table"];
const given = process.argv.slice(2);
const only = PARTS.filter((p) => given.includes(p));
const walked = only.length > 0 ? only : PARTS;
/** The sizes named, if any (`SIZES`). */
const SIZE_NAMES: ReadonlySet<string> = new Set([
  "desktop",
  "phone",
  "small",
  "narrow",
  "mini",
  "short",
  "low",
  "shortphone",
]);
const out = resolve(
  given.find((a) => !PARTS.some((p) => p === a) && !SIZE_NAMES.has(a)) ?? join(tmpdir(), "raid-steady"),
);
mkdirSync(out, { recursive: true });

/** Leaf's reads, late by the start of their path: the rooms held and a member's events later still, to come in once a card is up. */
const SLOW = { "/v1/": 700, "/v1/game/raid/held": 4000, "/v1/me/events": 4000 };
/** The play server's other members, by their sessions there (`apps/api/test/play.ts`). */
const OTHERS = {
  birchwood: "7e570000-0000-4000-8000-000000000002",
  mossling: "7e570000-0000-4000-8000-000000000003",
  fernhollow: "7e570000-0000-4000-8000-000000000004",
} as const;

/** What a step of the walk says when it could not do what it was for: the walk fails on it rather than look steady. */
const FAIL = "steady:fail";
/** What has moved since the last one taken, under a name. */
const take = (at: string): Step => ["eval", `window.shifts.take(${JSON.stringify(at)})`];
/** Staging on the tours' handle (`r`), with the recorders held: a member reaches what is staged by another page. */
const staged = (code: string): Step => [
  "eval",
  `(async () => { const r = window.raid; window.shifts.hold(true); try { ${code} await r.settled(); } catch (e) { return "${FAIL} staging: " + e; } finally { window.shifts.hold(false); } return "staged"; })()`,
];
/** A button pressed as a member does, brought into the middle of its scroller first (clear of a foot held at its edge). */
const press = (selector: string, ms: number): Step[] => [
  ["eval", `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" }), "ok"`],
  ["wait", 150],
  ["click", selector],
  ["move", 2, 2],
  ["wait", ms],
];
/** The page loaded again, as a member opens it: Leaf's reads late, and `fake` answered here. */
const reload = (fake: Record<string, unknown> = {}): Step => [
  "eval",
  `(sessionStorage.setItem("shifts.slow", ${JSON.stringify(JSON.stringify(SLOW))}), sessionStorage.setItem("shifts.fake", ${JSON.stringify(JSON.stringify(fake))}), location.reload(), "loaded again")`,
];
/** Asks Leaf something as another member: `path` is an expression, the table opened kept in the tab. */
const asOther = (who: keyof typeof OTHERS, path: string, body: Record<string, unknown>): Step => [
  "eval",
  `(async () => { try { const res = await fetch(${path}, { method: "POST", credentials: "omit", headers: { Authorization: "Bearer as-${who}", "Content-Type": "application/json" }, body: JSON.stringify(${JSON.stringify({ player: OTHERS[who], ...body })}) }); const b = await res.json().catch(() => null); if (!res.ok) return "${FAIL} ${who} asked " + ${path} + ": " + res.status; if (${path} === "/v1/game/sittings" && typeof b?.id !== "string") return "${FAIL} ${who} opened no table"; if (typeof b?.id === "string") sessionStorage.setItem("steady.table", b.id); return res.status; } catch (e) { return "${FAIL} ${who} could not ask: " + e; } })()`,
];
const TABLE = "`/v1/game/sittings/${sessionStorage.getItem('steady.table')}`";
/** The open tables' list as Leaf gives it, with `n` on it: twelve are more than the Versus card holds. */
const tablesListed = (n: number) => ({
  now: "2026-11-27T12:00:00Z",
  yours: null,
  open: Array.from({ length: n }, (_, i) => ({
    id: `steady-${i}`,
    by: { name: `Member ${i + 1}` },
    sat: 1 + (i % 7),
    closes: "2026-11-27T12:30:00Z",
  })),
});
const TWELVE = tablesListed(12);
const OPTS = `document.querySelector("#modal .mode-opts")`;

/** A press on the table as a member makes it, then what moved, under a name. */
const tap = (selector: string, at: string, ms = 900): Step[] => [
  ["click", selector],
  ["move", 2, 2],
  ["wait", ms],
  take(at),
];
/** Something done on the table through the tours' handle (`r`), as the page's own commands do it; then what moved. */
const act = (code: string, at: string, ms = 900): Step[] => [
  ["eval", `(async () => { const r = window.raid; try { ${code} } catch (e) { return "${FAIL} " + e; } })()`],
  ["wait", ms],
  take(at),
];
/** Rerolls the stall `n` times as a member does, then takes what moved under a name. */
const rerolls = (at: string, n: number): Step[] => [
  ...Array.from({ length: n }, (): Step[] => [
    ["click", "#rustle"],
    ["move", 2, 2],
    ["wait", 450],
  ]).flat(),
  take(at),
];
/** What a member pulled, for a raid with their own figures: levels on the stall. */
const PULLED = { crab7: 3, worm: 1, moth: 2, emberkit: 1, slug: 4, kettle: 2, jay: 1, rock: 2, greg: 5 };
const onBoard = `r.party().find((x) => x.on === "board")`;
/**
 * The rack's checks, wherever it is: it covers no seat of the board, slot of the bench or player's
 * button (five points of each tried), folded or not, and with its panel open; a swipe in its box
 * scrolls the way the box does; and Enter on a tile pins its card with Melt on it.
 */
const RACK_CLEAR = `(() => {
  // A player's button counts where the list shows it: one scrolled out of the list is not on the page.
  const list = document.getElementById("live-players")?.getBoundingClientRect();
  const shownOf = (r) => { const x = Math.max(r.left, list.left), y = Math.max(r.top, list.top); return { x, y, w: Math.min(r.right, list.right) - x, h: Math.min(r.bottom, list.bottom) - y }; };
  const players = list ? [...document.querySelectorAll("#live-players button")].map((b) => shownOf(b.getBoundingClientRect())).filter((b) => b.w > 0 && b.h > 0) : [];
  const boxes = [...window.raid.tableBoxes(), ...players];
  const covered = [];
  for (const b of boxes) for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    const x = b.x + b.w * fx, y = b.y + b.h * fy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const e = document.elementFromPoint(x, y);
    if (!e || !e.closest("#rack, #rackbtn")) continue;
    // Covered only where, with the rack away, the seat (the table's own canvas, #view) or the button would show.
    const rack = document.getElementById("rack"), btn = document.getElementById("rackbtn");
    rack.style.visibility = "hidden"; btn.style.visibility = "hidden";
    const under = document.elementFromPoint(x, y);
    rack.style.visibility = ""; btn.style.visibility = "";
    if (under && (under.id === "view" || under.closest("#live-players button"))) covered.push(Math.round(x) + "," + Math.round(y) + " over " + (under.id || under.tagName) + " under " + (e.id || e.className));
  }
  const folded = document.body.classList.contains("rack-folded");
  const shown = document.querySelector(folded ? "#rackbtn" : "#rack").getBoundingClientRect();
  if (shown.width === 0) return "${FAIL} the rack is not shown";
  return covered.length ? "${FAIL} the rack covers " + covered.length + " points of the table: " + covered.slice(0, 6).join(" ") + (folded ? "; places: " + window.raid.foldReport().join(" | ") : "") : (folded ? "folded, clear" : "clear");
})()`;
const RACK_SWIPE = `(() => {
  const t = document.querySelector("#rack .made .item");
  if (!t) return "${FAIL} no tile in the rack's box";
  const want = document.body.classList.contains("rack-open") ? "pan-x" : "pan-y";
  const got = getComputedStyle(t).touchAction;
  return got === want ? "a swipe scrolls: " + got : "${FAIL} touch-action " + got + ", not " + want;
})()`;
const RACK_KEY_MELT = `(async () => {
  const t = document.querySelector("#rack .item[data-item]");
  if (!t) return "${FAIL} no tile to press";
  t.focus();
  t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
  await new Promise((go) => setTimeout(go, 400));
  const card = document.querySelector(".k-info.pinned");
  const melt = card && [...card.querySelectorAll("button")].find((b) => /^Melt/.test(b.textContent.trim()));
  window.raid.drop();
  return melt ? "Enter pins the card, with Melt" : "${FAIL} no Melt after Enter: " + (card ? card.innerText.replace(/\\s+/g, " ").slice(0, 80) : "no card pinned");
})()`;
const rackChecks = (where: string): Step[] => [
  ["eval", RACK_CLEAR],
  ["eval", `document.body.classList.contains("rack-folded") ? "folded" : "inline"`],
  [
    "eval",
    `(document.body.classList.contains("rack-folded") && document.getElementById("rackbtn").click(), "opened if folded")`,
  ],
  ["wait", 400],
  ["eval", RACK_CLEAR],
  ["eval", RACK_SWIPE],
  ["eval", RACK_KEY_MELT],
  ["eval", `(document.body.classList.contains("rack-open") && document.getElementById("rackbtn").click(), "closed")`],
  ["wait", 400],
  take(`the rack's checks: ${where}`),
];

/** A command sent as the page sends it, the step failing when it is refused (or held off) rather than look steady. */
const sent = (command: string): string =>
  `const d = await r.send(${command}); if (!d?.ok) throw new Error("refused: " + ${JSON.stringify(command)} + " " + JSON.stringify(d)); return JSON.stringify(d.notes.map((n) => n.t));`;

/** Whose board the live table shows, as the walk meant it (null: the member's own); else the walk fails here. */
const scoutingIs = (seat: number | null): Step => [
  "eval",
  `(() => { const s = JSON.parse(window.tables.state()).scouting; return s === ${seat} ? "scouting " + s : "${FAIL} scouting " + s + ", not ${seat}"; })()`,
];

/**
 * The table while planning, and on through a fight: buying, a star-up, selling, moving and swapping
 * figures, Buy XP to a level up, Hold, items handed over and forged; more than fifty rerolls on the
 * first room's board and fuller ones later, the purse crossing 10 and 100 both ways; a fight, its
 * takings and the next room; the chairs of an endless board; the Wilds' rules (`wildsWalk`); release
 * 1's feed target, Seqwawa and a tip (`releaseWalk`); and the stall with the member's own figures and
 * their levels.
 */
function tableWalk(shot: (what: string) => Step): Step[] {
  return [
    staged(
      `await r.fresh(); r.taught(); await r.start(11, 0); await r.plan(); await r.acorns(80); await r.offer(0, "moth"); await r.offer(1, "jay");`,
    ),
    ["wait", 1500],
    shot("20-table"),
    ...tap('[data-offer="0"]', "buy a figure"),
    ...tap('[data-offer="1"]', "buy another"),
    staged(`await r.give("worm"); await r.give("worm"); await r.offer(2, "worm");`),
    ["wait", 900],
    ...tap('[data-offer="2"]', "a star-up: three become one", 1500),
    shot("21-star-up"),
    ...act(sent(`{ do: "sell", from: { on: "bench", at: 0 } }`), "sell from the bench"),
    ...act(
      `const p = ${onBoard}; if (!p) throw new Error("nobody on the board"); ${sent(`{ do: "move", from: { on: "board", at: p.at }, to: { on: "bench", at: 8 } }`)}`,
      "a figure from the board to the bench",
    ),
    ...act(
      sent(`{ do: "move", from: { on: "bench", at: 8 }, to: { on: "bench", at: 1 } }`),
      "two on the bench change places",
    ),
    ...tap("#levelup", "Buy XP"),
    ...tap("#levelup", "Buy XP again, to a level up", 1500),
    ...tap("#holdbtn", "Hold the stall"),
    ...tap("#holdbtn", "let the stall go"),
    staged(`await r.item("thorn"); await r.item("plume"); await r.item("bark");`),
    ["wait", 900],
    ...act(
      `const p = r.party()[0]; if (!p) throw new Error("nobody to hand it to"); r.hand("thorn", p.id); await r.settled(); return "handed";`,
      "an item handed over",
    ),
    ...act(sent(`{ do: "forge", item: "plume", with: "bark" }`), "two components forged"),
    staged(
      `await r.items({ thorn: 30, plume: 21, glowcap: 12, bark: 9, chestnut: 7, blackthorn: 3, hoard: 2, lichen: 1, stump: 2, tongs: 1, whetstone: 1 });`,
    ),
    ["wait", 900],
    take("a deep rack staged"),
    ...rackChecks("a solo table"),
    shot("22-items"),
    staged(`await r.acorns(60);`),
    ...rerolls("reroll x12: the first room's board", 12),
    shot("23-rerolled"),
    staged(`await r.acorns(11);`),
    ...rerolls("reroll: the purse from 11 to 9", 2),
    ...act(`await r.acorns(10); return "10";`, "the purse from 9 to 10"),
    staged(`await r.acorns(101);`),
    ...rerolls("reroll: the purse from 101 to 99", 2),
    ...act(`await r.acorns(100); return "100";`, "the purse from 99 to 100"),
    ...tap("#setout", "set out: the fight starts", 1500),
    shot("24-fight"),
    ...act(`r.skip(60); return await r.settled();`, "the fight ends: the takings", 2500),
    shot("25-takings"),
    ...act(`return r.carry();`, "the next room", 2500),
    staged(`await r.bot(3); await r.plan(); await r.acorns(80);`),
    ["wait", 1500],
    ...rerolls("reroll x12: room 6, a fuller board", 12),
    shot("26-room-6"),
    staged(`await r.bot(4); await r.plan(); await r.acorns(100);`),
    ["wait", 1500],
    ...rerolls("reroll x12: room 10, fuller still", 12),
    shot("27-room-10"),
    staged(`await r.fresh(); r.taught(); await r.endless("wilds", 0); await r.plan();`),
    ["wait", 900],
    ...[9, 11, 14, 20].flatMap((chairs): Step[] => [
      // An endless board with this many chairs: the page's own copy, as no rule reaches 14 or 20 yet.
      staged(`r.copy().level = ${chairs}; r.redraw();`),
      ["wait", 600],
      take(`an endless board with ${chairs} chairs`),
      shot(`29-chairs-${chairs}`),
    ]),
    ...wildsWalk(shot),
    ...releaseWalk(shot),
    staged(
      `await r.fresh(); r.taught(); await r.pulled(${JSON.stringify(PULLED)}); await r.start(5, 0, true); await r.plan(); await r.acorns(60);`,
    ),
    ["wait", 1500],
    ...rerolls("reroll x12: the member's own figures, with levels", 12),
    shot("28-own"),
    // Seated at a live table, planning: its stall without Set out.
    staged(`await r.fresh(); r.taught(); r.to("front");`),
    ["wait", 900],
    ...press("#k-ways-to-play-versus", 1500),
    ...press("#live-open", 1500),
    ...press("#live-start", 2500),
    [
      "eval",
      `(async () => { try { window.tables.pick(); await window.tables.to("plan"); return await window.tables.plan(); } catch (e) { return "${FAIL} " + e; } })()`,
    ],
    ["wait", 2500],
    take("seated at a live table, planning"),
    shot("43-live-table"),
    // The tracker counts down (its seconds, and the bar under it): nothing else moves.
    ["wait", 2200],
    take("a live table: the tracker counting down"),
    // Scouting: the third player's board on the table by the keyboard, the second's by their row (in view at every size), and Space back.
    ["key", "3"],
    ["wait", 1200],
    scoutingIs(2),
    take("scouting a player by the keyboard"),
    shot("44-live-scouting"),
    ...tap('#live-players [data-seat="1"]', "scouting another player by their row", 1200),
    scoutingIs(1),
    ["wait", 1500],
    take("scouting: the tracker still counting"),
    ["key", " "],
    ["wait", 900],
    scoutingIs(null),
    take("back to the member's own board"),
    // A deep rack at the live table: the page's own copy, as nothing stages a seat's rack.
    staged(
      `r.copy().rack = { thorn: 30, plume: 21, glowcap: 12, bark: 9, chestnut: 7, blackthorn: 3, hoard: 2, tongs: 1 }; r.redraw();`,
    ),
    ["wait", 900],
    take("a deep rack at the live table"),
    shot("45-live-rack"),
    ...rackChecks("a live table"),
    // The clock moved to the deadline: the fight's stage begins, with its banner.
    ["eval", `(async () => { try { return await window.tables.next(); } catch (e) { return "${FAIL} " + e; } })()`],
    ["wait", 300],
    take("a stage begins: its banner"),
    shot("46-live-banner"),
    ["wait", 1500],
    take("the banner gone, the fight playing"),
  ];
}

/**
 * The Wilds' rules: the pick after room 5's boss (two cards, one picked), planning under Stumps,
 * Narrow Table and Long Table, a fight under a rule with its line over the bench, its end and the
 * next room; and from the front page the card that picks the run back up, Watch it again and Carry on.
 */
function wildsWalk(shot: (what: string) => Step): Step[] {
  return [
    staged(`await r.fresh(); r.taught(); await r.endless("wilds", 4, 80); await r.bot(1);`),
    ["wait", 1500],
    take("the Wilds: the rule pick after the boss"),
    shot("30-rule-pick"),
    ...tap('#picks .pick[data-pick="0"]', "a rule picked", 1500),
    shot("31-rule-picked"),
    ...act(`return await r.rule("stumps");`, "planning under Stumps", 1500),
    shot("32-stumps"),
    ...act(`return await r.rule("narrow");`, "planning under Narrow Table", 1500),
    shot("33-narrow"),
    ...act(`return await r.rule("long");`, "planning under Long Table", 1500),
    shot("34-long"),
    staged(`for (let i = 0; i < 4 && r.state().choice; i++) await r.send({ do: "choose", option: 0 });`),
    ["wait", 900],
    ...tap("#setout", "a fight under Long Table: the rule's line", 1500),
    shot("35-rule-line"),
    ...act(`r.skip(60); return await r.settled();`, "the fight under the rule ends", 2500),
    ...act(`return r.carry();`, "the next room under the rule", 2500),
    ...act(`return r.to("front");`, "the front page with a run of the Wilds", 1500),
    ...press("#carryon-endless", 1200),
    take("the Wilds' return card"),
    shot("36-return-card"),
    ...press("#back-watch", 3000),
    take("Watch it again"),
    shot("37-watch-again"),
    ...act(`r.skip(60); return await r.settled();`, "watched to its end", 2500),
    ...act(`return r.to("front");`, "the front page again", 1500),
    ...press("#carryon-endless", 1200),
    ...press("#back-carry", 1500),
    take("Carry on from the return card"),
    shot("38-carried-on"),
  ];
}

/** Puts a figure of a kind on the bench onto the board, in the place of one already there (they change places). */
const fieldOne = (kind: string): string =>
  `{ const p = r.party(); const g = p.find((x) => x.kind === "${kind}" && x.on === "bench"); const q = p.find((x) => x.on === "board"); if (g && q) await r.send({ do: "move", from: { on: "bench", at: g.at }, to: { on: "board", at: q.at } }); }`;
/** Where a figure of a kind on the bench is on the page; and a point a share of the way across the stall. */
const benchFigure = (kind: string): string =>
  `(() => { const p = window.raid.party().find((x) => x.kind === "${kind}" && x.on === "bench"); return p ? window.raid.at(p.id) : null; })()`;
const overStall = (share: number): string =>
  `(() => { const s = document.getElementById("stall").getBoundingClientRect(); return { x: s.x + s.width * ${share}, y: s.y + s.height / 2 }; })()`;

/**
 * Release 1 on the table: a figure from the bench carried over the stall with a Greg fielded (the
 * stall split into Sell and Feed Greg, each half under the pointer, and the split gone once it is
 * put back), Seqwawa on the stall and on the board, and a tip opened over the stall.
 */
function releaseWalk(shot: (what: string) => Step): Step[] {
  return [
    staged(
      `await r.fresh(); r.taught(); await r.start(11, 0); await r.plan(); await r.acorns(80); await r.give("greg"); ${fieldOne("greg")} await r.give("worm");`,
    ),
    ["wait", 1500],
    take("planning with a Greg fielded"),
    ["downAt", benchFigure("worm")],
    ["moveAt", overStall(0.25)],
    ["wait", 700],
    take("a bench figure carried over the stall: Sell and Feed Greg"),
    shot("39-feed-split"),
    ["moveAt", overStall(0.75)],
    ["wait", 700],
    take("over Feed Greg"),
    ["moveAt", benchFigure("worm")],
    ["upAt", benchFigure("worm")],
    ["wait", 900],
    take("put back on the bench: the split goes"),
    staged(`await r.offer(0, "seqwawa");`),
    ["wait", 900],
    take("Seqwawa on the stall"),
    shot("40-seqwawa-stall"),
    staged(`await r.give("seqwawa"); ${fieldOne("seqwawa")}`),
    ["wait", 1200],
    take("Seqwawa on the board"),
    shot("41-seqwawa-board"),
    [
      "moveAt",
      `(() => { const b = document.getElementById("rustle").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
    ],
    ["wait", 1200],
    take("a tip opened over the stall"),
    shot("42-tip"),
    ["move", 2, 2],
    ["wait", 900],
    take("the tip goes"),
  ];
}

/** The walk at one size, its pictures named after it: the front page, the table, or both. */
function walk(name: string, w: number, h: number, parts: readonly Part[]): Step[] {
  const shot = (what: string): Step => ["shot", `${name}-${what}`];
  return [
    ["size", w, h],
    ["wait", 600],
    ...(parts.includes("front") ? frontWalk(shot) : []),
    ...(parts.includes("table") ? tableWalk(shot) : []),
  ];
}

/** The front page and the screens it opens. */
function frontWalk(shot: (what: string) => Step): Step[] {
  return [
    staged(
      `await r.fresh(); r.taught(); await r.woods({ woods: true }, { taken: { room: 17, by: 0 } }); await r.start(11, 0); await r.bot(1); await r.endless("wilds"); r.to("front");`,
    ),
    reload(),
    ["wait", 2600],
    shot("01-first-paint-loading"),
    ["wait", 5000],
    take("first paint, reads coming back"),
    shot("02-first-paint-loaded"),
    ["eval", `window.raid.page("almanac"), "almanac"`],
    ["wait", 700],
    ["eval", `window.raid.page(null), "front"`],
    ["wait", 1500],
    take("drawn again, everything read"),
    ...press("#k-ways-to-play-endless", 1800),
    take("Endless: the Wilds"),
    shot("03-wilds"),
    ...press("#k-deepest-room-week", 1800),
    take("the Wilds, This week"),
    shot("04-wilds-week"),
    ...press("#k-deepest-room-ever", 1200),
    take("the Wilds, Ever"),
    ...press("#mode-deep", 1800),
    take("the Deep Woods"),
    shot("05-deep"),
    ...press("#mode-endless", 1200),
    take("back to the Wilds"),
    ...press("#k-ways-to-play-versus", 2400),
    take("Versus: the record arriving"),
    shot("06-versus"),
    ...press("#k-ways-to-play-normal", 1200),
    take("back to Normal"),
    ...press("#trail-1", 1200),
    take("a trail not open yet"),
    shot("07-trail-closed"),
    ...press("#trail-0", 1200),
    take("back to the first trail"),
    staged(`await r.fresh(); r.taught(); r.to("front");`),
    ["wait", 1500],
    take("strip: no run"),
    shot("08-strip-none"),
    staged(`await r.start(11, 0); r.to("front");`),
    ["wait", 1500],
    take("strip: the run in hand"),
    shot("09-strip-run"),
    staged(`await r.fresh(); r.taught(); await r.endless("deep"); r.to("front");`),
    ["wait", 1500],
    take("strip: an endless run"),
    shot("10-strip-endless"),
    staged(`await r.start(11, 0); await r.bot(1); r.to("front");`),
    ["wait", 1500],
    take("strip: both"),
    shot("11-strip-both"),
    ...press("#k-ways-to-play-versus", 2600),
    take("Versus: no tables"),
    asOther("birchwood", `"/v1/game/sittings"`, {}),
    ["wait", 2600],
    take("Versus: a table opened by another member"),
    shot("12-versus-table"),
    asOther("mossling", TABLE, { commands: [{ id: "steady-1", do: "sit" }] }),
    ["wait", 2600],
    take("Versus: another member sits down"),
    asOther("birchwood", TABLE, { commands: [{ id: "steady-2", do: "start" }] }),
    ["wait", 2600],
    take("Versus: the table starts and is gone"),
    ...press("#live-open", 2200),
    take("a live table opened"),
    shot("13-live-open"),
    ...press("#live-leave", 2200),
    take("the live table left"),
    staged(
      `await r.fresh(); r.taught(); await r.endless("deep"); r.to("front"); await r.woods({ taken: { room: 18, by: 1 } });`,
    ),
    reload({ "/v1/game/raid/held": { rooms: [17, 19] } }),
    ["wait", 3000],
    ...press("#k-ways-to-play-endless", 300),
    ...press("#mode-deep", 4500),
    take("a room taken and the rooms held, coming in"),
    shot("14-taken-held"),
    ...press("#k-ways-to-play-normal", 1200),
    take("back to Normal, again"),
    ...press("#start", 2500),
    take("Set out: the table"),
    shot("15-set-out"),
    staged(`await r.bot(1); r.to("front");`),
    ["wait", 1500],
    take("the front page after a room"),
    ...press("#gohome", 1200),
    take("End this raid, asked"),
    shot("16-end-ask"),
    ...press("#endraid", 2500),
    take("the end page"),
    shot("17-end-page"),
    ["eval", `window.raid.to("front")`],
    ["wait", 1800],
    take("back to the front page"),
    shot("18-front-again"),
    // Two runs, the first with the longer line of the member's own figures, and ending the Deep Woods' asked.
    staged(
      `await r.fresh(); r.taught(); await r.pulled(${JSON.stringify(PULLED)}); await r.start(5, 0, true); await r.bot(1); await r.endless("deep", 2); r.to("front");`,
    ),
    ["wait", 1500],
    ...press("#gohome-endless", 1200),
    take("End this raid asked on the Deep Woods' row"),
    shot("19-end-ask-endless"),
    ...press("#keepplaying-endless", 1200),
    take("Keep playing"),
    reload({ "/v1/game/sittings": TWELVE }),
    ["wait", 3500],
    ...press("#k-ways-to-play-versus", 2600),
    take("Versus: twelve open tables"),
    shot("20-twelve-tables"),
    // The member scrolls down the list; a table opened elsewhere has it read again: the list keeps its place.
    [
      "eval",
      `(${OPTS}.scrollTop = 120, sessionStorage.setItem("steady.top", String(${OPTS}.scrollTop)), sessionStorage.setItem("shifts.fake", ${JSON.stringify(JSON.stringify({ "/v1/game/sittings": tablesListed(13) }))}), "scrolled to " + ${OPTS}.scrollTop)`,
    ],
    asOther("fernhollow", `"/v1/game/sittings"`, {}),
    ["wait", 3000],
    [
      "eval",
      `(() => { const n = document.querySelectorAll("#modal .live-list .board-row").length; const top = ${OPTS}.scrollTop; const was = Number(sessionStorage.getItem("steady.top")); return n === 13 && was > 0 && Math.abs(top - was) <= 1 ? "kept at " + top : "${FAIL} the list read again: " + n + " rows, scrolled to " + top + " from " + was; })()`,
    ],
    take("Versus: the list read again, scrolled down"),
    // A member who has pulled figures: the choice of whose figures on each card, and the boards' line for it.
    staged(`await r.fresh(); r.taught(); await r.pulled(${JSON.stringify(PULLED)}); r.to("front");`),
    ["wait", 1200],
    ...press("#k-ways-to-play-normal", 1200),
    take("Normal, for a member with figures"),
    ...press("#k-figures-own", 1500),
    take("the trails with your figures"),
    ...press("#k-ways-to-play-endless", 1500),
    take("Endless, for a member with figures: whose figures"),
    shot("21-wilds-own"),
    ...press("#mode-deep", 1800),
    take("the Deep Woods with your figures"),
    ...press("#k-figures-all", 1500),
    take("the Deep Woods with all figures"),
    ...press("#mode-endless", 1500),
    take("the Wilds with all figures"),
    ...press("#k-figures-own", 1500),
    take("the Wilds with your figures"),
    ...press("#k-ways-to-play-normal", 1200),
    take("back to Normal, the board's line held"),
    ...press("#k-ways-to-play-endless", 1200),
    take("Endless again"),
  ];
}

const SIZES = [
  ["desktop", 1280, 760],
  ["phone", 390, 844],
  ["small", 640, 480],
  ["narrow", 900, 600],
  ["mini", 360, 640],
  ["short", 1366, 420],
  ["low", 1280, 480],
  ["shortphone", 390, 600],
] as const;

/** What one size's walk recorded: each moment's shifts, by name, in order. */
async function run(name: string, w: number, h: number): Promise<{ moments: [string, Shift[]][]; ok: boolean }> {
  const steps = walk(name, w, h, walked);
  const path = join(out, `${name}.json`);
  await Bun.write(path, JSON.stringify(steps));
  const tour = Bun.spawn(["bun", join(import.meta.dir, "tour.ts"), path, out, "steady"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const said = await new Response(tour.stdout).text();
  const code = await tour.exited;
  const moments: [string, Shift[]][] = [];
  for (const line of said.split("\n")) {
    try {
      const v: unknown = JSON.parse(line);
      const m: unknown = typeof v === "string" && v.startsWith('{"at"') ? JSON.parse(v) : null;
      if (typeof m === "object" && m !== null && "at" in m && "shifts" in m && Array.isArray(m.shifts))
        moments.push([String(m.at), m.shifts.filter(isShift)]);
    } catch {
      // A line of the tour's own: a picture's path, or a staging's answer.
    }
  }
  const wanted = steps.filter((s) => s[0] === "eval" && String(s[1]).startsWith("window.shifts.take")).length;
  if (code !== 0 || moments.length !== wanted)
    console.error(`${name}: the walk stopped after ${moments.length} of ${wanted} moments (tour exited ${code}).`);
  const failed = said.split("\n").filter((line) => line.includes(FAIL));
  for (const line of failed) console.error(`${name}: a step was not done: ${line}`);
  return { moments, ok: code === 0 && moments.length === wanted && failed.length === 0 };
}

const report: Record<string, [string, Shift[]][]> = {};
let steady = true;
const named = SIZES.filter(([n]) => given.includes(n));
for (const [name, w, h] of named.length > 0 ? named : SIZES) {
  // oxlint-disable-next-line no-await-in-loop -- one browser and play server at a time, so timing is the page's own
  const { moments, ok } = await run(name, w, h);
  report[name] = moments;
  steady &&= ok;
  console.log(`\n${name} (${w}x${h})`);
  for (const [at, shifts] of moments) {
    const sum = shifts.reduce((a, s) => a + s.score, 0);
    console.log(`  ${sum > 0 ? "MOVED" : "  ok "} ${sum.toFixed(4).padStart(7)}  ${at}`);
    for (const s of shifts) {
      console.log(`      ${s.score.toFixed(4)} ${s.by}${s.input ? " (after a press)" : ""}`);
      for (const p of s.parts) console.log(`        ${p}`);
    }
    if (sum > 0) steady = false;
  }
}
await Bun.write(join(out, "shifts.json"), JSON.stringify(report, null, 2));
console.log(`\n${steady ? "Steady: nothing moved by itself." : "Not steady."} Pictures and shifts.json in ${out}`);
if (!steady) process.exit(1);
