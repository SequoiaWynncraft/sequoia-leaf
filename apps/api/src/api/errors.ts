import { Schema } from "effect";

// Every error answer is `{ "code", "message" }`, with one class per kind of answer, each with its status.
// `code` is stable and machine-readable, and clients branch on it; the message
// is for people. `Schema.Error` encodes only these fields, so that is exactly
// what reaches the wire.

const answer = <const Codes extends readonly [string, ...string[]]>(...codes: Codes) => ({
  code: Schema.Literals(codes),
  message: Schema.String,
});

/** No session, or one the backend no longer accepts. */
export class Unauthorized extends Schema.Error<Unauthorized>("Unauthorized")(answer("unauthorized"), {
  httpApiStatus: 401,
}) {}

/** Signed in, but not a current Sequoia member. */
export class NotAMember extends Schema.Error<NotAMember>("NotAMember")(answer("not_a_member"), {
  httpApiStatus: 403,
}) {}

/** Something in the game only the guild's members may see, asked for by a guest. */
export class MembersOnly extends Schema.Error<MembersOnly>("MembersOnly")(answer("members_only"), {
  httpApiStatus: 403,
}) {}

/** The staff's view of who played, asked for by somebody who is not a website admin. */
export class StaffOnly extends Schema.Error<StaffOnly>("StaffOnly")(answer("staff_only"), {
  httpApiStatus: 403,
}) {}

/**
 * A save written too soon after the last one to the same slot, or a batch of commands sent faster
 * than a player may send them. Nothing was written: send it again in a moment.
 */
export class SlowDown extends Schema.Error<SlowDown>("SlowDown")(answer("slow_down"), { httpApiStatus: 429 }) {}

/**
 * A write signed in with the session cookie that did not come from Leaf's own
 * pages. Another site can make a browser send the cookie, but not that `Origin`.
 */
export class BadOrigin extends Schema.Error<BadOrigin>("BadOrigin")(answer("bad_origin"), { httpApiStatus: 403 }) {}

/**
 * A request Leaf cannot read: an event id that is not one, a quest id that is
 * not one, a reroll without a cost, a save slot that is not one, a save that is
 * not `{ "player", "version", "data" }` with an object as its data, a player id
 * that is not a UUID, a place in town that is not one, a number of days that is
 * not one, a batch of commands that is not one of the game's, a page's call to
 * change Coins with an amount or a reason that is not one, or a purchase from
 * sequoia-backend that is not one, or has a key that is not one.
 */
export class Invalid extends Schema.Error<Invalid>("Invalid")(
  answer(
    "invalid_after",
    "invalid_quest",
    "invalid_cost",
    "invalid_slot",
    "invalid_save",
    "invalid_uuid",
    "invalid_place",
    "invalid_days",
    "invalid_command",
    "invalid_amount",
    "invalid_reason",
    "invalid_purchase",
    "invalid_key",
  ),
  { httpApiStatus: 400 },
) {}

/**
 * Nothing there: a slot the member has never saved to, a player with no skin Leaf can find, a game
 * Leaf does not play, a game or a player's state in it that cannot be visited, or a player Leaf does not know.
 */
export class Missing extends Schema.Error<Missing>("Missing")(
  answer("no_save", "no_skin", "no_such_game", "nothing_to_visit", "no_such_player"),
  { httpApiStatus: 404 },
) {}

/** A save written over a version other than the one stored, changing nothing. */
export class VersionConflict extends Schema.Error<VersionConflict>("VersionConflict")(answer("version_conflict"), {
  httpApiStatus: 409,
}) {}

/**
 * A save from a page that believes it is another member than the session's,
 * such as one left open after someone else signed in. Nothing was written.
 */
export class NotYou extends Schema.Error<NotYou>("NotYou")(answer("not_you"), { httpApiStatus: 409 }) {}

/**
 * The player's state in a game, as Leaf stored it, does not read (a rules change that forgot an
 * older state, say). Nothing was done; it is kept as it is, and Leaf has logged whose it is.
 */
export class StateUnreadable extends Schema.Error<StateUnreadable>("StateUnreadable")(answer("state_unreadable"), {
  httpApiStatus: 409,
}) {}

/** Coins a page asked to spend that the player does not have: nothing was changed. */
export class NotEnoughCoins extends Schema.Error<NotEnoughCoins>("NotEnoughCoins")(answer("not_enough_coins"), {
  httpApiStatus: 409,
}) {}

/** More Coins than a player may earn through a page's calls in an hour or a UTC day: nothing was changed. */
export class TooMuch extends Schema.Error<TooMuch>("TooMuch")(answer("too_much"), { httpApiStatus: 429 }) {}

/** A save to a slot whose game Leaf now plays itself, or whose numbers Leaf keeps: nothing was written. */
export class Moved extends Schema.Error<Moved>("Moved")(answer("moved"), { httpApiStatus: 410 }) {}

/** A save larger than a slot holds. */
export class SaveTooLarge extends Schema.Error<SaveTooLarge>("SaveTooLarge")(answer("save_too_large"), {
  httpApiStatus: 413,
}) {}

/** A request body longer than Leaf reads, refused unread. A save may be longer (`SaveTooLarge`). */
export class BodyTooLarge extends Schema.Error<BodyTooLarge>("BodyTooLarge")(answer("body_too_large"), {
  httpApiStatus: 413,
}) {}

/** A reroll Leaf refuses, changing nothing. */
export class Refused extends Schema.Error<Refused>("Refused")(
  answer("not_current", "not_rerollable", "cost_changed", "insufficient_leaf"),
  { httpApiStatus: 409 },
) {}

/**
 * A purchase from sequoia-backend Leaf refuses, charging nothing: the player's balance does not
 * cover it, its key was used for another purchase, or its key was cancelled.
 */
export class PurchaseRefused extends Schema.Error<PurchaseRefused>("PurchaseRefused")(
  answer("insufficient_leaf", "key_in_use", "purchase_cancelled"),
  { httpApiStatus: 409 },
) {}

/** Something nothing expected went wrong. It is logged with its cause. */
export class InternalError extends Schema.Error<InternalError>("InternalError")(answer("internal_error"), {
  httpApiStatus: 500,
}) {}

/** The backend could not be asked who the session belongs to. */
export class IdentityUnavailable extends Schema.Error<IdentityUnavailable>("IdentityUnavailable")(
  answer("identity_unavailable"),
  { httpApiStatus: 503 },
) {}
