/** The crate on the page: its lid on or off, larger once a crate holds more; its card shuts and opens it. */
import { BARK } from "@sequoia-leaf/kit/palette.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import type { KindPage } from "./kind.ts";

export const crate: KindPage = {
  picture: ({ m }) => must(m.crate[0]?.[0], "crate").c,
  draw(art, y, at) {
    const s = art.m.crate[y.open.crate > 32 ? 1 : 0]?.[at.open ? 1 : 0];
    if (s) at.stand(s, at.cx, at.foot - 1, at.z, at.a);
    return at.foot - 16;
  },
  pointer: "bare",
  map: [BARK[3], BARK[1]],
  dot: "#a35d3b",
  dock: 11,
  holdsUp: (y) => y.open.crate,
  empties: true,
  standing: {
    more: (_art, p, hands) => [
      {
        label: p.open ? "Shut it" : "Open it",
        hint: p.open ? "Shut" : "Open",
        about: "While shut, it takes items in and lets none out.",
        on: () => {
          hands.act({ do: "crate", x: p.x, y: p.y, open: !p.open });
          sfx.clack();
        },
      },
    ],
  },
  faces: true,
};
