/**
 * The Little Raid: the guild's board-and-shop auto battler, played with carved figures on a hex
 * board cut into a great stump at the edge of Guild Town.
 *
 * This file only puts the parts together: the rules are in `game/`, the table and everything on it
 * in `screen/`. Opened alone it plays by itself; inside the town it says when it is ready, sends
 * news worth a line in the town's feed, and saves when the town puts it away.
 */
import { fromTown, tell } from "@sequoia-leaf/kit/shell.ts";
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
import { hearNotes, stepPawns, syncPawns } from "./screen/pawns.ts";
import { drawOver, drawScene, stepScene, wordsScene } from "./screen/scene.ts";
import { showSheet } from "./screen/sheet.ts";
import { onSignal } from "./screen/signals.ts";
import { snd } from "./screen/sounds.ts";
import * as stage from "./screen/stage.ts";
import { onChange, onNotes, onRefused, S, saveNow, wake } from "./screen/state.ts";
import { cardOff } from "./screen/ui/cards.ts";
import { renderNudge, stepNudge } from "./screen/ui/nudge.ts";
import { openPages, pagesClick, renderPages, showPage } from "./screen/ui/pages.ts";
import { renderPicks } from "./screen/ui/picks.ts";
import { acornLanded, buildTable, placeFoe, renderTable, stepTable, toast, wakeChip } from "./screen/ui/table.ts";

async function boot(): Promise<void> {
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
      cardOff();
      renderNudge();
    },
  });
  openHand(must(document.querySelector<HTMLCanvasElement>("#view"), "the table's canvas"));
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
  });
  window.addEventListener("pagehide", saveNow);
  tell({ town: "ready" });
}

void boot();
