# The figures

The pictures of The Little Raid's figures (`@sequoia-leaf/figures`), for any page that shows them:
the raid's table, and the town. Which figures there are is the raid's rules' (`packages/raid`);
this is only how they look.

- `src/figures.txt`: every figure typed out as rows of letters, a block for each picture; `src/figures.ts`
  reads them (`artOf`) with what else is kept of each (where it breathes, whether it flies), and
  `src/rows.ts` reads any such text (the raid table's `icons.txt` too).
- `src/pal.ts`: the letters' colours, which are the town's (`FIGURE_PAL`: the kit's palette and
  the tones the town's own creatures have), and the colours of the bases.
- `src/sprites.ts`: those rows baked into pictures and drawn: `framesOf` (standing, breathing,
  casting, tipped over, hit, not yet opened, facing either way), `drawFigure`, `portrait`,
  `drawStanding` (a figure on its base, whose look every caller names), `drawStars` and `starsPic`;
  and how one moves while it stands, by the clock alone (`beatAt`, `hoverAt`).
- A banner's member (the raid's `content/members.ts`) has no typed rows: it is a person, drawn as
  the town draws one from a skin (the kit's `skin.ts`), at that size, facing us, in the same
  pictures as everyone else (`person` in `sprites.ts`). `src/member.ts` asks Leaf who each
  banner's member is (`meetMembers`) for any page that shows one, the raid's table and the town's
  camps alike: nobody yet, then their name and made-up look, then their own skin. `nameOf` is what
  anyone on the stump is called, and `shownAs` changes when a figure's name or pictures do.
- `src/move.ts`: a figure going from one point to another in an arc (`Move`, `moveAt`), which every
  table moves its figures by.

```sh
bun test         # every figure has its pictures, and all of them are in the town's colours
```
