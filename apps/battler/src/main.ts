/**
 * The Little Raid: the guild's board-and-shop auto battler, played with carved figures on a hex
 * board cut into a great stump at the edge of Guild Town.
 *
 * This file only puts the parts together: the rules are `@sequoia-leaf/raid`, the table and
 * everything on it is in `screen/`. The table is Leaf's: the page opens it from the guild's server
 * and sends every move there as a command. Inside the town it says when it is ready, and sends news
 * worth a line in the town's feed.
 */
import { refresh, settle } from "@sequoia-leaf/kit/card.ts";
import { keepLeaf, serverCard, shutCard, start, troubleCard } from "@sequoia-leaf/kit/live.ts";
import { post } from "@sequoia-leaf/kit/postcard.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { fromTown, tell } from "@sequoia-leaf/kit/shell.ts";
import { isMuted, setMuted } from "@sequoia-leaf/kit/sound.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { must } from "@sequoia-leaf/kit/util.ts";
import { FIGURES } from "@sequoia-leaf/raid";

import { onTraitWoke, stepFightView } from "./screen/fightview.ts";
import {
  carryOn,
  doHold,
  doLevelUp,
  doRustle,
  doSkip,
  doSpeed,
  enterRun,
  goHome,
  leaveTable,
  rejoin,
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
import { onChange, onHeld, onMoved, onNotes, onRefused, openTable, S } from "./screen/state.ts";
import { registerCards } from "./screen/ui/cards.ts";
import { closeSheet, onCarry, placeSheet, registerFought, sheetUp, toggleLastFight } from "./screen/ui/fightsheet.ts";
import { openLight } from "./screen/ui/lit.ts";
import { renderNudge, stepNudge } from "./screen/ui/nudge.ts";
import { openPages, pagesClick, renderPages, showPage } from "./screen/ui/pages.ts";
import { renderPicks } from "./screen/ui/picks.ts";
import { acornLanded, buildTable, placeFoe, renderTable, stepTable, toast, wakeChip } from "./screen/ui/table.ts";

/** What the page says where no Leaf answers: the table is the guild's server's. */
const NEEDS_LEAF = "The table needs the guild's server.";

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

/** Sets out from the front page, which goes once Leaf has laid the run out. */
async function setOutOn(trail: number): Promise<void> {
  if (await startNew(trail)) showPage(null);
}

async function boot(): Promise<void> {
  await fontsReady();
  // Every figure on one sheet: a picture of the rules' figures, which needs no table.
  if (new URLSearchParams(location.search).has("sheet")) {
    showSheet();
    return;
  }
  // Who the member is, and then the table as Leaf has it. Without Leaf there is no table.
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return;
  }
  const { signIn, me } = where;
  const card = (why: Parameters<typeof troubleCard>[0]): void => troubleCard(why, signIn, NEEDS_LEAF);
  const trouble = await openTable(me.id, card);
  if (trouble) {
    card(trouble);
    return;
  }
  registerCards();
  registerFought();
  onCarry(carryOn);
  buildTable({
    rustle: () => void doRustle(),
    hold: doHold,
    levelUp: doLevelUp,
    setOut: () => void setOut(),
    speed: doSpeed,
    skipFight: doSkip,
    help: () => showPage("howto"),
    sound: () => {
      setMuted(!isMuted());
      renderTable();
    },
    frontPage: toFront,
    lastFight: toggleLastFight,
    traitOn,
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetUp() === "again") closeSheet();
  });
  openPages({
    carryOn: () => {
      showPage(null);
      enterRun();
    },
    start: (trail) => void setOutOn(trail),
    goHome: () => void goHome(),
    leave: leaveTable,
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
    // The card that is up says again what its thing is now (and goes, if the thing has gone).
    refresh();
  });
  onRefused((why) => {
    snd.no();
    toast(why);
  });
  // A tap or a drag while Leaf answers a rustle, a pick, setting out or the takings does nothing, and says so.
  onHeld(() => snd.no());
  // Leaf's table is not what this page was showing (the member played on another page): take it.
  onMoved(rejoin);
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
      placeSheet();
      // The stall growing or shrinking lays the page out again too: a card stays beside its thing.
      settle();
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

  fromTown((msg) => {
    if (msg.town !== "closing") return;
    unpick();
    sendCard();
  });
  sendCard();
  here("table");
  // In the town, the town says when the member's Leaf changes; opened on its own, the table listens itself.
  keepLeaf();
  tell({ town: "ready" });
}

void boot();
