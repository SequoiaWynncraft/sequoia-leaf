/**
 * The Treasury's panel: Cinfy sells the guild's requests for Leaf, as the backend's reward queue
 * offers them through Leaf (`/v1/game/requests`): an aspect request, a tome request and, where the
 * backend sells it, LE, so many at a price each. Each row has its price on a button, or in its place
 * why the member cannot buy it, in the backend's words. The backend makes the request and takes the
 * Leaf; the row then says where it stands in the queue. What each row shows is `requests.ts`'s.
 */

import { type RequestKind, REQUESTS } from "@sequoia-leaf/core";
import { asking, asksAgain, el, icon as glyph, pressedTwice, replay } from "@sequoia-leaf/kit/dom.ts";
import { isGuest } from "@sequoia-leaf/kit/live.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { ask } from "@sequoia-leaf/kit/net.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import { fly } from "@sequoia-leaf/kit/pursebar.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { folk, KEEPER } from "@sequoia-leaf/town/folk.ts";

import { hop, say } from "./actors.ts";
import { G } from "./game.ts";
import { button, centre, faceOf, pic, purseAt, slot } from "./hud.ts";
import {
  KINDS,
  leBlocked,
  locks,
  named,
  type Offers,
  offersOf,
  type Outcome,
  outcomeOf,
  type Shown,
  shown,
} from "./requests.ts";
import { requestArt } from "./treasuryart.ts";

/** Each request's name on its row. */
const NAMES: Readonly<Record<RequestKind, string>> = { aspect: REQUESTS.aspect, tome: REQUESTS.tome, le: "LE" };

/** One request's row: its card, the lines under its name, and the place for its button. */
interface Row {
  readonly kind: RequestKind;
  readonly card: HTMLElement;
  readonly under: HTMLElement;
  readonly side: HTMLElement;
}

/** The counter as the panel shows it: what Leaf says of each request now, what the member's tries came to, and what they typed. */
interface Counter {
  readonly life: Scope;
  readonly rows: readonly Row[];
  /** Cinfy's line at the counter, and her face. */
  readonly line: HTMLElement;
  readonly face: HTMLElement;
  /** What the tome is for. */
  readonly reason: HTMLTextAreaElement;
  /** How many LE to ask for: whole, from the fewest the backend sells. */
  readonly many: HTMLInputElement;
  /** Every request's offer, as Leaf last answered; nothing until it has. */
  offers: Offers;
  /** What the member's last try at each request came to. */
  readonly outcomes: Partial<Record<RequestKind, Outcome>>;
  busy: boolean;
  writing: boolean;
}

/** How many LE the field says, 0 for none. */
const asked = (t: Counter): number => (Number.isFinite(t.many.valueAsNumber) ? t.many.valueAsNumber : 0);

/** What a row shows now. */
const showing = (t: Counter, kind: RequestKind): Shown => shown(kind, t.offers[kind], t.outcomes[kind]);

/** What a row's button spends now at `price`: that, and for LE so many at the price of one. */
const costOf = (t: Counter, kind: RequestKind, price: number): number => (kind === "le" ? asked(t) * price : price);

/** Why a row's button will not buy what it shows (LE not whole, too few, or more than the member's Leaf), or null. */
function blocked(t: Counter, kind: RequestKind): string | null {
  const { sale } = showing(t, kind);
  return kind === "le" && sale ? leBlocked(sale, asked(t), balance().leaf) : null;
}

/** Forgets what a try came to where it may be tried again as it stands: the row is about to be tried, or its number changed. */
function forgetPassing(t: Counter, kind: RequestKind): void {
  const outcome = t.outcomes[kind];
  if (outcome && !locks(kind, outcome)) delete t.outcomes[kind];
}

/** A row's button, at what it spends now. */
function buttonOf(t: Counter, row: Row, cost: number): HTMLButtonElement {
  const spend = { on: `request:${row.kind}`, price: cost };
  return button(
    `leaf sm${asking(spend) ? " asking" : ""}${blocked(t, row.kind) === null ? "" : " off"}`,
    // A tome is not asked for twice: with what it is for written, its button says what pressing it does.
    row.kind === "tome"
      ? [t.writing ? "Buy" : null, glyph("leaf"), whole(cost)]
      : [asksAgain(spend, [glyph("leaf"), whole(cost)], "Buy?")],
    (b) => {
      press(t, row, b, cost);
    },
  );
}

function drawRow(t: Counter, row: Row): void {
  const { kind, card, side, under } = row;
  const { hidden, sale, rate, said } = showing(t, kind);
  side.replaceChildren(sale ? buttonOf(t, row, costOf(t, kind, sale.price)) : "");
  under.replaceChildren(
    rate === null ? "" : el("div", "k-d", { text: rate }),
    said ? el("div", `k-read ${said.tone}`, { text: said.text }) : "",
  );
  card.hidden = hidden;
  if (kind === "le") t.many.hidden = sale === null;
  if (kind === "tome" && t.writing && sale) card.append(t.reason);
  else if (kind === "tome") t.reason.remove();
}

function draw(t: Counter): void {
  for (const row of t.rows) drawRow(t, row);
}

