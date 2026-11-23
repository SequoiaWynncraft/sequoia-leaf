/**
 * Builds the game's pages as the image does (`bun run pages`, part of `bun run verify`), so that a
 * page that builds here and not in the image is found here.
 *
 * The image's page stage (the Dockerfile's first stage) copies some of the repository into a clean
 * folder, leaving out what `.dockerignore` leaves out, installs the production dependencies, and
 * builds each app's page with `bun build index.html --minify`. This does the same in a folder of its
 * own: the same paths, the same patterns, the same install and the same build, for every app with a
 * page. The folder goes when it is done.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

/**
 * Whether `.dockerignore` leaves a path (relative to the repository, with `/`) out of the image, as
 * Docker reads it: each pattern against the path and every folder above it, `**` across folders,
 * `*` and `?` within one, a leading `!` letting back in; the last pattern that matches decides.
 */
export function ignoring(patterns: string): (path: string) => boolean {
  const rules = patterns
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const keep = line.startsWith("!");
      const glob = (keep ? line.slice(1) : line).replace(/^\/+|\/+$/g, "");
      let source = "";
      for (let i = 0; i < glob.length; i++) {
        const ch = glob[i] ?? "";
        if (glob.startsWith("**/", i)) {
          source += "(?:.*/)?";
          i += 2;
        } else if (glob.startsWith("**", i)) {
          source += ".*";
          i += 1;
        } else if (ch === "*") source += "[^/]*";
        else if (ch === "?") source += "[^/]";
        else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
      return { keep, re: new RegExp(`^${source}$`) };
    });
  return (path) => {
    const parts = path.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    let out = false;
    for (const rule of rules) if (paths.some((p) => rule.re.test(p))) out = !rule.keep;
    return out;
  };
}

/** What the Dockerfile's first stage copies from the repository, in order: each `COPY`'s sources. */
export function pageSources(dockerfile: string): string[] {
  const lines = dockerfile.split("\n");
  const second = lines.findIndex(
    (line, i) => i > 0 && /^FROM\s/i.test(line) && lines.slice(0, i).some((l) => /^FROM\s/i.test(l)),
  );
  return lines
    .slice(0, second < 0 ? lines.length : second)
    .filter((line) => /^COPY\s/i.test(line) && !/--from/i.test(line))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1));
}

/** Copies a path of the repository into `to`, leaving out what the image leaves out. */
function copy(path: string, to: string, out: (path: string) => boolean): void {
  const from = join(root, path);
  if (out(path)) return;
  if (statSync(from).isDirectory()) {
    for (const name of readdirSync(from)) copy(join(path, name), to, out);
    return;
  }
  cpSync(from, join(to, path), { recursive: false, force: true });
}

function run(command: string[], cwd: string): void {
  const done = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (done.exitCode === 0) return;
  console.error(`${command.join(" ")} in ${relative(root, cwd) || "."} failed:`);
  console.error(done.stdout.toString(), done.stderr.toString());
  process.exit(1);
}

if (import.meta.main) {
  const out = ignoring(readFileSync(join(root, ".dockerignore"), "utf8"));
  const place = mkdtempSync(join(tmpdir(), "leaf-pages-"));
  try {
    for (const path of pageSources(readFileSync(join(root, "Dockerfile"), "utf8")))
      copy(path.replace(/\/$/, ""), place, out);
    run([process.execPath, "install", "--frozen-lockfile", "--production", "--silent"], place);
    const apps = readdirSync(join(place, "apps")).filter((app) => {
      try {
        return statSync(join(place, "apps", app, "index.html")).isFile();
      } catch {
        return false;
      }
    });
    for (const app of apps)
      run(
        [process.execPath, "build", "index.html", "--outdir", join(place, "public", app), "--minify"],
        join(place, "apps", app),
      );
    console.log(`The pages build as the image builds them: ${apps.join(", ")}.`);
  } finally {
    rmSync(place, { recursive: true, force: true });
  }
}

/** The repository's root folder. */
export const repository = root;
