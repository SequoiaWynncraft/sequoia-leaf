/** What `status` and `condition` each say of every piece of a yard, for the tests to hold them together. */
import * as F from "../src/index.ts";

/** Every piece's state and trouble as `status` says it and as `condition` says it. */
export function bothSay(y: F.Yard): { status: string[]; condition: string[] } {
  const said = { status: [] as string[], condition: [] as string[] };
  for (let i = 0; i < y.kind.length; i++) {
    const st = F.status(y, i);
    const c = F.condition(y, i);
    said.status.push(st ? `${i} ${st.state}${st.trouble ? " trouble" : ""}` : `${i} -`);
    said.condition.push(c < 0 ? `${i} -` : `${i} ${F.STATES[c % F.TROUBLE]}${c >= F.TROUBLE ? " trouble" : ""}`);
  }
  return said;
}
