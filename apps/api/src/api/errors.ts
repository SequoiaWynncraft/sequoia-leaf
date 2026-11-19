import { Schema } from "effect";

// Every error answer is `{ "code", "message" }` with the status on its class.
// `code` is stable and machine-readable, and clients branch on it; the message
// is for people. `Schema.Error` encodes only the fields declared here, so that
// is exactly what reaches the wire.

const answer = <const Code extends string>(code: Code) => ({ code: Schema.tag(code), message: Schema.String });

/** No session, or one the backend no longer accepts. */
export class Unauthorized extends Schema.Error<Unauthorized>("Unauthorized")(answer("unauthorized"), {
  httpApiStatus: 401,
}) {}

/** Signed in, but not a current Sequoia member. */
export class NotAMember extends Schema.Error<NotAMember>("NotAMember")(answer("not_a_member"), {
  httpApiStatus: 403,
}) {}

/** The backend could not be asked who the session belongs to. */
export class IdentityUnavailable extends Schema.Error<IdentityUnavailable>("IdentityUnavailable")(
  answer("identity_unavailable"),
  { httpApiStatus: 503 },
) {}

export class InvalidAfter extends Schema.Error<InvalidAfter>("InvalidAfter")(answer("invalid_after"), {
  httpApiStatus: 400,
}) {}

export class InvalidQuest extends Schema.Error<InvalidQuest>("InvalidQuest")(answer("invalid_quest"), {
  httpApiStatus: 400,
}) {}

export class InvalidCost extends Schema.Error<InvalidCost>("InvalidCost")(answer("invalid_cost"), {
  httpApiStatus: 400,
}) {}

/** The quest asked for is not the one in its slot any more. */
export class NotCurrent extends Schema.Error<NotCurrent>("NotCurrent")(answer("not_current"), {
  httpApiStatus: 409,
}) {}

export class NotRerollable extends Schema.Error<NotRerollable>("NotRerollable")(answer("not_rerollable"), {
  httpApiStatus: 409,
}) {}

export class CostChanged extends Schema.Error<CostChanged>("CostChanged")(answer("cost_changed"), {
  httpApiStatus: 409,
}) {}

export class InsufficientLeaf extends Schema.Error<InsufficientLeaf>("InsufficientLeaf")(answer("insufficient_leaf"), {
  httpApiStatus: 409,
}) {}

/** Something nothing expected went wrong. It is logged with its cause. */
export class InternalError extends Schema.Error<InternalError>("InternalError")(answer("internal_error"), {
  httpApiStatus: 500,
}) {}
