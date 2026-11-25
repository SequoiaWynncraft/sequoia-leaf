/**
 * The Treasury's panel: Cinfy sells the guild's requests for Leaf, as the backend's reward queue
 * offers them through Leaf (`/v1/game/requests`): an aspect request, a tome request and, where the
 * backend sells it, LE, so many at a price each. Each row has its price on a button, or in its place
 * why the member cannot buy it, in the backend's words. The backend makes the request and takes the
 * Leaf; the row then says where it stands in the queue.
 */

import { type LeRate, leRateText, leTooDear, leTooFew, type RequestKind, REQUESTS } from "@sequoia-leaf/core";
import { asking, asksAgain, el, icon as glyph, pressedTwice, replay } from "@sequoia-leaf/kit/dom.ts";
import { isGuest } from "@sequoia-leaf/kit/live.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { type Answer, ask, isRecord } from "@sequoia-leaf/kit/net.ts";
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
import { requestArt } from "./treasuryart.ts";

/** The guild's requests the Treasury sells, in the order it lists them. */
const KINDS: readonly RequestKind[] = ["aspect", "tome", "le"];
/** Each request's name on its row. */
const NAMES: Readonly<Record<RequestKind, string>> = { aspect: REQUESTS.aspect, tome: REQUESTS.tome, le: "LE" };
const LOST = "Could not tell whether the request went through. Check the queue in Discord before trying again.";
const UNREACHED = "The guild's requests could not be reached. Try again in a moment.";

/** A request's line where its button would be: why it cannot be bought, or what buying it did. */
interface Said {
  text: string;
  tone: "k-gold" | "k-coral" | "k-dim";
}

/** One request's row: its card, the lines under its name, and the place for its button. */
interface Row {
  readonly kind: RequestKind;
  readonly card: HTMLElement;
  readonly under: HTMLElement;
  readonly side: HTMLElement;
}

/** The counter as the panel shows it: what Leaf says of each request, and what the member has typed. */
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
  /** What Leaf says each costs (for LE, Leaf for 1 LE), while the member may buy it. */
  readonly price: Partial<Record<RequestKind, number>>;
  /** What to say in place of a request's button. */
  readonly said: Partial<Record<RequestKind, Said>>;
  /** Why the last try did not go through, when it may be tried again: said under the row, with its button still there. */
  readonly again: Partial<Record<RequestKind, string>>;
  /** LE as the backend sells it; null until Leaf says, and while the backend sells none, its row is hidden. */
  le: LeRate | null;
  busy: boolean;
  writing: boolean;
}

/** How many LE the field says, 0 for none. */
const asked = (t: Counter): number => (Number.isFinite(t.many.valueAsNumber) ? t.many.valueAsNumber : 0);

/** What a row's button spends now: its price, and for LE so many at the price of one. */
function costOf(t: Counter, kind: RequestKind): number | undefined {
  const each = t.price[kind];
  return kind === "le" && each !== undefined ? asked(t) * each : each;
}

/** Why a row's button will not buy what it shows (LE not whole, too few, or more than the member's Leaf), or null. */
function blocked(t: Counter, kind: RequestKind): string | null {
  if (kind !== "le" || t.le === null) return null;
  const n = asked(t);
  if (!Number.isInteger(n) || n < t.le.minimum) return leTooFew(t.le);
  const { leaf } = balance();
  return n * t.le.leafPerLe > leaf ? leTooDear(n, t.le, leaf) : null;
}

/** A request as a sentence names it: "your tome request", "your 40 LE request". */
const named = (kind: RequestKind, n: number): string => (kind === "le" ? `${whole(n)} LE` : kind);

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
  const cost = costOf(t, kind);
  const words = t.said[kind];
  side.replaceChildren(!words && cost !== undefined ? buttonOf(t, row, cost) : "");
  const again = t.again[kind];
  const note = words ?? (again === undefined ? null : { text: again, tone: "k-coral" });
  under.replaceChildren(
    kind === "le" && t.le !== null ? el("div", "k-d", { text: leRateText(t.le) }) : "",
    note ? el("div", `k-read ${note.tone}`, { text: note.text }) : "",
  );
  if (kind === "le") {
    card.hidden = t.le === null;
    t.many.hidden = side.childElementCount === 0;
  }
  if (kind === "tome" && t.writing && !words) card.append(t.reason);
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
    t.again[kind] = why;
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

/** Takes LE's rate from Leaf's offer: false, and its row stays hidden, when the backend sells no LE. */
function offerLe(t: Counter, offer: unknown): boolean {
  if (!isRecord(offer) || typeof offer.price !== "number" || typeof offer.minimum !== "number") return false;
  // The field starts at the fewest the backend sells, and keeps what was typed when Leaf is asked again.
  if (t.le === null) t.many.value = String(offer.minimum);
  t.many.min = String(offer.minimum);
  t.le = { leafPerLe: offer.price, minimum: offer.minimum };
  return true;
}

async function look(t: Counter): Promise<void> {
  const answer = await ask("/v1/game/requests");
  const body = answer.status === 200 && isRecord(answer.body) ? answer.body : null;
  const message = isRecord(answer.body) && typeof answer.body.message === "string" ? answer.body.message : UNREACHED;
  for (const kind of KINDS) {
    const offer = body?.[kind];
    if (kind === "le" && !offerLe(t, offer)) continue;
    if (isRecord(offer) && typeof offer.price === "number") {
      t.price[kind] = offer.price;
      if (typeof offer.why_not === "string") t.said[kind] ??= { text: offer.why_not, tone: "k-dim" };
    } else t.said[kind] ??= { text: message, tone: "k-dim" };
  }
  draw(t);
}

/** The request made, as Leaf answers it: where it stands, what it cost, and the Leaf left; null for anything else. */
function madeOf(answer: Answer): { position: number; paid: number; left: number } | null {
  const made = answer.status === 200 && isRecord(answer.body) ? answer.body : null;
  if (!made || typeof made.position !== "number" || typeof made.leaf_paid !== "number") return null;
  return typeof made.leaf === "number" ? { position: made.position, paid: made.leaf_paid, left: made.leaf } : null;
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
  delete t.again[kind];
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
  const made = madeOf(answer);
  if (made) {
    t.said[kind] = {
      text: `Added your ${named(kind, n)} request to the queue at position #${made.position}. ${whole(made.paid)} Leaf paid; you have ${whole(made.left)} left.`,
      tone: "k-gold",
    };
    filed(t, b);
    // What the rest costs against the Leaf left.
    void look(t);
  } else {
    // Refused, nothing was taken, and the backend says why; anything else may have gone through.
    const message = isRecord(answer.body) ? answer.body.message : null;
    const refused = answer.status >= 400 && answer.status < 500 && typeof message === "string";
    // Nothing was taken and it may be tried again (the guild's server was busy): the button and what was written stay.
    if (answer.status === 503 && typeof message === "string") t.again[kind] = message;
    else t.said[kind] = { text: refused ? message : LOST, tone: "k-coral" };
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
        : "A paid request is served before the free ones.",
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
    price: {},
    said: {},
    again: {},
    le: null,
    busy: false,
    writing: false,
  };
  // How many LE changes what its button spends, and puts by why the last number would not do.
  life.on(many, "input", () => {
    delete t.again.le;
    draw(t);
  });
  draw(t);
  if (!isGuest()) void look(t);
  return null;
}
