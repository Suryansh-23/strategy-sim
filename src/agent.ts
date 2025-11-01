import { createAgentApp, type AgentKitConfig } from "@lucid-dreams/agent-kit";
import { Hono } from "hono";
import type { Network } from "x402-hono";

import { createSimulateLoopingEntrypoint } from "./entrypoints/simulateLooping.js";

const FACILITATOR_URL = (process.env.FACILITATOR_URL ||
  "https://facilitator.daydreams.systems") as `${string}://${string}`;
const NETWORK = (process.env.NETWORK as Network) || "base";

const agentConfig: AgentKitConfig = {
  payments: {
    facilitatorUrl: FACILITATOR_URL,
    payTo: process.env.PAY_TO! as `0x${string}`,
    network: NETWORK,
    defaultPrice: process.env.DEFAULT_PRICE || "0.01",
  },
};

const {
  app: agentApp,
  addEntrypoint,
  payments,
} = createAgentApp(
  {
    name: "morpho-blue-looping-sim",
    version: "0.3.0",
    description:
      "Looping simulator for Morpho Blue (Base) with live market data and stress testing",
  },
  {
    config: agentConfig,
    useConfigPayments: true,
  }
);

const simulateLoopingEntrypoint = createSimulateLoopingEntrypoint({
  network: NETWORK,
});

addEntrypoint(simulateLoopingEntrypoint);

const honoApp = new Hono();

honoApp.use("*", async (c) => {
  // console.debug(`Incoming request: ${c.req.method} ${c.req.url}`);
  // const res = await agentApp.fetch(c.req.raw);
  // console.debug(`Outgoing response: ${res.status} ${res.statusText}`);
  // return res;
  return agentApp.fetch(c.req.raw);
});
// honoApp.use("*", async (c) => agentApp.fetch(c.req.raw));

const start = () => {
  console.log("Agent ready for deployment (Hono + AgentKit)");
  const payTo = process.env.PAY_TO!;
  console.log(`   Network: ${NETWORK}`);
  console.log(`💰 Payments enabled -> ${payTo}`);
};

const agentWithStart = Object.assign(honoApp, {
  start,
  payments,
  simulateLoopingEntrypoint,
}) as typeof honoApp & {
  start: typeof start;
  payments: typeof payments;
  simulateLoopingEntrypoint: typeof simulateLoopingEntrypoint;
};

export default agentWithStart;
export { payments, simulateLoopingEntrypoint };
