import { serve } from "@hono/node-server";

import app from "../src/agent";

const args = new Set(process.argv.slice(2));
const debugEnabled = args.has("--debug");

if (debugEnabled) {
  process.env.DEBUG_LOOP = "1";
}

const port = Number(process.env.PORT) || 8787;

console.log("Starting Morpho Blue Looping Simulator");
console.log(`   Network: ${process.env.NETWORK ?? "base"}`);
console.log(
  `   Live Morpho fetch: ${
    process.env.MORPHO_LIVE_DISABLED === "1" ? "disabled" : "enabled"
  }`
);
console.log(`   Rate limit: ${30}/${60000}ms`);
console.log(`   Debug logging: ${debugEnabled ? "enabled" : "disabled"}`);

app.start?.();

console.log(`   Listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
