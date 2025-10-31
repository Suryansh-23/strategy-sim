import app from "./agent";

const port = Number(process.env.PORT || 8787);

console.log(`🚀 Starting Slippage Sentinel server on port ${port}`);

app.start();

// Start server using Bun's HTTP server
export default {
  port,
  fetch: app.fetch.bind(app),
};