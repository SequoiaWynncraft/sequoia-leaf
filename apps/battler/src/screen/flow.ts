/**
 * What happens when: sitting down to a run, setting out, the fight, counting out what the room
 * paid, and going on to the next room or to the end. Leaf and the rules do all the deciding; this
 * is the order things are shown in.
 */
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { leave, tell } from "@sequoia-leaf/kit/shell.ts";
import { type BossId, fightSetup, isBossId, type RaidNote, specOf, type TraitId, TRAITS } from "@sequoia-leaf/raid";

import { glyphPic } from "./art/icons.ts";
import { endFight, fightOn, setSpeed, skipFight, startFight } from "./fightview.ts";
import { clearFx, fly, forgetLater, later, say } from "./fx.ts";
import { BOARD_W } from "./geometry.ts";
import { planning, unpick } from "./hand.ts";
import type { Speed } from "./keep.ts";
import { cheer, clearPawns, pawns, syncPawns } from "./pawns.ts";
import { arrive, arrived, settleArrival, watchersCheer } from "./scene.ts";
import { signal } from "./signals.ts";
import { snd } from "./sounds.ts";
import { boardSpot, dress } from "./stage.ts";
import { ask, changed, doNow, prefsChanged, S } from "./state.ts";
import { acorns } from "./ui/cards.ts";
import { closeSheet, openSheet, sheetTaking, sheetUp } from "./ui/fightsheet.ts";
import { forgetTable, holdAcorns, renderTable, shown, wakeChip } from "./ui/table.ts";

const MIDDLE = { x: BOARD_W / 2, y: 64 };

/** Puts the table as the run has it: a run just begun, or one picked up again. */
export function enterRun(walkIn = true): void {
  const run = S.run;
  if (!run) return;
  unpick();
  closeSheet(false);
  forgetTable();
  clearPawns();
  clearFx();
  endFight();
  dress(S.looks.cloth, S.looks.lantern);
  syncPawns(run, true);
  if (run.phase === "fight") {
    S.mode = "fight";
    settleArrival(run);
    changed();
    playFight();
    return;
  }
  S.mode = "plan";
  if (walkIn) arrive(run);
  else settleArrival(run);
  changed();
}

/** Sets out on a trail: Leaf lays a new run out (putting down any run in hand), and the table shows it. Says whether it did. */
export async function startNew(trail: number): Promise<boolean> {
  const did = await ask({ do: "start", trail }, document.getElementById("start"));
  if (!did?.ok) return false;
  S.mode = "plan";
  enterRun();
  return true;
}

/**
 * Leaf's table moved on without this page (the member played on another page of the game): the
 * table shows it as Leaf has it. A fight on screen plays out first; its takings say the rest.
 */
export function rejoin(): void {
  if (S.mode === "fight" || S.mode === "after" || S.mode === "over") return;
  const run = S.run;
  if (!run || run.phase === "over") {
    if (S.mode === "plan") {
      S.mode = "front";
      changed();
    }
    return;
  }
  if (S.mode === "plan") enterRun(false);
}

/** Steps back from the board to the front page; the run is kept as it is. */
export function toFront(): void {
  if (S.mode === "fight" || S.mode === "after") return;
  unpick();
  closeSheet(false);
  S.mode = "front";
  changed();
}

/** Walks home early: the run ends here, and is still paid for the rooms it cleared. */
export async function goHome(): Promise<void> {
  if (!S.run || S.run.phase === "over") return;
  unpick();
  closeSheet(false);
  endFight();
  clearFx();
  const did = await ask({ do: "abandon" });
  if (!did?.ok) return;
  S.mode = "over";
  changed();
}

/** Leaves the table for the town. */
export function leaveTable(): void {
  leave();
}

export async function doRustle(): Promise<void> {
  if (!planning()) return;
  unpick();
  if ((await ask({ do: "rustle" }, document.getElementById("rustle")))?.ok) snd.rustle();
}
export function doHold(): void {
  if (!planning() || !S.run) return;
  const done = doNow({ do: "hold", on: !S.run.held });
  const note = done?.ok ? done.notes[0] : undefined;
  if (note?.t === "held") snd.hold(note.on);
}
export async function doLevelUp(): Promise<void> {
  if (!planning()) return;
  const done = await ask({ do: "xp" }, document.getElementById("levelup"));
  if (!done?.ok) return;
  if (done.notes.some((n) => n.t === "level")) {
    snd.level();
    const level = S.run?.level ?? 0;
    say(MIDDLE.x, MIDDLE.y + 30, `Level ${level}: field one more`, LEAF, { big: true, ttl: 1.4 });
  } else snd.xp();
}
export function doSpeed(s: Speed): void {
  S.prefs.speed = s;
  setSpeed(s);
  prefsChanged();
}

