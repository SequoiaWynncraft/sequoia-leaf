/**
 * The dev server: `bun run dev`. Serves the page with Bun's bundler (rebuilt on save) and the art
 * bundle that `bun run art` copied into `public/grove-art/`. `PORT` picks the port (3100).
 */

import index from "./index.html";

const PUBLIC = `${import.meta.dir}/public`;

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? 3100),
  development: true,
  routes: {
    "/": index,
    "/grove-art/*": (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const file = Bun.file(`${PUBLIC}${path}`);
      return file.size ? new Response(file) : new Response("", { status: 404 });
    },
  },
});

console.log(`Sequoia Grove: ${server.url}`);
