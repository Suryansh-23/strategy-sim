import { describe, expect, test } from "bun:test";

import { loadMorphoMarketSnapshot } from "../src/adapters/morpho.js";

process.env.MORPHO_LIVE_DISABLED = "1";

describe("morpho adapter", () => {
  test("returns fixture snapshot when live disabled", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateralSymbol: "WETH",
      debtSymbol: "USDC",
    });

    expect(snapshot.source).toBe("fixture");
    expect(snapshot.market.lltv).toBeCloseTo(0.86, 6);
    expect(snapshot.market.oracle_address).toBeDefined();
    expect(snapshot.tokens.collateral.symbol).toBe("WETH");
  });
});