/** A trait has switched on while planning: its chip lights, its figures hop, and it says so. */
export function traitOn(trait: TraitId, step: number): void {
  const run = S.run;
  if (!run) return;
  snd.trait(step);
  cheer(run, trait);
  later(0, () => wakeChip(trait));
  say(MIDDLE.x, MIDDLE.y + 22, `${TRAITS[trait].name} is on${step > 1 ? `, step ${step}` : ""}`, GOLD[2], { ttl: 1.3 });
}

/** Sends the party in: Leaf locks both boards and decides the fight, and the table plays it. */
export async function setOut(): Promise<void> {
  if (!planning()) return;
  unpick();
  closeSheet(false);
  const begun = await ask({ do: "fight" }, document.getElementById("setout"));
  if (!begun?.ok || S.run?.phase !== "fight") return;
  S.mode = "fight";
  changed();
  playFight();
}

function playFight(): void {
  const run = S.run;
  const setup = run ? fightSetup(run) : null;
  if (!run || !setup) return;
  startFight(setup, S.prefs.speed, takings);
}

export function doSkip(): void {
  if (S.mode === "fight" && fightOn()) skipFight();
}

const WHY: Readonly<Record<string, string>> = {
  room: "The room",
  win: "For winning",
  interest: "Savings",
  gnomes: "The gnomes found",
  windfall: "Windfall",
};

/**
 * The fight is done: Leaf settles the room from the fight it decided, its sheet rises with the
 * tally, and what it paid is counted out where it can be seen, a line at a time on the sheet too.
 * The table waits on "Carry on".
 */
function takings(): void {
  const run = S.run;
  if (!run || run.phase !== "fight") return;
  const boss = run.foe.figures.map((p) => p.kind).find(isBossId);
  const room = run.room;
  shown.resolve = run.resolve;
  shown.xp = run.xp;
  shown.level = run.level;
  holdAcorns(run.acorns, 9);
  S.mode = "after";
  void taken(boss, room);
}

/** Asks Leaf to settle the room, and counts out what it paid. */
async function taken(boss: BossId | undefined, room: number): Promise<void> {
  const did = await ask({ do: "take" });
  if (did?.ok) {
    counting(did.notes, boss, room);
    return;
  }
  // Taken already, on another page: the table goes on as Leaf has it.
  shown.resolve = null;
  shown.xp = null;
  shown.level = null;
  shown.acorns = null;
  endFight();
  if (S.run && S.run.phase !== "over") enterRun(false);
  else {
    S.mode = "front";
    changed();
  }
}

/** Leaf has settled the room: its sheet rises, and what it paid is counted out. */
function counting(notes: readonly RaidNote[], boss: BossId | undefined, room: number): void {
  signal("fought");
  openSheet("after");
  const result = notes.find((n) => n.t === "result");
  const won = result?.t === "result" && result.result === "win";
  // The run has moved on by now: it may be over.
  const over = S.run?.phase === "over";
  if (over && S.run?.won)
    tell({ town: "news", text: "A little raid cleared: The Crab Nobody Counted has been counted.", tone: "gold" });
  else if (won && boss)
    tell({ town: "news", text: `${specOf(boss).name} was seen off at the stump, room ${room + 1}.`, tone: "gold" });
  let t = 0.1;
  const levels = notes.some((n) => n.t === "level");
  for (const note of notes) t = count(note, t, levels);
  later(t + 0.5, counted);
}

/** The takings have all been counted out: the purse, resolve and level show the run's own numbers. */
function counted(): void {
  shown.resolve = null;
  shown.xp = null;
  shown.level = null;
  shown.acorns = null;
  renderTable();
  signal("counted");
}

