/**
 * A page that does nothing but speak to the town the way a game does, for looking at the town's
 * doors before the real games do. `?silent` in its address makes it never say it is ready.
 */
import { earn } from "@sequoia-leaf/kit/purse.ts";
import { fromTown, leave, tell } from "@sequoia-leaf/kit/shell.ts";

const on = (id: string, fn: () => void): void => {
  document.getElementById(id)?.addEventListener("click", fn);
};

on("leave", leave);
on("earn", () => {
  earn(5, "the stand-in game");
});
on("news", () => {
  tell({ town: "news", text: "The stand-in game says hello.", tone: "leaf" });
});
fromTown(() => {
  const heard = document.getElementById("heard");
  if (heard) heard.textContent = "The town said: closing.";
});
if (!new URLSearchParams(location.search).has("silent")) tell({ town: "ready" });
