/**
 * A page that does nothing but speak to the town the way a game does, for looking at the town's
 * doors before the real games do. `?silent` in its address makes it never say it is ready.
 */
import { balance, pretendPurse } from "@sequoia-leaf/kit/purse.ts";
import { fromTown, leave, tell } from "@sequoia-leaf/kit/shell.ts";

const on = (id: string, fn: () => void): void => {
  document.getElementById(id)?.addEventListener("click", fn);
};

on("leave", leave);
// Pocket money, as a game pays Coins in: the made-up guild's purse, which the town hears change.
on("earn", () => {
  pretendPurse(balance().coins + 5);
});
on("news", () => {
  tell({ town: "news", text: "The stand-in game says hello.", tone: "leaf" });
});
fromTown((msg) => {
  const heard = document.getElementById("heard");
  if (heard)
    heard.textContent =
      msg.town === "leaf"
        ? `The town said: ${msg.leaf} Leaf.`
        : msg.town === "coins"
          ? `The town said: ${msg.coins} Coins.`
          : "The town said: closing.";
});
if (!new URLSearchParams(location.search).has("silent")) tell({ town: "ready" });
