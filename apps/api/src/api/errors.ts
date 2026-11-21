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

/**
 * A write signed in with the session cookie that did not come from Leaf's own
 * pages. Another site can make a browser send the cookie, but not that `Origin`.
 */
export class BadOrigin extends Schema.Error<BadOrigin>("BadOrigin")(answer("bad_origin"), { httpApiStatus: 403 }) {}

/**
 * A request Leaf cannot read: an event id that is not one, a quest id that is
 * not one, a reroll without a cost, a save slot that is not one, a save that is
 * not `{ "version", "data" }` with an object as its data, a player id that is
 * not a UUID, or a place in town that is not one.
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
  ),
  { httpApiStatus: 400 },
) {}

/** Nothing there: a slot the member has never saved to, or a player with no skin Leaf can find. */
export class Missing extends Schema.Error<Missing>("Missing")(answer("no_save", "no_skin"), { httpApiStatus: 404 }) {}

/** A save written over a version other than the one stored, changing nothing. */
export class VersionConflict extends Schema.Error<VersionConflict>("VersionConflict")(answer("version_conflict"), {
  httpApiStatus: 409,
}) {}

/** A save larger than a slot holds. */
export class SaveTooLarge extends Schema.Error<SaveTooLarge>("SaveTooLarge")(answer("save_too_large"), {
  httpApiStatus: 413,
}) {}

/** A reroll Leaf refuses, changing nothing. */
export class Refused extends Schema.Error<Refused>("Refused")(
  answer("not_current", "not_rerollable", "cost_changed", "insufficient_leaf"),
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
