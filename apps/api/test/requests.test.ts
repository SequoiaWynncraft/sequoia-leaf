import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, playerId } from "@sequoia-leaf/core";
import { Effect, Fiber, Layer, Logger, Redacted, References } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { TestClock } from "effect/testing";

import { guildRequests } from "../src/backend/requests.ts";
import {
  type Backend,
  fakeBackend,
  type LogLine,
  type Queued,
  rewardQueue,
  sessionOf,
  testLeaf,
  unanswered,
} from "./support.ts";

/**
 * The Treasury's guild requests (`/v1/game/requests`): Leaf asks the backend's reward queue as the
 * member, and the backend charges them through Leaf's own purchase route.
 */

const alice = playerId("10000000-0000-0000-0000-000000000001");
const visitor = playerId("10000000-0000-0000-0000-000000000003");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";
const LOST = "Could not tell whether the request went through. Check the queue in Discord before trying again.";

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;
let backend: Backend;
let queued: Queued;
/** What the backend was sent under `/api`, in order: where, with which session and version, and the body. */
let asked: { url: string; session: string | null; version: string | null; body: unknown }[];
/** Leaf's warnings and errors. */
let logged: LogLine[];
/** What Leaf logged, with this message, of a backend that gave it no answer it could use. */
const warned = (message: string) => logged.filter((line) => line.message === message).map((line) => line.annotations);

/** Notes down what the backend was sent. */
async function note(request: Request): Promise<void> {
  const body: unknown = request.method === "POST" ? await request.clone().json() : null;
  const header = (name: string) => request.headers.get(name);
  asked.push({ url: request.url, session: header("Authorization"), version: header("X-Sequoia-Mod-Version"), body });
}

beforeEach(async () => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice")),
    "visitor-token": () => Response.json(sessionOf(visitor, "Visitor", null)),
  });
  backend = fake.backend;
  logged = [];
  services = testLeaf(clock, fake.fetcher, {}, { logged });
  app = services.app();
  const queue = rewardQueue("alice-token", alice, (path, init) => app.request(path, init));
  queued = queue.queued;
  asked = [];
  backend.api = async (request) => {
    await note(request);
    return queue.api(request);
  };
  await services.post(
    { kind: "earn", playerId: alice, amount: leaf(5000), source: "staff", idempotencyKey: "staff:grant" },
    T0,
  );
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

