import app from "../src/agent";

// For Vercel deployment, export the Hono app as default
export default app;

// For local development, start the server
if (process.env.NODE_ENV !== "production") {
  app.start();
}
