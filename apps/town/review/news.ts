/**
 * The Discord poster, for one channel (`.github/workflows/news.yml`): posts each note that is out and
 * that the channel has not taken (`toPost`, `deliver` in `src/notes.ts`), and marks each note it took
 * on the commit that added it, as a commit status `news/<channel>/<note id>`: the channel's record.
 * It posts with `?wait=true`, so a 2xx is Discord saying the message is saved. A note the channel
 * did not take (a 429, a 5xx, no answer) stays unmarked and is tried on the next run; a note taken
 * whose mark could not be written fails the run once the rest are posted, and may be posted again
 * by the next. Run in the repository with its history:
 *
 *     NAME=<channel> WEBHOOK=<url> GH_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> bun apps/town/review/news.ts
 *
 * With `--dry` it posts and marks nothing, needs no WEBHOOK, and says what it would post: a token
 * that reads statuses is enough (`GH_TOKEN=$(gh auth token)`).
 *
 * The record began with the first commit whose workflow asks to write statuses: the poster before it
 * posted every note merged earlier. The commit that added each note is `added.ts`'s to say; a note
 * due that no commit is known to have added stops the run before anything is posted, as it could
 * be neither marked nor known to be taken.
 */
import { deliver, everyPage, messageOf, type Note, NOTES, toPost } from "../src/notes.ts";
import { addedBy, unrecorded } from "./added.ts";

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

const API = `https://api.github.com/repos/${env("GITHUB_REPOSITORY")}`;
const HEADERS = {
  Authorization: `Bearer ${env("GH_TOKEN")}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const CHANNEL = env("NAME");
/** Whether to say what would be posted and post nothing. */
const DRY = process.argv.includes("--dry");
/** Statuses to a page, the most GitHub gives. */
const PAGE = 100;
const contextOf = (id: string): string => `news/${CHANNEL}/${id}`;

/** One page of a commit's statuses. One that cannot be read stops the run: nothing is posted twice. */
async function statusesOf(sha: string, page: number): Promise<readonly unknown[]> {
  const res = await fetch(`${API}/commits/${sha}/statuses?per_page=${PAGE}&page=${page}`, { headers: HEADERS });
  const list: unknown = res.ok ? await res.json() : null;
  if (!Array.isArray(list)) throw new Error(`news.ts: the statuses of ${sha} did not read (${res.status})`);
  return list;
}
/** The contexts marked taken on a commit, from every page of its statuses. */
async function marked(sha: string): Promise<ReadonlySet<string>> {
  const list = await everyPage((page) => statusesOf(sha, page), PAGE);
  return new Set(
    list.flatMap((s: unknown) =>
      isRecord(s) && s.state === "success" && typeof s.context === "string" ? [s.context] : [],
    ),
  );
}

const added = addedBy(process.cwd());
const due = toPost(NOTES, {
  now: Date.now(),
  since: recordSince(),
  merged: (id) => added.get(id)?.at ?? Number.NEGATIVE_INFINITY,
  taken: () => false,
});
const dueIds = due.map((n) => n.id);
const lost = unrecorded(dueIds, added);
if (lost.length > 0) {
  for (const id of lost) console.log(`::error::No commit is known to have added the note ${id}: nothing is posted.`);
  process.exit(1);
}
const shas = [...new Set(due.flatMap((n) => added.get(n.id)?.sha ?? []))];
const taken = new Set<string>();
for (const set of await Promise.all(shas.map(marked))) for (const context of set) taken.add(context);
const untaken = due.filter((n) => !taken.has(contextOf(n.id)));

if (DRY) {
  const would = untaken.map((n) => n.id).join(", ") || "none";
  console.log(
    `${CHANNEL}: ${due.length} due, ${due.length - untaken.length} marked taken; would post ${untaken.length} (${would}).`,
  );
  process.exit(0);
}

/** The channel's webhook, asked to answer only once the message is saved. */
const WEBHOOK = new URL(env("WEBHOOK"));
WEBHOOK.searchParams.set("wait", "true");

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
/** Marks a note taken by this channel on the commit that added it: whether the mark was written. */
async function keep(n: Note): Promise<boolean> {
  const sha = added.get(n.id)?.sha;
  const res = await fetch(`${API}/statuses/${sha}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ state: "success", context: contextOf(n.id), description: "Posted to Discord" }),
  }).catch(() => null);
  return res?.ok === true;
}

const { took, left, unmarked } = await deliver(untaken, send, keep);
console.log(`${CHANNEL}: took ${took.length} (${took.join(", ") || "none"}); left ${left.length} for the next run.`);
for (const id of left) console.log(`::error::${CHANNEL} did not take the note ${id}; the next run tries it again.`);
for (const id of unmarked)
  console.log(`::error::${CHANNEL} took the note ${id}, but it could not be marked; the next run may post it again.`);
process.exitCode = left.length + unmarked.length > 0 ? 1 : 0;
