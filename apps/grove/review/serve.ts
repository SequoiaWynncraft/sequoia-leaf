/** Serves a built client for screenshots and the driver: `bun review/serve.ts <dir> <port>`. */

const [dir, port] = process.argv.slice(2);
if (!dir || !port) throw new Error("usage: serve.ts <dir> <port>");
Bun.serve({
  port: Number(port),
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    const file = Bun.file(`${dir}${path === "/" ? "/index.html" : path}`);
    return file.size ? new Response(file) : new Response("", { status: 404 });
  },
});
