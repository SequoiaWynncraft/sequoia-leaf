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
    const broken = testLeaf({ now: 0 }, noBackend);
    const brokenApp = broken.app();
    broken.db.close();

    const response = await brokenApp.request("/healthz");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "internal_error", message: "Something went wrong" });
    await brokenApp.dispose();
  });

  it("describes itself as an OpenAPI document, sessions included", async () => {
    const document = OpenApiDocument(await (await app.request("/openapi.json")).json());

    expect(Object.keys(document.paths).toSorted()).toEqual([
      "/healthz",
      "/v1/me",
      "/v1/me/events",
      "/v1/me/events/stream",
      "/v1/me/quests",
      "/v1/me/quests/{id}/reroll",
    ]);
    expect(Object.values(document.components.securitySchemes)).toEqual([
      expect.objectContaining({ type: "http", scheme: "Bearer" }),
    ]);
  });
});
