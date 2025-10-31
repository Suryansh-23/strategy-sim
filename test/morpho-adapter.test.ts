import { describe, expect, test } from "bun:test";

import { loadMorphoMarketSnapshot } from "../src/adapters/morpho.js";

process.env.MORPHO_LIVE_DISABLED = "1";

describe("morpho adapter", () => {
  test("returns fixture snapshot when live disabled", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateral: {
        symbol: "WETH",
        decimals: 18,
        address: "0x4200000000000000000000000000000000000006",
      },
      debt: {
        symbol: "USDC",
        decimals: 6,
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    });

    expect(snapshot.source).toBe("fixture");
    expect(snapshot.market.lltv).toBeCloseTo(0.86, 6);
    expect(snapshot.market.oracle_address).toBeDefined();
    expect(snapshot.tokens.collateral.symbol).toBe("WETH");
  });
});
