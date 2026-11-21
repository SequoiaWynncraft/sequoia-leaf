import { beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_RULES, RULE_CHANGES } from "@sequoia-leaf/core";
import { Redacted } from "effect";

import { announce, AnnouncementError } from "../src/announce/publish.ts";
import { type Embed, rateCard } from "../src/announce/rate-card.ts";
import { type Fetcher, rejection, testLeaf } from "./support.ts";

const T0 = Date.UTC(2026, 10, 21, 12);
const WEBHOOK = "https://discord.test/api/webhooks/123/secret-token";

const card = rateCard(DEFAULT_RULES, RULE_CHANGES);

/** The text of the rate card's field with this name. */
const value = (name: string) => card.fields.find((field) => field.name === name)?.value ?? "";

describe("rateCard", () => {
  // When this fails, the rates changed: check the card says what you meant, add a
  // line to RULE_CHANGES for members, and update the snapshot with `bun test -u`.
  it("says what Leaf pays under the rules it runs with", () => {
    expect(card).toMatchSnapshot();
  });

  it("fits in one Discord embed", () => {
    const size = [card.title, card.description, card.footer.text, ...card.fields.flatMap((f) => [f.name, f.value])]
      .map((text) => text.length)
      .reduce((a, b) => a + b, 0);
    expect(size).toBeLessThanOrEqual(6000);
    expect(card.description.length).toBeLessThanOrEqual(4096);
    expect(card.fields.length).toBeLessThanOrEqual(25);
    for (const field of card.fields) {
      expect(field.name.length).toBeLessThanOrEqual(256);
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it("pays raids by gambits and wars by war points, at the rules' rates", () => {
    expect(value("Raids")).toStartWith("**110 / 80 / 60 / 50** Leaf for 3 / 2 / 1 / 0 gambits");
    expect(value("Wars")).toBe(
      "**0.5** Leaf per war point in FFA wars and snipes, **1** per war point when we take back our own claim.",
    );
    expect(value("Raid milestones")).toBe(
      "Bronze **1,000** · Silver **1,500** · Gold **2,500** · Platinum **10,000** · Diamond **15,000** · Obsidian **30,000** · Mythril **50,000**. No XP.",
    );
  });

  it("lists a quest that any of the raids can name once", () => {
    const daily = card.fields.find((field) => field.name === "Daily quests")?.value ?? "";
    expect(daily.split("\n").filter((line) => line.includes("3 of one raid or 9 wars"))).toHaveLength(1);
  });

  it("lists the latest changes, newest first, and dates the card by the latest", () => {
    const changes = [
      { date: "2026-11-21", text: "Newest." },
      { date: "2026-11-19", text: "Older." },
    ];
    const dated = rateCard(DEFAULT_RULES, changes);
    expect(dated.fields.at(-1)).toEqual({ name: "Recent changes", value: "**21 Nov**: Newest.\n**19 Nov**: Older." });
    expect(dated.timestamp).toBe("2026-11-21T00:00:00.000Z");
  });
});

/** A request body as text: Effect sends JSON as bytes. */
function bodyText(body: NonNullable<RequestInit["body"]>): string {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new Error("Expected a JSON body");
}

/** A rate card with no changes listed, under a title that tells versions apart. */
const embed = (title: string): Embed => ({ ...rateCard(DEFAULT_RULES, []), title });

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

describe("announce", () => {
  let sent: Sent[];
  let answer: (request: Sent) => Response;
  let leaf: ReturnType<typeof testLeaf>;

  const discord: Fetcher = (url, init) => {
    const request = {
      method: init.method ?? "GET",
      url,
      body: init.body === undefined || init.body === null ? undefined : JSON.parse(bodyText(init.body)),
    };
    sent.push(request);
    return Promise.resolve(answer(request));
  };

  const run = (message: Embed, now = T0) => leaf.run(announce("rates", Redacted.make(WEBHOOK), message, now));

  beforeEach(() => {
    sent = [];
    answer = () => Response.json({ id: "m1" });
    leaf = testLeaf({ now: T0 }, discord);
  });

  it("posts the message the first time, with mentions off, and waits for its id", async () => {
    expect(await run(embed("Leaf rates"))).toBe("posted");

    expect(sent).toEqual([
      {
        method: "POST",
        url: `${WEBHOOK}?wait=true`,
        body: { username: "Leaf", embeds: [embed("Leaf rates")], allowed_mentions: { parse: [] } },
      },
    ]);
  });

  it("leaves the message alone while it says the same, after checking it is still there", async () => {
    await run(embed("Leaf rates"));

    expect(await run(embed("Leaf rates"), T0 + 1)).toBe("unchanged");

    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${WEBHOOK}?wait=true`,
      `GET ${WEBHOOK}/messages/m1`,
    ]);
  });

  it("posts the message again when someone deleted it, though it says the same", async () => {
    await run(embed("Leaf rates"));
    answer = (request) =>
      request.method === "GET"
        ? Response.json({ message: "Unknown Message" }, { status: 404 })
        : Response.json({ id: "m2" });

    expect(await run(embed("Leaf rates"))).toBe("posted");

    expect(sent.map((request) => request.method)).toEqual(["POST", "GET", "POST"]);
    answer = () => Response.json({ id: "m2" });
    await run(embed("New rates"));
    expect(sent.at(-1)).toMatchObject({ method: "PATCH", url: `${WEBHOOK}/messages/m2` });
  });

  it("edits the same message when what it says changes", async () => {
    await run(embed("Leaf rates"));

    expect(await run(embed("New rates"))).toBe("edited");

    expect(sent.at(-1)).toMatchObject({ method: "PATCH", url: `${WEBHOOK}/messages/m1` });
    expect(await run(embed("New rates"))).toBe("unchanged");
  });

  it("posts the message again when someone deleted it", async () => {
    await run(embed("Leaf rates"));
    answer = (request) =>
      request.method === "PATCH"
        ? Response.json({ message: "Unknown Message" }, { status: 404 })
        : Response.json({ id: "m2" });

    expect(await run(embed("New rates"))).toBe("posted");

    expect(sent.map((request) => request.method)).toEqual(["POST", "PATCH", "POST"]);
    answer = () => Response.json({ id: "m2" });
    await run(embed("Newer rates"));
    expect(sent.at(-1)).toMatchObject({ method: "PATCH", url: `${WEBHOOK}/messages/m2` });
  });

  it("fails without the webhook's token in what it says, and tries again next time", async () => {
    answer = () => Response.json({ message: "Missing Permissions" }, { status: 403 });

    const error = await rejection(run(embed("Leaf rates")));

    expect(error).toBeInstanceOf(AnnouncementError);
    expect(String(error)).not.toContain("secret-token");
    expect(JSON.stringify(error)).not.toContain("secret-token");
    answer = () => Response.json({ id: "m1" });
    expect(await run(embed("Leaf rates"))).toBe("posted");
  });
});
