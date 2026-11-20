/**
 * Leafle: the daily Wynncraft word, six guesses, played with the call. Friends' boards open when
 * they solve it. The guesses are kept in the model, by day.
 */

import { FRIENDS } from "../../game/friends.ts";
import type { MenuView } from "./menus.ts";
import { head } from "./portraits.ts";
import { esc } from "./widgets.ts";

const WORDS = ["FRUMA", "RAGNI", "NIVLA", "ALMUJ", "GAVEL", "TOMES", "ROOTS", "SPELL"];

export const today = (now: Date): string => now.toISOString().slice(0, 10);
export const answerFor = (day: string): string =>
  WORDS[Math.floor(Date.parse(day) / 86400000) % WORDS.length] ?? "FRUMA";

type Mark = "right" | "near" | "miss";

/** Wordle's marking: right place first, then letters elsewhere, each answer letter used once. */
export function score(word: string, answer: string): Mark[] {
  const out: Mark[] = Array.from({ length: 5 }, () => "miss");
  const left = answer.split("");
  for (let i = 0; i < 5; i++)
    if (word[i] === answer[i]) {
      out[i] = "right";
      left[i] = "";
    }
  for (let i = 0; i < 5; i++) {
    const ch = word[i] ?? "";
    if (out[i] === "miss" && left.includes(ch)) {
      out[i] = "near";
      left[left.indexOf(ch)] = "";
    }
  }
  return out;
}

/** A friend's board at the fire: coloured once they have solved it, never showing letters. */
const friend = (name: string, rows: number): string =>
  `<div class="friend">${head(name, 2)}<div class="mini">${Array.from({ length: 30 }, (_, i) => `<i class="${rows && i < rows * 5 ? (i >= (rows - 1) * 5 ? "right" : (["miss", "near", "right"][(i * 7 + name.length) % 3] ?? "miss")) : ""}"></i>`).join("")}</div><div><strong>${name}</strong><small>${rows ? `Solved in ${rows}` : "Still thinking"}</small></div></div>`;

export function leafle(guesses: readonly string[], draft: string, day: string): MenuView {
  const answer = answerFor(day);
  const solved = guesses.includes(answer);
  const done = solved || guesses.length >= 6;
  const board = Array.from({ length: 6 }, (_row, i) => {
    const g = guesses[i];
    const w = g ?? (i === guesses.length ? draft : "");
    const marks = g ? score(g, answer) : null;
    return Array.from(
      { length: 5 },
      (_cell, j) => `<b class="${marks ? marks[j] : i === guesses.length ? "current" : ""}">${esc(w[j] ?? "")}</b>`,
    ).join("");
  }).join("");
  const keys = ["QWERTYUIOP", "ASDFGHJKL", "↵ZXCVBNM⌫"]
    .map(
      (row) =>
        `<div>${row
          .split("")
          .map(
            (k) =>
              `<button data-key="${k}" aria-label="${k === "↵" ? "Submit guess" : k === "⌫" ? "Delete letter" : k}"${done ? " disabled" : ""}>${k === "↵" ? "Go" : k === "⌫" ? "Del" : k}</button>`,
          )
          .join("")}</div>`,
    )
    .join("");
  return {
    category: "Campfire daily",
    title: "Leafle",
    accent: "#58c47a",
    body: `
      <div class="cols leafle">
        <section>
          <p class="note">Six guesses for a five-letter Wynncraft word.</p>
          <div class="wordboard" role="img" aria-label="${guesses.length ? guesses.map((w) => `${w}: ${score(w, answer).join(" ")}`).join(". ") : "An empty board"}">${board}</div>
          <p class="note gold" aria-live="polite">${done ? (solved ? "Solved! Your board is open to the call." : `The word was ${answer}.`) : ""}</p>
          <div class="keyboard">${keys}</div>
        </section>
        <section>
          <h2 class="small">At the fire · ${day}</h2>
          <p class="note">Boards open when a friend solves it.</p>
          ${FRIENDS.map((f) => friend(f.name, f.leafle)).join("")}
          ${friend("You", solved ? guesses.length : 0)}
          <div class="buttons"><a class="btn" href="#campfire">Back to the fire</a></div>
        </section>
      </div>`,
  };
}
