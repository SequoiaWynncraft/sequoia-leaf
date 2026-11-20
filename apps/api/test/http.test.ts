import { describe, expect, it } from "bun:test";

import { Schema } from "effect";

import { testLeaf } from "./support.ts";

/** The parts of an OpenAPI document these tests read. */
const OpenApiDocument = Schema.decodeUnknownSync(
  Schema.Struct({
    paths: Schema.Record(Schema.String, Schema.Unknown),
    components: Schema.Struct({
      securitySchemes: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String, scheme: Schema.String })),
    }),
  }),
);

const noBackend = () => Promise.reject(new Error("No backend in this test"));
const app = testLeaf({ now: 0 }, noBackend).app();

describe("HTTP", () => {
  it("reports healthy", async () => {
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers an unknown route with the standard error shape", async () => {
    const requests = [
      ["/nope", "GET"],
      ["/", "GET"],
      ["/healthz/", "GET"],
      ["/healthz", "POST"],
    ] as const;
    const answers = await Promise.all(
      requests.map(async ([path, method]) => {
        const response = await app.request(path, { method });
        return [response.status, await response.json()];
      }),
    );

    expect(answers).toEqual(requests.map(() => [404, { code: "not_found", message: "No such route" }]));
  });

  it("answers a failure nothing expected with the standard error shape", async () => {
    // A backend that confirms any session as a member's.
    const broken = testLeaf({ now: 0 }, () =>
      Promise.resolve(
        Response.json({
          minecraft_uuid: "10000000-0000-0000-0000-000000000001",
          minecraft_username: "Alice",
          guild_rank: "Member",
        }),
      ),
    );
    const brokenApp = broken.app();
    await broken.query((sql) => sql`DROP TABLE accounts`);

    const response = await brokenApp.request("/v1/me", { headers: { Authorization: "Bearer alice-token" } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "internal_error", message: "Something went wrong" });
    await brokenApp.dispose();
    await broken.dispose();
  });

  it("describes itself as an OpenAPI document, sessions included", async () => {
    const document = OpenApiDocument(await (await app.request("/openapi.json")).json());

    expect(Object.keys(document.paths).toSorted()).toEqual([
      "/healthz",
      "/v1/conversions",
      "/v1/conversions/rates",
      "/v1/conversions/{id}/cancel",
      "/v1/grove",
      "/v1/grove/care",
      "/v1/grove/companion",
      "/v1/grove/cones/buy",
      "/v1/grove/cones/open",
      "/v1/grove/forest",
      "/v1/grove/great",
      "/v1/grove/great/offer",
      "/v1/grove/rates",
      "/v1/market/listings",
      "/v1/market/listings/{id}",
      "/v1/market/listings/{id}/buy",
      "/v1/market/listings/{id}/withdraw",
      "/v1/market/my-listings",
      "/v1/market/orders",
      "/v1/market/orders/{id}",
      "/v1/market/orders/{id}/cancel",
      "/v1/market/orders/{id}/confirm",
      "/v1/market/orders/{id}/deliver",
      "/v1/market/orders/{id}/dispute",
      "/v1/me",
      "/v1/me/events",
      "/v1/me/events/stream",
      "/v1/me/quests",
      "/v1/me/quests/{id}/reroll",
      "/v1/staff/conversions",
      "/v1/staff/conversions/{id}/decline",
      "/v1/staff/conversions/{id}/pay",
      "/v1/staff/market/disputes",
      "/v1/staff/market/orders/{id}/resolve",
    ]);
    expect(Object.values(document.components.securitySchemes)).toEqual([
      expect.objectContaining({ type: "http", scheme: "Bearer" }),
    ]);
  });
});
