/**
 * What happens when, as it is shown: sitting down to a run, setting out, the fight, counting out
 * what the room paid, and going on to the next room or to the end. Leaf and the rules do all the
 * deciding, and the screen (`screen.ts`) says where the table is; this asks for its moves and acts
 * each one out.
 */
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { leave, tell } from "@sequoia-leaf/kit/shell.ts";
import {
  type AcornsWhy,
  catalogOf,
  endingOf,
  picksOf,
  type RaidNote,
  slotOf,
  specOf,
  startOf,
  type TraitId,
  traitIn,
  type Way,
} from "@sequoia-leaf/raid";

import { glyphPic } from "./art/icons.ts";
import { endFight, fightOn, setSpeed, skipFight, startFight } from "./fightview.ts";
import { clearFx, fly, forgetLater, later, say } from "./fx.ts";
import { BOARD_W } from "./geometry.ts";
import { planning, unpick } from "./hand.ts";
import type { Speed } from "./keep.ts";
import { streakName } from "./logic.ts";
import { cheer, clearPawns, pawns, syncPawns } from "./pawns.ts";
import { arrive, arrived, watchersCheer } from "./scene.ts";
import { endedIn, type Playback, type Screen } from "./screen.ts";
import { signal } from "./signals.ts";
import { snd } from "./sounds.ts";
import { boardSpot } from "./stage.ts";
import {
  ask,
  catalogFor,
  changed,
  doNow,
  go,
  onScreen,
  playSlot,
  prefsChanged,
  S,
  type Slot,
  tableNow,
} from "./state.ts";
import { acorns } from "./ui/cards.ts";
import { closeSheet, openSheet, sheetTaking, sheetUp, type Taking } from "./ui/fightsheet.ts";
import { forgetTable, wakeChip } from "./ui/table.ts";

const MIDDLE = { x: BOARD_W / 2, y: 64 };

/** Sits down to the table as Leaf has it: a run just begun, or one picked up again. */
export function enterRun(): void {
  go({ e: "sit", ...tableNow() });
}

/** Sits down to the run in a slot: the run in hand, or the endless run. */
export function sitDown(slot: Slot): void {
  playSlot(slot);
  enterRun();
}

/**
 * Sets out on a way (a trail or an endless way, with all figures or the member's own): Leaf lays a
 * new run out in the way's slot (putting down the run there), and the table shows it. The run in the
 * other slot is not touched. Says whether it did.
 */
export async function startOn(way: Way): Promise<boolean> {
  const did = await ask(startOf(way), document.getElementById("start"));
  if (!did?.ok) return false;
  sitDown(slotOf(way));
  return true;
}

/** Sits down to the run in a slot and plays its last fight again; then the room is planned as it was. */
export function watchAgain(slot: Slot): void {
  playSlot(slot);
  go({ e: "watch", ...tableNow() });
}

/** Steps back from the board to the front page; the run is kept as it is. */
export function toFront(): void {
  go({ e: "front" });
}

