import { expect, test } from "bun:test";

import { Glob } from "bun";

/**
 * The routes' handlers answer with the values their endpoints declare, which the endpoints encode,
 * so a schema's checks and headers hold for every answer. A response made by hand goes past them,
 * and is for what is not JSON alone: these, each where it is made.
 */
const TRANSPORT = [
  { file: "routes/people.ts", made: "uint8Array", why: "a skin is a picture" },
  { file: "routes/shared.ts", made: "stream", why: "server-sent events" },
  { file: "routes/shared.ts", made: "text", why: "the guild's events, spliced from the JSON text they are kept as" },
  { file: "routes/me.ts", made: "text", why: "the member's events, spliced from the JSON text they are kept as" },
];

test("the API's handlers make no response by hand but where it is not JSON alone", async () => {
  const dir = `${import.meta.dir}/../src/http`;
  const files = [...new Glob("routes/*.ts").scanSync(dir), "internal.ts"];
  expect(files.length).toBeGreaterThan(10);
  const texts = await Promise.all(files.map((file) => Bun.file(`${dir}/${file}`).text()));
  const made = files.flatMap((file, i) =>
    [...(texts[i] ?? "").matchAll(/HttpServerResponse\.(\w+)\(/g)].map(([, constructor = ""]) => ({
      file,
      made: constructor,
    })),
  );
  const allowed = (one: { file: string; made: string }) =>
    TRANSPORT.some((transport) => transport.file === one.file && transport.made === one.made);
  expect(made.filter((one) => !allowed(one))).toEqual([]);
  // Every allowance is still used, so the list only shrinks.
  expect(
    TRANSPORT.filter((transport) => !made.some((one) => one.file === transport.file && one.made === transport.made)),
  ).toEqual([]);
});
