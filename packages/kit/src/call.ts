/**
 * A page of Leaf in a Discord call (`launch.ts`). The page Discord frames (the town, as Discord opens
 * it) signs the player in before anything else: it asks Leaf for the Discord application's id,
 * greets Discord (its embedded app SDK, loaded only here), asks it to sign the player in
 * (`authorize`, `identify` alone, asking nothing of them when they have allowed it before), and sends
 * the code Discord gives to Leaf, which signs them in as Discord sign-in does and sets the page's
 * session. Leaf answers with the player's Discord token, handed back to Discord (`authenticate`).
 * Then the page opens as any page does (`start()`), signed in.
 *
 * A game the town shows in its frame is in the call too (its address carries the launch), but
 * Discord's SDK speaks only to the page Discord frames, so a game there signs nobody in: it has the
 * town's session. Each page in a call says where the player is in one line when Discord shows the
 * call small (`callLine`).
 */
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import type { Page } from "@sequoia-leaf/core";

import { el } from "./dom.ts";
import { inCall } from "./launch.ts";
import { pageCard, start, type Where } from "./live.ts";
import { ask, isRecord, outside } from "./net.ts";
import { watchPage } from "./report.ts";
import { type Scope, scope } from "./scope.ts";
import { inTown, tell } from "./shell.ts";

/** How long Discord has to greet the page before the page says it is not in a call. */
const GREETED_WITHIN = 15_000;
/** How long Discord has to answer a command: its SDK waits on one for ever. */
const ANSWERED_WITHIN = 10_000;
/** How often a page's line is drawn again: a raid table's seconds count down. */
const LINE_EVERY_MS = 1000;

/** Why Leaf will not open in the call, as the page says it. */
export const CALL_WORDS = {
  notOpen: "Leaf is not open in Discord yet.",
  notInCall: "Open Leaf from a Discord call.",
  refused: "Discord did not sign you in. Try again.",
  noAnswer: "Leaf did not answer. Try again.",
  notKept: "This browser did not keep your sign-in.",
} as const;

/** Whether this page is the one Discord frames in a call: in the call, and not in the town's frame. */
export const callTop = (): boolean => inCall() && !inTown();

/** What this page holds of the call once Discord has signed the player in: Discord, and Leaf's own address. */
const held: { discord: DiscordSDK | null; site: string | null } = { discord: null, site: null };

/** What a promise comes to, or null when it fails or does not come within `ms`. */
export async function within<A>(ms: number, promise: Promise<A>): Promise<A | null> {
  const timer = { stop: (): void => undefined };
  const late = new Promise<null>((resolve) => {
    timer.stop = scope().after(ms, () => resolve(null));
  });
  try {
    return await Promise.race([promise.catch(() => null), late]);
  } finally {
    timer.stop();
  }
}

/** Leaf's word on why it did not sign the player in, or else that it did not answer. */
const leafSays = (body: unknown): string =>
  isRecord(body) && typeof body.message === "string" ? `${body.message}.` : CALL_WORDS.noAnswer;

/** Signs the player in through Discord. Null once they are; otherwise why not, in the page's words. */
export async function signInToCall(): Promise<string | null> {
  const hello = await ask("/v1/activity");
  const clientId = hello.status === 200 && isRecord(hello.body) ? hello.body.client_id : null;
  if (typeof clientId !== "string") return hello.status === 404 ? CALL_WORDS.notOpen : CALL_WORDS.noAnswer;
  const site = isRecord(hello.body) && typeof hello.body.site === "string" ? hello.body.site : null;
  const sdk = await within(
    GREETED_WITHIN,
    import("@discord/embedded-app-sdk").then(async ({ DiscordSDK }) => {
      // It reads the frame and the platform from the page's query, and throws without them.
      const made = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
      await made.ready();
      return made;
    }),
  );
  if (sdk === null) return CALL_WORDS.notInCall;
  const authorized = await sdk.commands
    .authorize({ client_id: clientId, response_type: "code", state: "", prompt: "none", scope: ["identify"] })
    .catch(() => null);
  if (authorized === null) return CALL_WORDS.refused;
  const signed = await ask("/v1/activity/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: authorized.code }),
  });
  const token = signed.status === 200 && isRecord(signed.body) ? signed.body.access_token : null;
  if (typeof token !== "string") return leafSays(signed.body);
  // Discord's half of it, which its commands after (a link out) want: a refusal, or no answer, keeps nobody out.
  await within(ANSWERED_WITHIN, sdk.commands.authenticate({ access_token: token }));
  held.discord = sdk;
  held.site = site;
  return null;
}

/**
 * Where the game is (`start()`), with the page watched (`watchPage`, once the player is signed in, so
 * that what it reports is theirs); on the page Discord frames, once Discord has signed the player
 * in. Null where the page's card says why Leaf will not open in the call (Try again opens it again).
 */
export async function openLeaf(page: Page): Promise<Where | null> {
  const refused = callTop() ? await signInToCall() : null;
  watchPage(page);
  const where = refused === null ? await start() : null;
  // Signed in through Discord and signed out all the same: the browser did not keep the cookie.
  const kept = !(callTop() && where?.mode === "shut" && where.why === "signedout");
  if (where !== null && kept) return where;
  pageCard("Leaf did not open", refused ?? CALL_WORDS.notKept, "Try again", () => outside.reload());
  return null;
}

/** Leaf's own address, outside Discord (`https://leaf.seqwawa.com`), once Discord has signed the player in on this page. */
export const leafSite = (): string | null => held.site;

/**
 * Opens an address in the player's browser, outside Discord (Discord asks them first). A game in the
 * town's frame asks the town, which Discord frames. Says whether Discord did (or the town was asked):
 * not on a page Discord did not sign the player in on, and not without its answer.
 */
export async function openOutside(url: string): Promise<boolean> {
  const discord = held.discord;
  if (discord === null) {
    const asked = inTown();
    if (asked) tell({ town: "open", url });
    return asked;
  }
  const answer = await within(ANSWERED_WITHIN, discord.commands.openExternalLink({ url }));
  // Discord's clients from before December 2024 do not say (`opened: null`): it went to them.
  return answer !== null && answer.opened !== false;
}

/**
 * In a call, puts the page's line on it (`text`), kept up to date while `life` lasts: the only thing
 * shown when Discord shows the call small (around 400 by 225 and under), with nothing to press. Out of a
 * call, nothing. The kit's styles show it, and only it (and what is marked `k-call-keep`), at that size.
 */
export function callLine(life: Scope, text: () => string): void {
  if (!inCall()) return;
  const line = el("p", "k-call-line", { id: "call-line" });
  document.body.append(line);
  document.body.dataset.call = "";
  const draw = (): void => {
    line.textContent = text();
  };
  draw();
  life.every(LINE_EVERY_MS, draw);
}