/** Ends the run in a slot early: it ends here, and is still paid for the rooms it cleared. */
export async function goHome(slot: Slot = S.slot): Promise<void> {
  playSlot(slot);
  if (!S.run || S.run.stage.phase === "over") return;
  unpick();
  const did = await ask({ do: "abandon" });
  const ended = did?.ok ? endedIn(did.notes) : null;
  if (ended) go({ e: "ended", ended });
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
export function doLevelUp(): void {
  if (!planning()) return;
  const done = doNow({ do: "xp" });
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
  say(
    MIDDLE.x,
    MIDDLE.y + 22,
    `${traitIn(catalogOf(run), trait).name} is on${step > 1 ? `, step ${step}` : ""}`,
    GOLD[2],
    { ttl: 1.3 },
  );
}

/** Sends the party in: Leaf locks both boards and decides the fight, and the table plays it. */
export async function setOut(): Promise<void> {
  if (!planning()) return;
  unpick();
  if ((await ask({ do: "fight" }, document.getElementById("setout")))?.ok) enterRun();
}

export function doSkip(): void {
  if (S.screen.at === "fight" && fightOn()) skipFight();
}

/** Goes on from a fight's sheet: to planning the next room, or to the end of the raid. */
export function carryOn(): void {
  if (S.screen.at !== "after" || !S.screen.takings.notes) return;
  snd.tap();
  go({ e: "carry", ...tableNow() });
}

/** Opens the last fight's sheet while planning with nothing to pick, or puts it away. */
export function lookBack(): void {
  const s = S.screen;
  if (s.at === "plan" && (s.looking || (S.run?.last && picksOf(S.run).length === 0))) go({ e: "look" });
}

/**
 * Acts out a move of the screen. Sitting down from the front page lays the table out afresh; a
 * fight that is new to the screen is played (or, one these rules would play otherwise than Leaf
 * decided it, only ended); Leaf's answer for the takings opens the sheet and counts them out;
 * leaving them puts the fight and the sheet away; a room planned that is new has its party walk in.
 */
function acted(before: Screen, now: Screen): void {
  const run = S.run;
  const away = before.at === "front" || before.at === "over";
  if (away && now.at !== "front" && now.at !== "over" && run) {
    forgetTable();
    clearPawns();
    clearFx();
    syncPawns(run, true);
  }
  if (before.at === "after" && now.at !== "after") forgetLater();
  if (now.at !== "fight" && now.at !== "after") endFight();
  if (now.at === "fight" && !(before.at === "fight" && before.play.key === now.play.key)) played(now.play);
  if (now.at === "after" && now.takings.notes && !(before.at === "after" && before.takings.notes))
    counting(now.takings.notes, now.play);
  const sheet = now.at === "after" && now.takings.notes ? "after" : now.at === "plan" && now.looking ? "again" : null;
  if (sheetUp() !== sheet) {
    if (sheet === "again") openSheet("again");
    else if (sheet === null) closeSheet(before.at === "plan");
  }
  if (now.at === "plan" && before.at !== "plan" && run) {
    unpick();
    syncPawns(run, true);
    if (!arrived(run)) arrive(run);
  }
  if (now.at === "front" || now.at === "over") {
    unpick();
    clearFx();
  }
  changed();
}
onScreen(acted);

/** Plays a fight new to the screen, as Leaf decided it; one these rules would play otherwise is only ended. */
function played(play: Playback): void {
  unpick();
  if (play.kept) startFight(play.fought.setup, S.prefs.speed, S.looks.bases, () => go({ e: "played", key: play.key }));
  else go({ e: "played", key: play.key });
}

const WHY: Readonly<Record<AcornsWhy, string>> = {
  room: "The room",
  win: "For winning",
  interest: "Savings",
  gnomes: "The gnomes found",
  streak: "Streak",
  windfall: "Windfall",
};
/** What a line of the takings is called. The run has taken the room by then, so its streak is the one paid for. */
const whyName = (why: AcornsWhy): string => (why === "streak" && S.run ? streakName(S.run.streak) : WHY[why]);

/** The line a note adds to what the room paid, if any. With a level gained, the XP is not a line of its own. */
function takingOf(note: RaidNote, levels: boolean): Taking | null {
  if (note.t === "resolve") {
    const change = `${note.change > 0 ? "+" : ""}${note.change}`;
    return ["Health", el("b", note.change > 0 ? "k-leafy" : "k-coral", {}, icon("heart"), change)];
  }
  if (note.t === "fed") return ["Greg has eaten something.", ""];
  if (note.t === "acorns") return [whyName(note.why), acorns(`+${note.amount}`)];
  if (note.t === "xp") return levels ? null : ["XP", el("b", "k-leafy", { text: `+${note.gained}` })];
  if (note.t === "level") return ["Level up", el("b", "k-leafy", { text: `Level ${note.level}` })];
  return null;
}

/** Leaf has settled the room: its sheet rises with a place for each line it paid, and they are counted out. */
function counting(notes: readonly RaidNote[], play: Playback): void {
  signal("fought");
  const levels = notes.some((n) => n.t === "level");
  const lines = notes.map((note) => takingOf(note, levels));
  openSheet(
    "after",
    { setup: play.fought.setup, outcome: play.fought.outcome, kept: play.kept },
    lines.filter((line) => line !== null),
  );
  const result = notes.find((n) => n.t === "result");
  const won = result?.t === "result" && result.result === "win";
  const ended = endedIn(notes);
  if (ended && endingOf(ended.run) === "won")
    tell({ town: "news", text: "A little raid cleared: The Crab Nobody Counted has been counted.", tone: "gold" });
  else if (won && play.boss)
    tell({
      town: "news",
      text: `${specOf(catalogFor(S.run), play.boss).name} was seen off at the stump, room ${play.room + 1}.`,
      tone: "gold",
    });
  let t = 0.1;
  let line = 0;
  notes.forEach((note, i) => {
    later(t, () => go({ e: "count", upTo: i + 1 }));
    t = count(note, t, lines[i] ? line++ : -1);
  });
  later(t + 0.5, () => {
    go({ e: "counted" });
    signal("counted");
  });
}

/** Where the purse of acorns is, from the board's corner. */
const purse = (): { x: number; y: number } => boardSpot(document.getElementById("acorns")) ?? MIDDLE;

/** Acts out one note of the takings, showing its line (`line`, the place kept for it, or -1 for none), and says when the next may start. */
function count(note: RaidNote, at: number, line: number): number {
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
        sheetTaking(line);
        snd.resolve();
        const spot = boardSpot(document.getElementById("resolve"));
        if (spot)
          say(
            spot.x,
            spot.y + 16,
            `${note.change > 0 ? "+" : ""}${note.change} health`,
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
        sheetTaking(line);
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
        sheetTaking(line);
        say(MIDDLE.x, MIDDLE.y + 12, `${whyName(note.why)} +${note.amount}`, GOLD[2], { ttl: 1.1 });
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
              go({ e: "landed" });
            },
          });
        }
      });
      return at + 0.4 + note.amount * each;
    }
  }
  if (note.t === "xp") {
    {
      // With a level gained, the level's line says it.
      if (line < 0) return at;
      later(at, () => {
        sheetTaking(line);
        snd.xp();
      });
      return at + 0.25;
    }
  }
  if (note.t === "level") {
    {
      later(at, () => {
        sheetTaking(line);
        snd.level();
        say(MIDDLE.x, MIDDLE.y + 30, `Level ${note.level}: field one more`, LEAF, { big: true, ttl: 1.6 });
      });
      return at + 0.5;
    }
  }
  return note.t === "over" ? at + 0.9 : at;
}
