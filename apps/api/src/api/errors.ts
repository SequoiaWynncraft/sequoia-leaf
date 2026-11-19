import { Schema } from "effect";
import type { YieldableError } from "effect/Cause";

/**
 * An error answer, `{ "code", "message" }` with `status`. `code` is stable and
 * machine-readable, and clients branch on it; the message is for people.
 *
 * Built on `Schema.Error`, which encodes only the declared fields, so no
 * `_tag` reaches the wire. The tag sits on the prototype, so `Effect.catchTag`
 * still tells the errors apart.
 */
function apiError<Self>() {
  return <const Tag extends string, const Code extends string>(
    tag: Tag,
    code: Code,
    status: number,
  ): Schema.Class<
    Self,
    Schema.Struct<{ readonly code: Schema.tag<Code>; readonly message: typeof Schema.String }>,
    YieldableError & { readonly _tag: Tag }
  > => {
    const Base = Schema.Error<unknown>(tag)(
      { code: Schema.tag(code), message: Schema.String },
      { httpApiStatus: status, description: `${status} ${code}` },
    );
    Object.defineProperty(Base.prototype, "_tag", { value: tag });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the prototype now carries the tag the type promises
    return Base as never;
  };
}

/** No session, or one the backend no longer accepts. */
export class Unauthorized extends apiError<Unauthorized>()("Unauthorized", "unauthorized", 401) {}
/** Signed in, but not a current Sequoia member. */
export class NotAMember extends apiError<NotAMember>()("NotAMember", "not_a_member", 403) {}
/** The backend could not be asked who the session belongs to. */
export class IdentityUnavailable extends apiError<IdentityUnavailable>()(
  "IdentityUnavailable",
  "identity_unavailable",
  503,
) {}

export class InvalidAfter extends apiError<InvalidAfter>()("InvalidAfter", "invalid_after", 400) {}
export class InvalidQuest extends apiError<InvalidQuest>()("InvalidQuest", "invalid_quest", 400) {}
export class InvalidCost extends apiError<InvalidCost>()("InvalidCost", "invalid_cost", 400) {}

/** The quest asked for is not the one in its slot any more. */
export class NotCurrent extends apiError<NotCurrent>()("NotCurrent", "not_current", 409) {}
export class NotRerollable extends apiError<NotRerollable>()("NotRerollable", "not_rerollable", 409) {}
export class CostChanged extends apiError<CostChanged>()("CostChanged", "cost_changed", 409) {}
export class InsufficientLeaf extends apiError<InsufficientLeaf>()("InsufficientLeaf", "insufficient_leaf", 409) {}
