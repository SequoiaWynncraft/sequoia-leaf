/**
 * Runs one of the screenshot tours against a play server on this machine, as the game is always
 * played against a Leaf:
 *
 *   bun review/tour.ts <steps.json> <out-dir> [<query>]
 *
 * It builds the page into a folder of its own, starts `apps/api/test/play.ts` on a free port with
 * Leaf's dice falling the same way every time (so a tour plays the same game each run), signs in as
 * its Tester, and has the kit's driver go through the steps on the page (`?<query>` added to its
 * address, such as `sheet`). The server and the folder go when the tour ends.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [stepsPath, outDir, query] = process.argv.slice(2);
if (!stepsPath || !outDir) {
  console.error("Usage: bun review/tour.ts <steps.json> <out-dir> [<query>]");
  process.exit(2);
}

const app = resolve(import.meta.dir, "..");
const root = resolve(app, "..", "..");
const site = mkdtempSync(join(tmpdir(), "raid-tour-"));

/** A port nothing is listening on. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response(null) });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

/** Reads a process's output until a line says what is waited for. */
async function until(stream: ReadableStream<Uint8Array>, said: string, seen = ""): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = seen;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- reading the server's output as it comes
    const { done, value } = await reader.read();
    if (done) throw new Error(`The play server stopped before saying "${said}":\n${text}`);
    text += decoder.decode(value, { stream: true });
    if (text.includes(said)) {
      reader.releaseLock();
      return;
    }
  }
}

let server: ReturnType<typeof Bun.spawn> | null = null;
try {
  const built = Bun.spawnSync(["bun", "build", "index.html", "--outdir", join(site, "battler"), "--minify"], {
    cwd: app,
    stdout: "ignore",
    stderr: "inherit",
  });
  if (built.exitCode !== 0) throw new Error("The page did not build");
  const port = freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", join(root, "apps/api/test/play.ts"), String(port), site, "--dice", "1"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (!(server.stdout instanceof ReadableStream)) throw new Error("No output from the play server");
  await until(server.stdout, "Leaf is playing");
  const page = `${origin}/play/battler/${query ? `?${query}` : ""}`;
  const tour = Bun.spawn(
    [
      "bun",
      join(root, "packages/kit/tools/drive.ts"),
      `${origin}/sign-in?return_to=${encodeURIComponent(page)}`,
      resolve(outDir),
      resolve(stepsPath),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await tour.exited;
  if (code !== 0) process.exitCode = code;
} finally {
  server?.kill();
  await server?.exited;
  rmSync(site, { recursive: true, force: true });
}
