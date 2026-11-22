import type { RequestKind } from "@sequoia-leaf/core";
import { Duration, Effect, type Redacted, Schema } from "effect";
import { type HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

/**
 * The guild's requests (an aspect or a tome), as the backend's reward queue (`/api/reward-queue`)
 * answers the member, asked with their own session: whether they may pay Leaf for one, and making
 * one. The backend decides and charges, by buying the request from Leaf's own
 * `/internal/v1/purchases`; here Leaf only asks and passes the answer on. Nothing here touches
 * Leaf's database, so nothing of it is held open while the backend answers and calls back.
 */

/** What the website sends as its mod version: the backend's version gate reads one on every `/api` route. */
const MOD_VERSION = "1.6.8";

/** How long Leaf waits for whether the member may pay: the backend asks Discord (up to 3 seconds) and Leaf (1.5). */
const LOOK_FOR = Duration.seconds(10);

/**
 * How long Leaf waits for a request to be made. The backend waits up to 7 seconds for Leaf to charge
 * it (2 to connect, 5 for the answer), as long again to cancel a charge it could not keep, and then
 * posts the request in Discord. Leaf waits longer than all of that, so that the backend's answer, not
 * Leaf's patience, says what happened.
 */
const MAKE_FOR = Duration.seconds(30);

/** The parts of the backend's eligibility answer about paying Leaf. */
const Eligibility = Schema.Struct({
  leaf_eligible: Schema.Boolean,
  in_guild: Schema.Boolean,
  in_guild_time_in_days: Schema.Number,
  required_days: Schema.Number,
  prices: Schema.Struct({ aspect: Schema.Number, tome: Schema.Number }),
});

/** The parts of the backend's answer to a request made that the member is told. */
const Created = Schema.Struct({ position: Schema.Number, leaf_paid: Schema.Number });

/** The backend's words for a refusal, where its answer has them. */
const Said = Schema.Struct({ message: Schema.NonEmptyString });

export type Looked =
  /** `whyNot` is why the member may not pay for either now, or null when they may. */
  | { readonly status: "ok"; readonly whyNot: string | null; readonly prices: Readonly<Record<RequestKind, number>> }
  | { readonly status: "refused"; readonly message: string }
  | { readonly status: "unavailable" };

export type Made =
  | { readonly status: "made"; readonly position: number; readonly paid: number }
  /** Not made, and nothing taken. */
  | { readonly status: "refused"; readonly message: string }
  /** No answer that says: it may have been made, and must not be sent again. */
  | { readonly status: "unknown" };

/** The backend's own words where it says why it will not take a member's Leaf. */
const NOT_A_MEMBER = "Paying Leaf for a request is for current Sequoia members.";
const NOT_LINKED = "This queue requires a linked Minecraft account. Use /link with your Minecraft username first.";
const SIGN_IN = "Your session has expired. Sign in again";

/** A number as the backend writes Leaf: 3,000. */
const leafText = (n: number): string => n.toLocaleString("en-US");

/** Why a member with `balance` Leaf cannot pay `price` for a request, in the backend's words. */
export const notEnoughLeaf = (kind: RequestKind, price: number, balance: number): string =>
  `${kind === "aspect" ? "An aspect" : "A tome"} request costs ${leafText(price)} Leaf. You have ${leafText(balance)}.`;

/**
 * The backend's reason for a refusal. Its errors' bodies may come without words (Spring leaves them
 * out unless told otherwise), so `otherwise` stands in, in its words where it has some.
 */
const reasonOf = (response: HttpClientResponse.HttpClientResponse, otherwise: string) =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Said)),
    Effect.map((said) => said.message.trim() || otherwise),
    Effect.orElseSucceed(() => otherwise),
  );

/** The backend's reward queue, asked by `client` at `backendUrl`, as the member whose session is given. */
export function guildRequests(client: HttpClient.HttpClient, backendUrl: string) {
  const asMember = (request: HttpClientRequest.HttpClientRequest, session: Redacted.Redacted) =>
    client.execute(
      request.pipe(
        HttpClientRequest.bearerToken(session),
        HttpClientRequest.setHeader("x-sequoia-mod-version", MOD_VERSION),
        HttpClientRequest.acceptJson,
      ),
    );

  return {
    /** Whether the member may pay Leaf for a request now, and what each costs. */
    look: (session: Redacted.Redacted): Effect.Effect<Looked> =>
      asMember(HttpClientRequest.get(new URL("/api/reward-queue/eligibility", backendUrl)), session).pipe(
        Effect.flatMap((response): Effect.Effect<Looked, unknown> => {
          if (response.status >= 400 && response.status < 500) {
            const otherwise = response.status === 401 ? SIGN_IN : NOT_LINKED;
            return Effect.map(reasonOf(response, otherwise), (message) => ({ status: "refused", message }));
          }
          if (response.status !== 200) {
            return Effect.succeed({ status: "unavailable" });
          }
          return response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Eligibility)),
            Effect.map((e) => ({
              status: "ok",
              whyNot: e.leaf_eligible
                ? null
                : e.in_guild
                  ? `You need ${e.required_days} days in the guild. You have ${e.in_guild_time_in_days}.`
                  : NOT_A_MEMBER,
              prices: e.prices,
            })),
          );
        }),
        Effect.timeout(LOOK_FOR),
        Effect.catch((error) =>
          Effect.logWarning(`The backend could not be asked about the guild's requests: ${whatOf(error)}`).pipe(
            Effect.as<Looked>({ status: "unavailable" }),
          ),
        ),
      ),

    /** Makes a request paid with Leaf: the backend charges the member, or says why not. */
    make: (session: Redacted.Redacted, kind: RequestKind, reason: string | null): Effect.Effect<Made> =>
      asMember(
        HttpClientRequest.post(new URL("/api/reward-queue/requests", backendUrl)).pipe(
          HttpClientRequest.bodyJsonUnsafe({ type: kind, ...(reason === null ? {} : { reason }), pay_with_leaf: true }),
        ),
        session,
      ).pipe(
        Effect.flatMap((response): Effect.Effect<Made, unknown> => {
          // A refusal, or nothing there to make it (503): nothing was made or taken.
          if ((response.status >= 400 && response.status < 500) || response.status === 503) {
            const otherwise =
              response.status === 401
                ? SIGN_IN
                : response.status === 409
                  ? `You already have a pending ${kind} request in the queue.`
                  : "The request was not made.";
            return Effect.map(reasonOf(response, otherwise), (message) => ({ status: "refused", message }));
          }
          if (response.status !== 201) {
            return Effect.fail(`answered ${response.status}`);
          }
          return response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Created)),
            Effect.map((created) => ({ status: "made", position: created.position, paid: created.leaf_paid })),
          );
        }),
        Effect.timeout(MAKE_FOR),
        Effect.catch((error) =>
          Effect.logWarning(`Whether a ${kind} request was made is not known: ${whatOf(error)}`).pipe(
            Effect.as<Made>({ status: "unknown" }),
          ),
        ),
      ),
  };
}

/**
 * What went wrong, for a log line: its message (a failed request's names its method and address),
 * never the request itself, which carries the member's session.
 */
const whatOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
