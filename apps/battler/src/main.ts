/**
 * The Little Raid: the guild's board-and-shop auto battler, played with carved figures on a hex
 * board cut into a great stump at the edge of Guild Town.
 *
 * This file only puts the parts together: the rules are in `game/`, the table and everything on it
 * in `screen/`. Opened alone it plays by itself; inside the town it says when it is ready, sends
 * news worth a line in the town's feed, and saves when the town puts it away.
 */
import { before, pickUp, pull } from "@sequoia-leaf/kit/cloud.ts";
import { followLeaf, shutCard, start } from "@sequoia-leaf/kit/live.ts";
import { post } from "@sequoia-leaf/kit/postcard.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { fromTown, inTown, tell } from "@sequoia-leaf/kit/shell.ts";
import { isMuted, setMuted } from "@sequoia-leaf/kit/sound.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { FIGURES } from "./game/index.ts";
import { onTraitWoke, stepFightView } from "./screen/fightview.ts";
import {
  doHold,
  doLevelUp,
  doRustle,
  doSkip,
  doSpeed,
  enterRun,
  goHome,
  leaveTable,
  setOut,
  startNew,
  toFront,
  traitOn,
} from "./screen/flow.ts";
import { stepFx } from "./screen/fx.ts";
import { openHand, unpick } from "./screen/hand.ts";
import { openHandle } from "./screen/handle.ts";
import { postcard } from "./screen/logic.ts";
import { hearNotes, stepPawns, syncPawns } from "./screen/pawns.ts";
import { drawOver, drawScene, stepScene, wordsScene } from "./screen/scene.ts";
import { showSheet } from "./screen/sheet.ts";
import { onSignal } from "./screen/signals.ts";
import { snd } from "./screen/sounds.ts";
import * as stage from "./screen/stage.ts";
import { onChange, onNotes, onRefused, S, saveNow, wake } from "./screen/state.ts";
import { recard } from "./screen/ui/cards.ts";
import { openLight } from "./screen/ui/lit.ts";
import { renderNudge, stepNudge } from "./screen/ui/nudge.ts";
import { openPages, pagesClick, renderPages, showPage } from "./screen/ui/pages.ts";
import { renderPicks } from "./screen/ui/picks.ts";
import { acornLanded, buildTable, placeFoe, renderTable, stepTable, toast, wakeChip } from "./screen/ui/table.ts";

/** The window's size when the page was last laid out. */
let windowSize = "";

/** What the town was last told about the table, so that it is told only what has changed. */
let carded = "";
/** Leaves the town a postcard about the table, if anything on it has changed. */
function sendCard(): void {
  const card = postcard(S.run, S.almanac);
  const text = JSON.stringify(card);
  if (text === carded) return;
  carded = text;
  post("raid", card);
}

async function boot(): Promise<void> {
  // Where the game is, and on the guild's server the member's saves, before anything kept is read.
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  const live = where.mode === "live";
  // Opened on its own, the table also keeps the town's slot, where its postcard is.
  if (live && !(await pull(inTown() ? ["purse", "raid"] : ["purse", "raid", "town"], { onReplaced: pickUp }))) {
    shutCard("closed", where.signIn);
    return;
  }
  await fontsReady();
  if (new URLSearchParams(location.search).has("sheet")) {
    showSheet();
    return;
  }
  wake();
  buildTable({
    rustle: doRustle,
    hold: doHold,
    levelUp: doLevelUp,
    setOut,
    speed: doSpeed,
    skipFight: doSkip,
    help: () => showPage("howto"),
    sound: () => {
      setMuted(!isMuted());
      renderTable();
    },
    frontPage: toFront,
    traitOn,
  });
  openPages({
    carryOn: () => {
      showPage(null);
      enterRun();
    },
    start: (trail) => {
      showPage(null);
      startNew(trail);
    },
    goHome,
    leave: () => {
      saveNow();
      leaveTable();
    },
  });
  document.getElementById("modal")?.addEventListener("click", pagesClick);

  // What the rules say happened is acted out by the figures, then the interface is drawn again.
  onNotes((notes) => {
    hearNotes(notes);
    for (const note of notes) {
      // The member's first three-star figure ever is worth a line in the town.
      const first = S.almanac.threeStars.length === 0 && S.run?.seen.threeStars.length === 1;
      if (note.t === "merged" && note.stars === 3 && first) {
        tell({
          town: "news",
          text: `A first three-star figure at the stump: ${FIGURES[note.kind].name}.`,
          tone: "gold",
        });
      }
    }
  });
  onChange(() => {
    if (S.mode === "plan") syncPawns(S.run);
    sendCard();
    renderTable();
    renderPicks();
    renderPages();
    renderNudge();
  });
  onRefused((why) => {
    snd.no();
    toast(why);
  });
  onSignal("acorn", acornLanded);
  onTraitWoke((trait) => wakeChip(trait));

  stage.open({
    step(dt) {
      stepFx(dt);
      stepPawns();
      stepFightView(dt);
      stepScene(dt);
      stepTable();
      stepNudge();
    },
    draw: drawScene,
    words: wordsScene,
    over: drawOver,
    resized() {
      placeFoe();
      // The stall growing or shrinking lays the page out again too: a card stays beside its thing,
      // and only a new window size puts away a card shown beside a figure on the table.
      const size = `${window.innerWidth}x${window.innerHeight}`;
      recard(size === windowSize);
      windowSize = size;
      renderNudge();
    },
  });
  openHand(must(document.querySelector<HTMLCanvasElement>("#view"), "the table's canvas"));
  openLight();
  openHandle();

  // A run in progress is offered again on the front page; nothing starts by itself.
  S.mode = "front";
  renderTable();
  renderPicks();
  renderPages();
  stage.layout();

  fromTown(() => {
    unpick();
    saveNow();
    sendCard();
  });
  window.addEventListener("pagehide", saveNow);
  before(() => {
    saveNow();
    sendCard();
  });
  sendCard();
  here("table");
  // Opened on its own, nobody else is listening for the member's Leaf.
  if (live && !inTown()) followLeaf();
  tell({ town: "ready" });
}

void boot();
