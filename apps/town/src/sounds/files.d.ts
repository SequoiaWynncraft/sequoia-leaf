/** A sound file the page ships: `bun build` copies it beside the page, and its import is the file's address. */
declare module "*.mp3" {
  const file: string;
  export default file;
}
