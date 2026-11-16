import { describe, expect, it } from "bun:test";

import { createApp } from "../src/app.ts";
import { testServices } from "./support.ts";

const app = createApp(testServices({ now: 0 }, () => Promise.reject(new Error("No backend in this test"))));

describe("HTTP", () => {
  it("reports healthy", async () => {
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers an unknown route with the standard error shape", async () => {
    const response = await app.request("/nope");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "No such route" });
  });
});
