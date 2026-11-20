import { Schema } from "effect";

// Every error answer is `{ "code", "message" }`, with one class per status.
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

/** A request Leaf cannot read: an event id that is not one, a quest id that is not one, or a reroll without a cost. */
export class Invalid extends Schema.Error<Invalid>("Invalid")(
  answer("invalid_after", "invalid_quest", "invalid_cost"),
  { httpApiStatus: 400 },
) {}

/** A reroll Leaf refuses, changing nothing. */
export class Refused extends Schema.Error<Refused>("Refused")(
  answer("not_current", "not_rerollable", "cost_changed", "insufficient_leaf"),
  { httpApiStatus: 409 },
) {}

/** A Grove request Leaf cannot read: a body that is not what the route takes, or an offering it doesn't take. */
export class GroveInvalid extends Schema.Error<GroveInvalid>("GroveInvalid")(
  answer("invalid_request", "invalid_offering"),
  { httpApiStatus: 400 },
) {}

/** A Grove request Leaf refuses, changing nothing. */
export class GroveRefused extends Schema.Error<GroveRefused>("GroveRefused")(
  answer("insufficient_leaf", "request_conflict", "not_enough_cones", "no_charges", "no_banner", "not_owned"),
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

// The marketplace and conversions.

/**
 * A marketplace or conversion request Leaf cannot read: a body, path or query
 * that isn't what the route takes, a listing the rules don't take, or a count
 * a listing, an order or a claim can't have.
 */
export class TradeInvalid extends Schema.Error<TradeInvalid>("TradeInvalid")(
  answer("invalid_request", "invalid_listing", "invalid_count"),
  { httpApiStatus: 400 },
) {}

/** A marketplace or conversion request Leaf refuses, changing nothing. */
export class TradeRefused extends Schema.Error<TradeRefused>("TradeRefused")(
  answer(
    "insufficient_leaf",
    "request_conflict",
    "own_listing",
    "listing_closed",
    "sold_out",
    "price_changed",
    "has_open_orders",
    "too_many_listings",
    "already_delivered",
    "not_delivered",
    "not_disputed",
    "order_closed",
    "member_limit",
    "not_pending",
    "not_due",
  ),
  { httpApiStatus: 409 },
) {}

/** A request for a side of an order the member isn't, or for staff to settle what they are a side of. */
export class TradeForbidden extends Schema.Error<TradeForbidden>("TradeForbidden")(
  answer("not_seller", "not_buyer", "own_order", "own_claim"),
  { httpApiStatus: 403 },
) {}

/** No such listing, order or claim, or an order or claim that isn't the member's to see. */
export class TradeMissing extends Schema.Error<TradeMissing>("TradeMissing")(
  answer("listing_not_found", "order_not_found", "conversion_not_found"),
  { httpApiStatus: 404 },
) {}

/** A staff route, asked by someone who isn't staff. */
export class NotStaff extends Schema.Error<NotStaff>("NotStaff")(answer("not_staff"), { httpApiStatus: 403 }) {}
