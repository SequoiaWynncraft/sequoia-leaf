/**
 * The settings menu's Account tab (`menu.ts`): how the player signed in, whether a Wynncraft account
 * is linked, with the way to link one where none is, and signing out. Every word of it is in the
 * game's face.
 *
 * Signed in on the guild's website, an account is linked: that is the only way in there. Signed in
 * with Discord alone, none is, and Link account goes to the guild's sign-in, which links one.
 */
import { el } from "./dom.ts";
import { linkAccount, type Member, townAddress } from "./live.ts";
import { ask, outside } from "./net.ts";

/** A row of the tab: what it is, how it stands, and a button where there is something to do about it. */
export interface AccountRow {
  readonly name: string;
  readonly value: string;
  readonly act?: { readonly word: string; readonly go: () => void };
}

/** The tab's rows for a player; `signIn` is the guild's sign-in (hello's). */
export function accountRows(me: Member, signIn: string): AccountRow[] {
  if (me.signedInWith === "sequoia")
    return [
      { name: "Signed in with", value: "Sequoia" },
      { name: "Wynncraft account", value: "Linked" },
    ];
  return [
    { name: "Signed in with", value: "Discord" },
    {
      name: "Wynncraft account",
      value: "Not linked",
      act: { word: "Link account", go: () => linkAccount(signIn) },
    },
  ];
}

/**
 * Signs the player out: Leaf ends its own session, and then the whole window goes to where the
 * player is signed out. Signed in on the guild's website, that is its sign-out, which comes back to
 * the town; with Discord alone, Leaf's session was all there was, and the page is loaded again (in
 * the town's frame, the town is). Says whether it went: with Discord alone, not unless Leaf answered.
 */
export async function signOut(me: Member, signIn: string): Promise<boolean> {
  const ended = await ask("/v1/game/sign-out", { method: "POST" });
  if (me.signedInWith === "sequoia") {
    outside.away(`${new URL(signIn).origin}/auth/web/logout?return_to=${encodeURIComponent(townAddress())}`);
    return true;
  }
  if (ended.status !== 204) return false;
  if (outside.top()) outside.reload();
  else outside.away(townAddress());
  return true;
}

/** The tab as it is drawn: its rows, and Sign out at the foot. */
export function accountPage(me: Member, signIn: string): HTMLElement[] {
  const rows = accountRows(me, signIn).map(({ name, value, act }) =>
    el(
      "li",
      "k-card k-settings-account",
      {},
      el("span", "k-name", { text: name }),
      el("span", "k-settings-stands", { text: value }),
      act ? el("button", "k-btn sm", { type: "button", onclick: act.go }, act.word) : null,
    ),
  );
  // Pressed, it waits for Leaf; it can be pressed again only if the player is still signed in.
  const press = async (): Promise<void> => {
    out.disabled = true;
    out.disabled = await signOut(me, signIn);
  };
  const out = el("button", "k-btn coral", { type: "button", onclick: () => void press() }, "Sign out");
  return [el("ul", "k-settings-list", {}, ...rows), el("div", "k-settings-foot", {}, out)];
}
