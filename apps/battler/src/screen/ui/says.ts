/**
 * The lines of news over the traits (`#says`): a toast's, or the line of figures a rule moved. A line
 * that has had its moment hides but keeps its room while another line is up, so that one stays where
 * it is; when the last goes, they all go, and nothing moves.
 */

/** A line has had its moment: hidden, its room kept until no line is left up. */
export function lineGone(line: Element): void {
  line.classList.add("gone");
  const says = line.parentElement;
  if (says && [...says.children].every((c) => c.classList.contains("gone"))) says.replaceChildren();
}
