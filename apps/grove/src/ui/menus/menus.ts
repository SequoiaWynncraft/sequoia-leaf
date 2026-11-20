/**
 * The menus: HTML panels in the Sequoia mod's language (cut-corner slate panels with a lit top row
 * and a shaded bottom row, the Minecraft font, segmented bars, inventory slots and tooltips with
 * names in rank colours) laid over the dimmed live scene. Each screen is a pure view of the model;
 * this shell routes taps and keys to the model and redraws.
 */

import { CATALOGUE, type Tab, TABS } from "../../game/rules.ts";
import { SPIRITS } from "../../game/spirits.ts";
import { buy, type GroveState, pour, warmCones } from "../../game/state.ts";
import type { App, Opening, SceneId } from "../../scenes/scene.ts";
import { mountArt, ringBand } from "./art.ts";
import { cones, rates } from "./cones.ts";
import { great } from "./great.ts";
import { icon } from "./icons.ts";
import { answerFor, leafle, today } from "./leafle.ts";
import { mountCast } from "./portraits.ts";
import { rings } from "./rings.ts";
import { itemTip, shop } from "./shop.ts";
import { spirits, tooltip } from "./spirits.ts";
import { leaf } from "./widgets.ts";

export type MenuId = "cones" | "rates" | "spirits" | "shop" | "rings" | "great" | "leafle";

/** The scene a menu belongs to, for a cold start straight into it. */
export const MENU_HOME: Readonly<Record<MenuId, SceneId>> = {
  cones: "glade",
  rates: "glade",
  spirits: "glade",
  rings: "glade",
  shop: "forest",
  great: "forest",
  leafle: "campfire",
};

export interface MenuView {
  category: string;
  title: string;
  /** The panel's border colour. */
  accent: string;
  body: string;
}

interface Hooks {
  /** Cones were opened: play them in the glade. */
  warm(openings: Opening[]): void;
  close(): void;
}

export class Menus {
  private readonly root: HTMLElement;
  private readonly app: App;
  private readonly hooks: Hooks;
  private current: MenuId | null = null;
  // What each screen has picked.
  private spirit = "glorp";
  private tab: Tab = "decor";
  private item = "";
  private season = 4;
  private guildRing = 1;
  private draft = "";

  constructor(root: HTMLElement, app: App, hooks: Hooks) {
    this.root = root;
    this.app = app;
    this.hooks = hooks;
    const day = this.day();
    this.item = CATALOGUE[(day * 5) % CATALOGUE.length]?.id ?? "";
    this.spirit = app.store.state.companion ?? "glorp";
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("pointerover", (e) => this.inspect(e.target));
    root.addEventListener("focusin", (e) => this.inspect(e.target));
  }

  private get state(): GroveState {
    return this.app.store.state;
  }

  /** The prototype's day: a still screenshot keeps one, so its daily trades never change. */
  private day(): number {
    return this.app.params.still ? 20412 : Math.floor(Date.now() / 86400000);
  }

  private date(): string {
    return this.app.params.still ? "2026-11-20" : today(new Date());
  }

  show(menu: MenuId | null): void {
    if (menu === this.current) return;
    this.current = menu;
    this.refresh();
    // Minecraft-quick: the panel opens in three steps, once, when it is first shown.
    const panel = this.root.querySelector<HTMLElement>(".menu");
    panel?.classList.add("opening");
    panel?.addEventListener("animationend", () => panel.classList.remove("opening"), { once: true });
    if (menu) this.root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }

  refresh(): void {
    const m = this.current;
    this.root.hidden = m === null;
    if (!m) {
      this.root.innerHTML = "";
      return;
    }
    const v = this.view(m);
    const scroll = this.root.querySelector(".menu-body")?.scrollTop ?? 0;
    this.root.innerHTML = `
      <a class="menu-dim" href="#close" data-act="close" aria-label="Close" tabindex="-1"></a>
      <section class="menu panel" role="dialog" aria-labelledby="menu-title" style="--accent:${v.accent}">
        <header>
          <div class="titles"><small>${v.category}</small><h1 id="menu-title" tabindex="-1">${v.title}</h1></div>
          <div class="balance" aria-label="Leaf balance">${leaf(this.state.leaf)}</div>
          <button class="close" data-act="close" aria-label="Close">${icon("close")}</button>
        </header>
        <div class="menu-body">${v.body}</div>
      </section>`;
    const body = this.root.querySelector(".menu-body");
    if (body) body.scrollTop = scroll;
    this.fit();
    mountCast(this.root, this.app.art);
  }

  /**
   * Paints the menu's pictures at the whole scale its boxes hold now: again whenever the screen's
   * layout changes, and once the page's styles are in, so a picture never keeps a scale it was
   * measured at before its box had its width.
   */
  fit(): void {
    if (this.current === null) return;
    const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mu")) || 2;
    mountArt(this.root, unit);
  }

  private view(m: MenuId): MenuView {
    const s = this.state;
    switch (m) {
      case "cones":
        return cones(s);
      case "rates":
        return rates();
      case "spirits":
        return spirits(s, this.spirit);
      case "shop":
        return shop(s, this.tab, this.item, this.day());
      case "rings":
        return rings(this.app.params.level, this.season);
      case "great":
        return great(s, this.guildRing);
      case "leafle":
        return leafle(this.guesses(), this.draft, this.date());
    }
  }

