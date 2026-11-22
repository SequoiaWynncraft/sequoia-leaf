import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { CALLERS, FOLK, folk } from "@sequoia-leaf/town/folk.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

/** Every source file of the three games, by its path from the repository's root. */
function sources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        out.set(relative(ROOT, path), readFileSync(path, "utf8"));
    }
  };
  for (const app of ["town", "works", "battler"]) walk(join(ROOT, "apps", app, "src"));
  return out;
}

/**
 * The files that may draw somebody with the skin figure (`packages/kit/src/skin.ts`), and why: each
 * draws a member and nobody else. The member themself, real members in the game or dozing (and the
 * made-up guild's stand-in members, where there is no server), the drawing of anybody so made, and
 * the art sheet.
 */
const MEMBERS_ONLY: Readonly<Record<string, string>> = {
  "apps/town/src/townscene.ts": "the member themself",
  "apps/town/src/visitors.ts": "real members visiting or dozing",
  "apps/town/src/players.ts": "other players in town, live, in their own skins",
  "apps/town/src/draw.ts": "where a member's figure stands in its frame",
  "apps/town/src/game.ts": "the type of a member's figure",
  "apps/town/src/guild.ts": "the member's made-up look, until their skin loads",
  "apps/town/src/madeup.ts": "the member's made-up look, where there is no server",
  "apps/town/src/main.ts": "the art sheet: the member and the stand-ins",
  "apps/town/src/sheet.ts": "the art sheet",
  "apps/town/src/actors.ts": "the type of a member's figure",
  "apps/town/src/aboutui.ts": "the faces of those listed in Who is about, members and guests alone",
  "apps/town/src/campart.ts": "the size of a member's figure, for a banner's statue",
  "apps/town/src/statues.ts":
    "a banner's statue, carved from its member's own skin, or their made-up look until it loads",
  "apps/town/src/campui.ts": "the faces of the camps' owners at the signpost, members and guests alone",
  "apps/town/src/hud.ts": "the face of the owner of a camp visited, a member or a guest",
  "apps/town/src/live.ts": "where each player's own skin is served",
  "apps/works/src/ui/board.ts": "the faces of the yards' owners on Top yards, members and guests alone",
  "apps/works/src/ui/hud.ts": "the face of the owner of a yard visited, a member or a guest",
};

/** Whether a file takes anything from the skin figure but the name of a facing (`Dir`), which anything that turns uses. */
function usesSkin(text: string): boolean {
  const taken = [...text.matchAll(/import (?:type )?\{([^}]*)\} from "@sequoia-leaf\/kit\/skin\.ts"/g)].flatMap((m) =>
    (m[1] ?? "").split(",").map(
      (n) =>
        n
          .trim()
          .replace(/^type /, "")
          .split(" as ")[0] ?? "",
    ),
  );
  return taken.some((n) => n !== "" && n !== "Dir");
}

describe("the town's own", () => {
  test("every townsperson is drawn as one of the town's own sprites: never the skin figure", () => {
    const files = sources();
    expect(files.size).toBeGreaterThan(50);
    const drawnWithSkins = [...files].filter(([, text]) => usesSkin(text)).map(([path]) => path);
    for (const path of drawnWithSkins) expect(Object.keys(MEMBERS_ONLY)).toContain(path);
    // How the town's own look and are drawn never touches a skin, in any of the games.
    for (const path of [
      "apps/town/src/folk.ts",
      "apps/town/src/folkart.ts",
      "apps/works/src/actors.ts",
      "apps/works/src/events.ts",
      "apps/works/src/scene.ts",
      "apps/battler/src/screen/scene.ts",
    ])
      expect(usesSkin(files.get(path) ?? "skin")).toBe(false);
    // A figure from a made-up look is only ever made where members are.
    for (const [path, text] of files)
      if (/paintSkin\(/.test(text))
        expect([
          "apps/town/src/townscene.ts",
          "apps/town/src/visitors.ts",
          "apps/town/src/players.ts",
          "apps/town/src/main.ts",
          "apps/town/src/aboutui.ts",
          "apps/town/src/statues.ts",
        ]).toContain(path);
    // And one of the town's own is only ever made as itself.
    for (const [path, text] of files)
      if (/makeActor\(/.test(text) && !path.endsWith("actors.ts"))
        expect(["apps/town/src/townscene.ts", "apps/town/src/visitors.ts", "apps/town/src/players.ts"]).toContain(path);
  });

  test("each is a creature or a keeper, says what it is, and is nobody's member", () => {
    const sprites = new Set(["gnome", "cat", "glorp", "fox"]);
    for (const t of FOLK) {
      expect(sprites.has(t.kind)).toBe(true);
      expect(t.what.length).toBeGreaterThan(0);
      expect(Object.keys(t)).not.toContain("look");
      expect(Object.keys(t)).not.toContain("rank");
    }
    const names = FOLK.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    // Whoever calls at a camp is about the town, or only ever calling; never a keeper away from its post.
    for (const id of CALLERS) expect(folk(id).job === "counter" || typeof folk(id).job === "object").toBe(false);
  });

  test("the keepers keep the Treasury and the three stalls, and the rest are about the town or calling", () => {
    expect(folk("cinfy").job).toBe("counter");
    expect([folk("sootpaw").job, folk("bramblewick").job, folk("tindra").job]).toEqual([
      { stall: 0, naps: true },
      { stall: 1, naps: false },
      { stall: 2, naps: false },
    ]);
    expect([folk("pipwick").job, folk("mossback").job, folk("embertoe").job, folk("fox").job]).toEqual([
      "errands",
      "fire",
      "between",
      "calls",
    ]);
    expect(folk("mossback").chatter.every((line) => /glorp/.test(line))).toBe(true);
  });
});