/** Goes on from a fight's sheet: to planning the next room, or to the end of the raid. */
export function carryOn(): void {
  const run = S.run;
  if (S.mode !== "after" || !run || sheetUp() !== "after") return;
  // Whatever of the count was still to come is shown counted.
  forgetLater();
  counted();
  closeSheet(false);
  endFight();
  snd.tap();
  if (run.phase === "over") S.mode = "over";
  else {
    S.mode = "plan";
    syncPawns(run, true);
    if (!arrived(run)) arrive(run);
  }
  changed();
}

/** Where the purse of acorns is, from the board's corner. */
const purse = (): { x: number; y: number } => boardSpot(document.getElementById("acorns")) ?? MIDDLE;

/** Shows one line of the takings, and says when the next may start. */
function count(note: RaidNote, at: number, levels: boolean): number {
  if (note.t === "result") {
    {
      const text = note.result === "win" ? "Room won!" : note.result === "loss" ? "Room lost." : "A draw.";
      const col = note.result === "win" ? GOLD[2] : note.result === "loss" ? "#e67967" : "#cdb6d8";
      later(at, () => {
        say(MIDDLE.x, MIDDLE.y - 6, text, col, { big: true, ttl: 2 });
        if (note.result === "win") {
          snd.win();
          watchersCheer();
        } else if (note.result === "loss") snd.loss();
        else snd.draw();
      });
      return at + 0.6;
    }
  }
  if (note.t === "resolve") {
    {
      later(at, () => {
        sheetTaking(
          "Resolve",
          el(
            "b",
            note.change > 0 ? "k-leafy" : "k-coral",
            {},
            icon("heart"),
            `${note.change > 0 ? "+" : ""}${note.change}`,
          ),
        );
        shown.resolve = null;
        renderTable();
        snd.resolve();
        const spot = boardSpot(document.getElementById("resolve"));
        if (spot)
          say(
            spot.x,
            spot.y + 16,
            `${note.change > 0 ? "+" : ""}${note.change} resolve`,
            note.change > 0 ? LEAF : "#e67967",
            { ttl: 1.4, rise: -6 },
          );
      });
      return at + 0.45;
    }
  }
  if (note.t === "fed") {
    {
      const p = pawns.get(note.piece);
      later(at, () => {
        sheetTaking("Greg has eaten something.", "");
        if (p) say(p.x, p.y - 22, "Greg has eaten something.", LEAF, { ttl: 1.4 });
      });
      return at + 0.3;
    }
  }
  if (note.t === "acorns") {
    {
      const slow = note.why === "interest";
      const each = slow ? 0.16 : 0.08;
      later(at, () => {
        sheetTaking(WHY[note.why] ?? "", acorns(`+${note.amount}`));
        say(MIDDLE.x, MIDDLE.y + 12, `${WHY[note.why] ?? ""} +${note.amount}`, GOLD[2], { ttl: 1.1 });
        const to = purse();
        // Savings pay out of the purse's own piles, an acorn at a time; the rest comes off the board.
        const from = slow ? { x: to.x - 4, y: to.y - 30 } : MIDDLE;
        for (let i = 0; i < note.amount; i++) {
          fly(glyphPic("acorn"), { x: from.x + (slow ? i * 3 : (i % 3) * 6 - 6), y: from.y }, to, {
            delay: i * each,
            dur: slow ? 0.3 : 0.45,
            arc: slow ? 10 : 18,
            land: () => {
              snd.acorn(i);
              signal("acorn", 1);
            },
          });
        }
      });
      return at + 0.4 + note.amount * each;
    }
  }
  if (note.t === "xp") {
    {
      if (levels) return at;
      later(at, () => {
        sheetTaking("Experience", el("b", "k-leafy", { text: `+${note.gained}` }));
        shown.xp = null;
        renderTable();
        snd.xp();
      });
      return at + 0.25;
    }
  }
  if (note.t === "level") {
    {
      later(at, () => {
        sheetTaking("Level up", el("b", "k-leafy", { text: `Level ${note.level}` }));
        shown.xp = null;
        shown.level = null;
        renderTable();
        snd.level();
        say(MIDDLE.x, MIDDLE.y + 30, `Level ${note.level}: field one more`, LEAF, { big: true, ttl: 1.6 });
      });
      return at + 0.5;
    }
  }
  return note.t === "over" ? at + 0.9 : at;
}
