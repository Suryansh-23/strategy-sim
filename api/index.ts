import { serve } from "@hono/node-server";

import app from "../src/agent";

export default app;

if (process.env.NODE_ENV !== "production") {
  const port = Number(process.env.PORT) || 8787;
  console.log(`Listening on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
