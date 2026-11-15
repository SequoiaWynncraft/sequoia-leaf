import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

// Every error response has the same shape: a stable machine-readable `code`
// and a human-readable `message`. Clients branch on `code` only.
app.notFound((c) => c.json({ code: "not_found", message: "No such route" }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ code: "internal_error", message: "Something went wrong" }, 500);
});

export default app;
