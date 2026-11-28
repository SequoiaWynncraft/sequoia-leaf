/**
 * Drawing a card again into the node that holds it on the page (`card.ts`), rather than putting a
 * new node in its place: the node keeps where it stands (its style), and the focus where it can.
 */

/**
 * Draws `card` (a new drawing, not on the page) into `node`: the drawing's classes, attributes and
 * parts, and the node's own style, which holds its place. Whoever was on one of its buttons is on
 * the same button of the new drawing. Says how far the node was scrolled, for once it is placed.
 */
export function drawInto(node: HTMLElement, card: HTMLElement): number {
  const scrolled = node.scrollTop;
  const held = [...node.querySelectorAll("button")].findIndex((b) => b === document.activeElement);
  for (const name of node.getAttributeNames()) if (name !== "style" && name !== "class") node.removeAttribute(name);
  for (const name of card.getAttributeNames())
    if (name !== "style" && name !== "class") node.setAttribute(name, card.getAttribute(name) ?? "");
  node.className = card.className;
  node.replaceChildren(...card.childNodes);
  node.querySelectorAll("button")[held]?.focus({ preventScroll: true });
  return scrolled;
}
