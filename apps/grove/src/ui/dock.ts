/**
 * The dock: the game's one navigation, a hotbar of six slots in the mod's style. On a phone it is a
 * strip along the bottom, under the world, where a thumb is; on a wide screen it stands up the left
 * edge over the redwood that frames every scene. Hovering or focusing a slot shows its name in a
 * Minecraft tooltip.
 */

import { icon } from "./menus/icons.ts";

interface Entry {
  route: string;
  icon: string;
  name: string;
  hint: string;
  /** Routes that light this slot too. */
  also: readonly string[];
}

const ENTRIES: readonly Entry[] = [
  { route: "glade", icon: "glade", name: "Glade", hint: "Your tree", also: ["rings"] },
  { route: "forest", icon: "forest", name: "Forest", hint: "The guild's valley", also: ["great"] },
  { route: "campfire", icon: "campfire", name: "Campfire", hint: "Friends in the call", also: ["leafle"] },
  { route: "cones", icon: "cone", name: "Cones", hint: "Open cones by fire", also: ["rates"] },
  { route: "spirits", icon: "spirits", name: "Spirits", hint: "Your spirit book", also: [] },
  { route: "shop", icon: "shop", name: "Treasury", hint: "Cinfy's shop", also: [] },
];

/** The dock's slot and padding, in units. */
const SLOT = 20;
const PAD = 2;

export class Dock {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** The strip's height on a phone, in CSS pixels. */
  height(unit: number): number {
    return (SLOT + PAD * 2 + 2) * unit;
  }

  render(r: { scene: string | null; menu: string | null }): void {
    const here = r.menu ?? r.scene ?? "glade";
    this.root.innerHTML = `<div class="dock-panel">${ENTRIES.map((e) => {
      const on = e.route === here || e.also.includes(here);
      return `<a class="slot${on ? " on" : ""}" href="#${e.route}" aria-label="${e.name}: ${e.hint}"${on ? ' aria-current="page"' : ""}>${icon(e.icon)}<span class="tip" role="tooltip"><b>${e.name}</b><i>${e.hint}</i></span></a>`;
    }).join("")}</div>`;
  }
}
