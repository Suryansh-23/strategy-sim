import { describe, expect, test } from "bun:test";

import app from "../src/agent.js";

const basePayload = {
  protocol: "morpho-blue",
  chain: "base",
  collateral: { symbol: "WETH", decimals: 18 },
  debt: { symbol: "USDC", decimals: 6 },
  start_capital: "1",
  target_ltv: 0.5,
  loops: 1,
};

describe("simulateLooping API", () => {
  test("responds with 402 when unpaid", async () => {
    const response = await app.request("/entrypoints/simulateLooping/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: basePayload }),
    });

    expect(response.status).toBe(402);
    const body = (await response.json()) as {
      x402Version?: number;
    };
    expect(body.x402Version).toBe(1);
  });
});