/** A call as the town's page makes it: the website's cookie, from Leaf's own page. */
async function call(method: string, body?: unknown, session = "alice-token") {
  const response = await app.request("/v1/game/requests", {
    method,
    headers: { Cookie: `seq_session=${session}`, Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const balance = async () => (await services.account(alice)).balance;

/** Gives Alice `amount` more Leaf, from the guild's staff. */
const grant = (amount: number) =>
  services.post(
    { kind: "earn", playerId: alice, amount: leaf(amount), source: "staff", idempotencyKey: `staff:grant:${amount}` },
    T0,
  );

describe("what the Treasury offers", () => {
  it("asks the backend as the member, and offers each at its price, LE at the backend's rate and minimum", async () => {
    // 6,400 Leaf: just enough for the fewest LE the backend sells.
    await grant(1400);
    expect(await call("GET")).toEqual({
      status: 200,
      body: {
        aspect: { price: 3000, why_not: null },
        tome: { price: 3000, why_not: null },
        le: { price: 200, minimum: 32, why_not: null },
      },
    });
    expect(asked).toEqual([
      {
        url: "https://backend.test/api/reward-queue/eligibility",
        session: "Bearer alice-token",
        version: "1.6.8",
        body: null,
      },
    ]);
  });

  it("says why not, as each reason stands", async () => {
    queued.days = 3;
    const tenure = "You need 7 days in the guild. You have 3.";
    expect((await call("GET")).body).toEqual({
      aspect: { price: 3000, why_not: tenure },
      tome: { price: 3000, why_not: tenure },
      le: { price: 200, minimum: 32, why_not: tenure },
    });

    // Enough for an aspect or a tome, and not for 32 LE.
    queued.days = 30;
    expect((await call("GET")).body).toMatchObject({
      aspect: { why_not: null },
      tome: { why_not: null },
      le: { why_not: "32 LE costs 6,400 Leaf. You have 5,000." },
    });

    await services.post({ kind: "spend", playerId: alice, amount: leaf(3800), sink: "shop", idempotencyKey: "s" }, T0);
    expect((await call("GET")).body).toEqual({
      aspect: { price: 3000, why_not: "An aspect request costs 3,000 Leaf. You have 1,200." },
      tome: { price: 3000, why_not: "A tome request costs 3,000 Leaf. You have 1,200." },
      le: { price: 200, minimum: 32, why_not: "32 LE costs 6,400 Leaf. You have 1,200." },
    });

    backend.api = () =>
      Response.json({ ...eligibility(), in_guild: false, leaf_eligible: false, in_guild_time_in_days: 40 });
    const notAMember = "Paying Leaf for a request is for current Sequoia members.";
    expect((await call("GET")).body).toEqual({
      aspect: { price: 3000, why_not: notAMember },
      tome: { price: 3000, why_not: notAMember },
    });
  });

  it("offers no LE where the backend's answer has none, as a backend from before LE answers", async () => {
    await grant(10_000);
    backend.api = () => Response.json(eligibility());
    expect(await call("GET")).toEqual({
      status: 200,
      body: { aspect: { price: 3000, why_not: null }, tome: { price: 3000, why_not: null } },
    });
  });

  it("passes on the backend's refusal in its words, and its words for it where the answer has none", async () => {
    const alt = "`Alice2` is an alternate account. Aspect and tome requests use `Alice`.";
    backend.api = () => Response.json({ status: 403, message: alt }, { status: 403 });
    expect(await call("GET")).toEqual({ status: 409, body: { code: "request_refused", message: alt } });

    // Spring's own error body, which leaves the reason out unless told otherwise.
    backend.api = () =>
      Response.json({ status: 403, error: "Forbidden", path: "/api/reward-queue/eligibility" }, { status: 403 });
    expect((await call("GET")).body).toEqual({
      code: "request_refused",
      message: "This queue requires a linked Minecraft account. Use /link with your Minecraft username first.",
    });
  });

  it.each([
    ["cannot be reached", () => Promise.reject(new Error("connection refused")), { reason: "unreachable" }],
    ["answers 500", () => new Response("oops", { status: 500 }), { reason: "unexpected_status", status: 500 }],
    ["answers what it does not send", () => Response.json({ eligible: true }), { reason: "schema_mismatch" }],
  ])("says the requests could not be reached when the backend %s, and logs why", async (_, answer, why) => {
    backend.api = answer;
    expect(await call("GET")).toEqual({
      status: 503,
      body: {
        code: "requests_unavailable",
        message: "The guild's requests could not be reached. Try again in a moment.",
      },
    });
    expect(warned("The backend could not be asked about the guild's requests")).toEqual([
      { route: "/api/reward-queue/eligibility", ...why },
    ]);
  });
});

describe("buying a request", () => {
  it("is charged by the backend through Leaf's own purchase route, while Leaf waits holding nothing", async () => {
    // The stand-in buys it from Leaf before it answers: were Leaf holding its database meanwhile,
    // that purchase would wait on it, and this would not answer at all.
    expect(await call("POST", { type: "aspect" })).toEqual({
      status: 200,
      body: { type: "aspect", position: 2, leaf_paid: 3000, leaf: 2000 },
    });
    expect(await balance()).toBe(2000);
    expect(asked.at(-1)).toMatchObject({
      session: "Bearer alice-token",
      body: { type: "aspect", pay_with_leaf: true },
    });
  });

  it("says Leaf's word on the purse beside its answer, as /v1/game/me has it after the spend", async () => {
    const cookie = { Cookie: "seq_session=alice-token", Origin: ORIGIN, "Content-Type": "application/json" };
    const bought = await app.request("/v1/game/requests", {
      method: "POST",
      headers: cookie,
      body: JSON.stringify({ type: "aspect" }),
    });
    const said: unknown = JSON.parse(bought.headers.get("Leaf-Purse") ?? "null");
    const me = Object(await (await app.request("/v1/game/me", { headers: cookie })).json());
    expect(said).toEqual({ coins: me.coins, leaf: 2000, version: me.version });
  });

  it("sends a tome's reason as the member wrote it, and wants one", async () => {
    expect((await call("POST", { type: "tome" })).body).toEqual({
      code: "invalid_reason",
      message: "A tome request needs what the tome is for, 1 to 1,000 characters",
    });
    expect((await call("POST", { type: "tome", reason: "x".repeat(1001) })).status).toBe(400);
    expect((await call("POST", { type: "emerald" })).body).toMatchObject({ code: "invalid_request" });
    expect(asked).toEqual([]);

    expect((await call("POST", { type: "tome", reason: "  For the war tower  " })).status).toBe(200);
    expect(asked.at(-1)?.body).toEqual({ type: "tome", reason: "For the war tower", pay_with_leaf: true });
  });

  it("sends how many LE, and the backend charges that many at its rate", async () => {
    await grant(5000);
    expect(await call("POST", { type: "le", amount: 40 })).toEqual({
      status: 200,
      body: { type: "le", position: 2, leaf_paid: 8000, leaf: 2000 },
    });
    expect(asked.at(-1)).toMatchObject({
      session: "Bearer alice-token",
      body: { type: "le", amount: 40, pay_with_leaf: true },
    });
    expect(await balance()).toBe(2000);
  });

  it("wants a whole number of LE, 1 or more, and leaves how few to the backend, in its words", async () => {
    const answers = await Promise.all(
      [{ type: "le", amount: 32.5 }, { type: "le", amount: 0 }, { type: "le", amount: "32" }, { type: "le" }].map(
        (body) => call("POST", body),
      ),
    );
    expect(answers.map((a) => a.status)).toEqual([400, 400, 400, 400]);
    for (const answer of answers) {
      expect(answer.body).toEqual({
        code: "invalid_request",
        message:
          'Send a request as { "type": "aspect" }, { "type": "tome", "reason": "<what it is for>" } or { "type": "le", "amount": <whole LE, 1 or more> }',
      });
    }
    expect(asked).toEqual([]);

    expect(await call("POST", { type: "le", amount: 10 })).toEqual({
      status: 409,
      body: { code: "request_refused", message: "Ask for at least 32 LE, in whole LE." },
    });
    expect((await call("POST", { type: "le", amount: 40 })).body).toEqual({
      code: "request_refused",
      message: "40 LE costs 8,000 Leaf, and you don't have that much.",
    });
    expect(await balance()).toBe(5000);
    // One waiting already, said with no words in the body: the backend's words for it.
    backend.api = () => Response.json({ status: 409, error: "Conflict" }, { status: 409 });
    expect((await call("POST", { type: "le", amount: 32 })).body).toEqual({
      code: "request_refused",
      message: "You already have a pending LE request in the queue.",
    });
  });

  it("passes on each refusal, and takes nothing", async () => {
    await call("POST", { type: "aspect" });
    // One of that kind already waiting: 409.
    expect(await call("POST", { type: "aspect" })).toEqual({
      status: 409,
      body: { code: "request_refused", message: "You already have a pending aspect request in the queue." },
    });
    // Not enough Leaf, which Leaf refused and the backend cancelled: 403.
    expect((await call("POST", { type: "tome", reason: "A tower" })).body).toEqual({
      code: "request_refused",
      message: "A tome request costs 3,000 Leaf, and you don't have that much.",
    });
    expect(await balance()).toBe(2000);
    // Leaf or Discord out of reach for the backend: 503, in its words.
    const unreachable = "Leaf can't be reached right now, so the request wasn't made. Try again in a moment.";
    backend.api = () => Response.json({ message: unreachable }, { status: 503 });
    // It may be tried again, so it is not a refusal: 503, as the backend answered.
    expect(await call("POST", { type: "tome", reason: "A tower" })).toEqual({
      status: 503,
      body: { code: "requests_unavailable", message: unreachable },
    });
    // The same with no words in the body: Leaf says nothing was taken and to try again.
    backend.api = () => Response.json({ status: 503, error: "Service Unavailable" }, { status: 503 });
    expect((await call("POST", { type: "tome", reason: "A tower" })).body).toEqual({
      code: "requests_unavailable",
      message: "The guild's server could not take the Leaf just now. No Leaf was taken. Try again in a minute.",
    });
    // A refusal whose body has no words: the backend's words for that answer.
    backend.api = () => Response.json({ status: 409, error: "Conflict" }, { status: 409 });
    expect((await call("POST", { type: "tome", reason: "A tower" })).body).toEqual({
      code: "request_refused",
      message: "You already have a pending tome request in the queue.",
    });
  });

  it.each([
    ["is cut off", () => Promise.reject(new Error("connection reset")), { reason: "unreachable" }],
    ["is a 502", () => new Response("Bad Gateway", { status: 502 }), { reason: "unexpected_status", status: 502 }],
    ["is not what the backend sends", () => new Response("not json", { status: 201 }), { reason: "schema_mismatch" }],
  ])("says it cannot tell when the answer %s, logs why, and does not send it again", async (_, answer, why) => {
    backend.api = async (request) => {
      await note(request);
      return answer();
    };
    expect(await call("POST", { type: "aspect" })).toEqual({
      status: 504,
      body: { code: "request_unknown", message: LOST },
    });
    expect(asked).toHaveLength(1);
    expect(warned("Whether a request was made is not known")).toEqual([
      { route: "/api/reward-queue/requests", ...why, kind: "aspect" },
    ]);
  });

  it("is for members: a guest's page never reaches the backend", async () => {
    const guestsLine = { code: "members_only", message: "For guild members with 7 days in the guild." };
    expect(await call("GET", undefined, "visitor-token")).toEqual({ status: 403, body: guestsLine });
    expect(await call("POST", { type: "aspect" }, "visitor-token")).toEqual({ status: 403, body: guestsLine });
    expect(backend.calls.filter((path) => path.startsWith("/api/"))).toEqual([]);
  });
});

/** The backend's eligibility answer for a member who may pay. */
function eligibility() {
  return {
    eligible: false,
    in_guild: true,
    in_guild_time_in_days: 30,
    required_days: 7,
    leaf_eligible: true,
    leaf_balance: null,
    prices: { tome: 3000, aspect: 3000 },
  };
}

/** The relay alone, asking through `fetch`, with what it logs written down in `lines`. */
function relay(fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, lines: LogLine[]) {
  const fetched = Layer.succeed(FetchHttpClient.Fetch)(
    Object.assign(fetch, { preconnect: globalThis.fetch.preconnect }),
  );
  const writer = Logger.map(Logger.formatStructured, (line) => void lines.push(line));
  return <A>(use: (requests: ReturnType<typeof guildRequests>) => Effect.Effect<A>) =>
    Effect.gen(function* () {
      return yield* use(guildRequests(yield* HttpClient.HttpClient, "https://backend.test"));
    }).pipe(
      Effect.provide(FetchHttpClient.layer.pipe(Layer.provide(fetched))),
      Effect.provide(Logger.layer([writer])),
      Effect.provideService(References.MinimumLogLevel, "All"),
    );
}

describe("the relay", () => {
  const session = Redacted.make("secret-session-token");

  it("never writes the member's session in a log", async () => {
    const lines: LogLine[] = [];
    const ask = relay(() => Promise.reject(new Error("connection reset")), lines);
    const looked = await Effect.runPromise(ask((r) => r.look(session)));
    const made = await Effect.runPromise(ask((r) => r.make(session, { type: "aspect" })));

    expect([looked, made]).toEqual([{ status: "unavailable" }, { status: "unknown" }]);
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain("secret-session-token");
  });

  it("waits longer than the backend waits for Leaf, twice over, before giving up, and logs it as a timeout", async () => {
    const lines: LogLine[] = [];
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const making = yield* Effect.forkChild(relay(unanswered, lines)((r) => r.make(session, { type: "aspect" })));
        yield* TestClock.adjust("20 seconds");
        const after20 = making.pollUnsafe();
        yield* TestClock.adjust("11 seconds");
        return { after20, after31: yield* Fiber.join(making) };
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(outcome).toEqual({ after20: undefined, after31: { status: "unknown" } });
    expect(lines.map((line) => line.annotations)).toEqual([
      { route: "/api/reward-queue/requests", reason: "timeout", kind: "aspect" },
    ]);
  });
});