/** A request's button pressed, at the price it says (`cost`). */
function press(t: Counter, row: Row, b: HTMLButtonElement, cost: number): void {
  const { kind } = row;
  if (t.busy) return;
  if (kind === "tome" && (!t.writing || t.reason.value.trim() === "")) {
    // A tome needs what it is for: the field first, then the button buys.
    if (t.writing) replay(b, "shake");
    t.writing = true;
    draw(t);
    t.reason.focus();
    sfx.tap();
    return;
  }
  const why = blocked(t, kind);
  if (why !== null) {
    // LE the backend would not sell, or more than the member has: said under the row, the field to put it right.
    t.outcomes[kind] = { is: "again", text: why };
    draw(t);
    t.many.focus();
    sfx.no();
    const now = row.side.querySelector("button");
    if (now) replay(now, "shake");
    return;
  }
  sfx.tap();
  // Writing what a tome is for and pressing "Buy 3,000" is asking enough; the others are asked once more.
  const redraw = (): void => {
    draw(t);
  };
  if (kind === "tome" || pressedTwice(t.life, { on: `request:${kind}`, price: cost }, redraw)) void buy(t, kind, b);
}

/** Asks Leaf what it sells now, and shows every row as it answers. */
async function look(t: Counter): Promise<void> {
  const had = t.offers.le?.sold === true;
  t.offers = offersOf(await ask("/v1/game/requests"));
  const le = t.offers.le;
  if (le?.sold) {
    // The field starts at the fewest the backend sells, and keeps what was typed while LE stays on sale.
    if (!had) t.many.value = String(le.minimum);
    t.many.min = String(le.minimum);
  }
  draw(t);
}

/** Cinfy files a request bought at the button `b`. */
function filed(t: Counter, b: HTMLButtonElement): void {
  sfx.buy();
  fly("leaf", purseAt("leaf"), centre(b), 5);
  t.line.textContent = KEEPER.filed[0];
  replay(t.face, "k-bump");
  if (G.cinfy) {
    hop(G.cinfy, 2);
    say(G.cinfy, KEEPER.filed[1], 2.4);
  }
}

async function buy(t: Counter, kind: RequestKind, b: HTMLButtonElement): Promise<void> {
  t.busy = true;
  t.many.disabled = true;
  forgetPassing(t, kind);
  const n = asked(t);
  const wanted = kind === "tome" ? { reason: t.reason.value.trim() } : kind === "le" ? { amount: n } : {};
  const answer = await waitingLook(
    b,
    ask("/v1/game/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: kind, ...wanted }),
    }),
  );
  t.busy = false;
  t.many.disabled = false;
  const outcome = outcomeOf(answer, named(kind, n));
  t.outcomes[kind] = outcome;
  if (outcome.is === "made") {
    filed(t, b);
    // What the rest costs against the Leaf left.
    void look(t);
  } else {
    sfx.no();
    replay(b, "shake");
  }
  draw(t);
}

/** Cinfy at the counter, and the line said once for every row; gives back her line and her face. */
function keeperAt(body: HTMLElement): { line: HTMLElement; face: HTMLElement } {
  const line = el("span", "", { text: KEEPER.hello });
  const face = slot(G.cinfy ? faceOf(G.cinfy, 3) : null, 28);
  face.classList.add("nod");
  body.append(
    el("div", "k-row", {}, face, el("div", "k-say left k-grow", {}, folkName(folk("cinfy").name, "k-pix"), line)),
    // Said once for all: what paying does, or for a guest why there is nothing to pay.
    el("div", "k-d", {
      text: isGuest()
        ? "For guild members with 7 days in the guild."
        : "A paid request is an extra, on top of a free one, and is served before the free ones.",
    }),
  );
  return { line, face };
}

/** A request's row, added to the panel; LE's has the field for how many beside its button. */
function rowOf(body: HTMLElement, kind: RequestKind, many: HTMLInputElement): Row {
  const side = el("div", "k-row");
  const under = el("div", "k-col");
  const card = el(
    "div",
    "k-card",
    {},
    slot(pic(requestArt(kind), 2), 28),
    el("div", "k-grow k-col", {}, el("span", "k-pix", { text: NAMES[kind] }), under),
    kind === "le" ? many : null,
    side,
  );
  body.append(card);
  return { kind, card, under, side };
}

export function treasury(body: HTMLElement, life: Scope): null {
  const { line, face } = keeperAt(body);
  const many = el("input", "k-field many", { type: "number", inputmode: "numeric", step: 1, "aria-label": "LE" });
  const t: Counter = {
    life,
    line,
    face,
    rows: KINDS.map((kind) => rowOf(body, kind, many)),
    reason: el("textarea", "k-field", {
      maxLength: 1000,
      rows: 2,
      placeholder: "What is the tome for?",
      "aria-label": "What is the tome for?",
    }),
    many,
    offers: {},
    outcomes: {},
    busy: false,
    writing: false,
  };
  // How many LE changes what its button spends, and puts by why the last number would not do.
  life.on(many, "input", () => {
    forgetPassing(t, "le");
    draw(t);
  });
  draw(t);
  if (!isGuest()) void look(t);
  return null;
}
