# The figures

The pictures of The Little Raid's figures (`@sequoia-leaf/figures`), for any page that shows them:
the raid's table, and the town. Which figures there are is the raid's rules' (`packages/raid`);
this is only how they look.

- `src/figures.ts`: every figure typed out as rows of letters (`ART`).
- `src/pal.ts`: the letters' colours, which are the town's (`FIGURE_PAL`: the kit's palette and
  the tones the town's own creatures have), and the colours of the bases.
- `src/sprites.ts`: those rows baked into pictures and drawn: `framesOf` (standing, breathing,
  casting, tipped over, hit, not yet opened, facing either way), `drawFigure`, `portrait`,
  `drawBase`, `drawStars` and `starsPic`; and how one moves while it stands, by the clock alone
  (`beatAt`, `hoverAt`).

```sh
bun test         # every figure has its pictures, and all of them are in the town's colours
```
