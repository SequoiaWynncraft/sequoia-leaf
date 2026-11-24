import { createHash } from "node:crypto";

import { Cause, Duration, Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { SqlClient, SqlSchema } from "effect/sql";

import type { Embed } from "./rate-card.ts";

/**
 * Discord could not be reached, or refused the message. The message never
 * holds the webhook's address, which is a secret: anyone with it can post.
 */
export class AnnouncementError extends Schema.TaggedError<AnnouncementError>()("AnnouncementError", {
  message: Schema.String,
}) {}

/** How long one call to Discord may take. */
const TIMEOUT = Duration.seconds(10);

/** What Discord answers a webhook post made with `wait=true`: the message, of which Leaf keeps the id. */
const Posted = Schema.Struct({ id: Schema.NonEmptyString });

/** The message Leaf keeps saying something, as stored: Discord's id for it, and a digest of what it says. */
const Kept = Schema.Struct({ messageId: Schema.NonEmptyString, digest: Schema.String });

/** What a failed call to Discord says, without the request: its address carries the webhook's token. */
function safely(error: HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError): AnnouncementError {
  if (HttpClientError.isHttpClientError(error)) {
    const status = error.response?.status;
    return new AnnouncementError({
      message: status === undefined ? "Discord could not be reached" : `Discord answered ${status}`,
    });
  }
  return new AnnouncementError({
    message: Cause.isTimeoutError(error)
      ? "Discord took too long to answer"
      : "Discord answered with something unexpected",
  });
}

/** What happened to the message: posted anew, edited, or left alone because it already said this. */
export type Announced = "posted" | "edited" | "unchanged";

/**
 * Keeps one message in a Discord channel saying `embed`, through the channel's
 * webhook. The first time it posts the message; after that it edits the same
 * one when what it says changed, and otherwise only checks that it is still
 * there. A message someone deleted is posted again. Mentions are off, so
 * nothing in it pings anyone.
 */
export const announce = (name: string, webhook: Redacted.Redacted, embed: Embed, now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const body = { username: "Leaf", embeds: [embed], allowed_mentions: { parse: [] } };
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const base = Redacted.value(webhook);

    /** Sends a request about the stored message: true when Discord did it, false when the message is gone. */
    const unlessGone = (request: HttpClientRequest.HttpClientRequest) =>
      client.execute(request).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.response?.status === 404,
          () => Effect.succeed(false),
        ),
        Effect.timeout(TIMEOUT),
        Effect.mapError(safely),
      );

    const save = (messageId: string) => sql`
      INSERT INTO announcements (name, message_id, digest, updated_at)
      VALUES (${name}, ${messageId}, ${digest}, ${now})
      ON CONFLICT (name) DO UPDATE SET message_id = excluded.message_id, digest = excluded.digest, updated_at = excluded.updated_at
    `;

    const keptOf = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Kept,
      execute: (named) => sql`SELECT message_id AS messageId, digest FROM announcements WHERE name = ${named}`,
    });

    /** What became of the message kept: left alone or edited, or none when there is none, or it was deleted. */
    const kept = yield* keptOf(name).pipe(
      Effect.orDie,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: ({ messageId, digest: says }) => {
            const message = `${base}/messages/${messageId}`;
            return says === digest
              ? unlessGone(HttpClientRequest.get(message)).pipe(
                  Effect.map((there) => (there ? Option.some<Announced>("unchanged") : Option.none())),
                )
              : unlessGone(HttpClientRequest.patch(message).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
                  Effect.flatMap((there) =>
                    there ? Effect.as(save(messageId), Option.some<Announced>("edited")) : Effect.succeedNone,
                  ),
                );
          },
        }),
      ),
    );
    if (Option.isSome(kept)) {
      return kept.value;
    }
    // None posted yet, or the one posted was deleted: post a new one.

    const posted = yield* HttpClientRequest.post(base, { urlParams: { wait: "true" } }).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Posted)),
      Effect.timeout(TIMEOUT),
      Effect.mapError(safely),
    );
    yield* save(posted.id);
    return "posted" satisfies Announced;
  });
