/**
 * The Discord poster, for one channel (`.github/workflows/news.yml`): posts each note that is out and
 * that the channel has not taken (`toPost`, `deliver` in `src/notes.ts`), and marks each note it took
 * on the commit that added it, as a commit status `news/<channel>/<note id>`: the channel's record.
 * A note the channel did not take (a 429, a 5xx, no answer) stays unmarked and is tried on the next
 * run. Run in the repository with its history:
 *
 *     NAME=<channel> WEBHOOK=<url> GH_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> bun apps/town/review/news.ts
 *
 * The record began with the first commit whose workflow asks to write statuses: the poster before it
 * posted every note merged earlier.
 */
import { deliver, messageOf, type Note, NOTES, toPost } from "../src/notes.ts";

const FILE = "apps/town/src/notes.json";
const WORKFLOW = ".github/workflows/news.yml";
/** What the workflow says once the poster keeps a record. */
const RECORDS = "statuses: write";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`news.ts needs ${name}`);
  return v;
}
function git(...args: string[]): string {
  const out = Bun.spawnSync(["git", ...args]);
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
  return out.stdout.toString();
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** When the record began: the first commit whose workflow asks to write statuses. */
function recordSince(): number {
  const first = git("log", "--reverse", "--format=%ct", `-S${RECORDS}`, "--", WORKFLOW).split("\n")[0] ?? "";
  if (first === "") throw new Error("news.ts: no commit of the workflow keeps a record. Is the history fetched?");
  return Number(first) * 1000;
}

interface Added {
  readonly sha: string;
  readonly at: number;
}
/** The commit that added each note to the file, and when: from one pass over the file's history. */
function addedBy(): ReadonlyMap<string, Added> {
  const out = new Map<string, Added>();
  let commit: Added | null = null;
  for (const line of git("log", "--reverse", "--format=commit %H %ct", "-p", "--", FILE).split("\n")) {
    const head = /^commit ([0-9a-f]{40}) (\d+)$/.exec(line);
    if (head) {
      commit = { sha: head[1] ?? "", at: Number(head[2]) * 1000 };
      continue;
    }
    const id = /^\+\s*"id": "([^"]+)"/.exec(line)?.[1];
    if (id !== undefined && commit && !out.has(id)) out.set(id, commit);
  }
  return out;
}

const API = `https://api.github.com/repos/${env("GITHUB_REPOSITORY")}`;
const HEADERS = {
  Authorization: `Bearer ${env("GH_TOKEN")}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const CHANNEL = env("NAME");
const WEBHOOK = env("WEBHOOK");
const contextOf = (id: string): string => `news/${CHANNEL}/${id}`;

/** The contexts marked taken on a commit. A record that cannot be read stops the run: nothing is posted twice. */
async function marked(sha: string): Promise<ReadonlySet<string>> {
  const res = await fetch(`${API}/commits/${sha}/statuses?per_page=100`, { headers: HEADERS });
  if (!res.ok) throw new Error(`news.ts: the statuses of ${sha} did not read (${res.status})`);
  const list: unknown = await res.json();
  return new Set(
    Array.isArray(list)
      ? list.flatMap((s: unknown) =>
          isRecord(s) && s.state === "success" && typeof s.context === "string" ? [s.context] : [],
        )
      : [],
  );
}

const added = addedBy();
const due = toPost(NOTES, {
  now: Date.now(),
  since: recordSince(),
  merged: (id) => added.get(id)?.at ?? Number.NEGATIVE_INFINITY,
  taken: () => false,
});
const shas = [...new Set(due.flatMap((n) => added.get(n.id)?.sha ?? []))];
const taken = new Set<string>();
for (const set of await Promise.all(shas.map(marked))) for (const context of set) taken.add(context);
const untaken = due.filter((n) => !taken.has(contextOf(n.id)));

/** Posts a note to the channel; what it answered, or 0 for no answer. One a second, as Discord asks. */
async function send(n: Note): Promise<number> {
  const answer = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messageOf(n)),
    signal: AbortSignal.timeout(15_000),
  }).then(
    (res) => res.status,
    () => 0,
  );
  await Bun.sleep(1000);
  return answer;
}
/** Marks a note taken by this channel on the commit that added it. */
async function keep(n: Note): Promise<void> {
  const sha = added.get(n.id)?.sha;
  const res = await fetch(`${API}/statuses/${sha}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ state: "success", context: contextOf(n.id), description: "Posted to Discord" }),
  });
  if (!res.ok) console.log(`::error::${CHANNEL} took "${n.title}", but it could not be marked (${res.status}).`);
}

const { took, left } = await deliver(untaken, send, keep);
console.log(`${CHANNEL}: took ${took.length} (${took.join(", ") || "none"}); left ${left.length} for the next run.`);
for (const id of left) console.log(`::error::${CHANNEL} did not take the note ${id}; the next run tries it again.`);
process.exitCode = left.length > 0 ? 1 : 0;
