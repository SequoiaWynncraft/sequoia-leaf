import { createHash } from "node:crypto";

import { Cause, Duration, Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { SqlClient } from "effect/sql";

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
 * one, and only when what it says changed. A message someone deleted is posted
 * again. Mentions are off, so nothing in it pings anyone.
 */
export const announce = (name: string, webhook: Redacted.Redacted, embed: Embed, now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const body = { username: "Leaf", embeds: [embed], allowed_mentions: { parse: [] } };
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const base = Redacted.value(webhook);

    const [stored] = yield* sql<{ message_id: string; digest: string }>`
      SELECT message_id, digest FROM announcements WHERE name = ${name}
    `;
    if (stored?.digest === digest) {
      return "unchanged" satisfies Announced;
    }

    const save = (messageId: string) => sql`
      INSERT INTO announcements (name, message_id, digest, updated_at)
      VALUES (${name}, ${messageId}, ${digest}, ${now})
      ON CONFLICT (name) DO UPDATE SET message_id = excluded.message_id, digest = excluded.digest, updated_at = excluded.updated_at
    `;

    if (stored !== undefined) {
      const edited = yield* HttpClientRequest.patch(`${base}/messages/${stored.message_id}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
        client.execute,
        Effect.as(true),
        // The message was deleted: post a new one below.
        Effect.catchIf(
          (error) => error.response?.status === 404,
          () => Effect.succeed(false),
        ),
        Effect.timeout(TIMEOUT),
        Effect.mapError(safely),
      );
      if (edited) {
        yield* save(stored.message_id);
        return "edited" satisfies Announced;
      }
    }

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