  private guesses(): string[] {
    const l = this.state.leafle;
    return l.day === this.date() ? l.guesses : [];
  }

  /** Hover or focus picks a spirit or an item and updates its tooltip in place. */
  private inspect(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    const sp = target.closest<HTMLElement>("[data-spirit]");
    const it = target.closest<HTMLElement>("[data-item]");
    if (sp?.dataset["spirit"] && sp.dataset["spirit"] !== this.spirit) {
      this.spirit = sp.dataset["spirit"];
      this.pick("[data-spirit]", sp, "#inspect", tooltip(this.state, this.spirit));
    } else if (it?.dataset["item"] && it.dataset["item"] !== this.item) {
      this.item = it.dataset["item"];
      this.pick("[data-item]", it, "#item-tip", itemTip(this.state, this.item));
    }
  }

  private pick(selector: string, el: HTMLElement, tipId: string, html: string): void {
    for (const b of this.root.querySelectorAll(selector)) {
      b.classList.toggle("picked", b === el);
      b.setAttribute("aria-selected", String(b === el));
    }
    const tip = this.root.querySelector<HTMLElement>(tipId);
    if (!tip) return;
    tip.innerHTML = html;
    mountCast(tip, this.app.art);
  }

  private click(e: MouseEvent): void {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const act = el.closest<HTMLElement>("[data-act]")?.dataset["act"];
    const key = el.closest<HTMLElement>("[data-key]")?.dataset["key"];
    if (act) {
      e.preventDefault();
      this.act(act);
      return;
    }
    if (key) return this.type(key);
    const wood = el.closest<HTMLCanvasElement>('canvas[data-art="rings"]');
    if (wood) {
      const box = wood.getBoundingClientRect();
      const d = ringBand(((e.clientX - box.left) * 100) / box.width, ((e.clientY - box.top) * 74) / box.height);
      if (d <= 1) {
        this.season = Math.min(4, Math.floor(d * 5));
        this.refresh();
      }
      return;
    }
    const picked = el.closest<HTMLElement>("[data-spirit],[data-item]");
    if (picked) this.inspect(picked);
  }

  private act(act: string): void {
    const [cmd = "", ...rest] = act.split("-");
    const arg = rest.join("-");
    const store = this.app.store;
    switch (cmd) {
      case "close":
        this.hooks.close();
        return;
      case "warm": {
        const n = Number(arg) || 1;
        const opened = warmCones(store.state, n, Math.random);
        if (!opened) {
          this.app.say("Treasury@seqwawa regrets to inform you: more Leaf needed.");
          return;
        }
        store.set(opened.state);
        this.hooks.warm(opened.pulls);
        return;
      }
      case "companion":
        store.set({ ...store.state, companion: arg });
        this.app.say(`${SPIRITS.find((s) => s.id === arg)?.name ?? "Your spirit"} will follow you now.`);
        return;
      case "tab":
        this.tab = TABS.find((t) => t.id === arg)?.id ?? this.tab;
        this.item = CATALOGUE.find((i) => i.tab === this.tab)?.id ?? this.item;
        this.refresh();
        return;
      case "buy": {
        const item = CATALOGUE.find((i) => i.id === this.item);
        const next = buy(store.state, this.item);
        if (!next || !item) return;
        store.set(next);
        this.app.say(
          `Treasury@seqwawa confirms: ${item.name} is yours. Please stop thanking Cinfy, it makes them nervous.`,
        );
        return;
      }
      case "season":
        this.season = Number(arg) || 0;
        this.refresh();
        return;
      case "guildring":
        this.guildRing = Number(arg) || 0;
        this.refresh();
        return;
      case "pour": {
        const next = pour(store.state);
        if (!next) return;
        store.set(next);
        this.app.say("Your lantern glows in the Great Sequoia's branches.");
        return;
      }
    }
  }

  /** Leafle's typing, from the on-screen keys or the keyboard. */
  private type(k: string): void {
    const guesses = this.guesses();
    const answer = answerFor(this.date());
    if (guesses.includes(answer) || guesses.length >= 6) return;
    if (k === "⌫") this.draft = this.draft.slice(0, -1);
    else if (k === "↵") {
      if (this.draft.length !== 5) {
        this.app.say("Use five letters.");
        return;
      }
      this.app.store.set({ ...this.state, leafle: { day: this.date(), guesses: [...guesses, this.draft] } });
      this.draft = "";
    } else if (/^[A-Z]$/.test(k) && this.draft.length < 5) this.draft += k;
    this.refresh();
  }

  /** Keys while a menu is open. Returns whether the menu used the key. */
  key(e: KeyboardEvent): boolean {
    if (this.current !== "leafle") return false;
    if (e.key === "Enter" && e.target instanceof Element && e.target.closest("button,a")) return false;
    const k = e.key === "Backspace" ? "⌫" : e.key === "Enter" ? "↵" : e.key.toUpperCase();
    if (!/^[A-Z↵⌫]$/.test(k)) return false;
    e.preventDefault();
    this.type(k);
    return true;
  }
}
