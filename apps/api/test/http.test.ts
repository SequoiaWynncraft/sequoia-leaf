import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index.ts";

describe("HTTP", () => {
  it("reports healthy", async () => {
    const response = await app.request("/healthz", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers an unknown route with the standard error shape", async () => {
    const response = await app.request("/nope", {}, env);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "No such route" });
  });
});
