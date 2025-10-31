import { describe, expect, test } from "bun:test";

import {
  preSimulationRiskCheck,
  postSimulationRiskCheck,
} from "../src/risk/canExecute.js";
import type { LoopingSimulationInput, MorphoMarketParams } from "../src/types.js";

describe("risk checks", () => {
  const market: MorphoMarketParams = {
    lltv: 0.86,
    liquidation_incentive: 0.05,
    close_factor: 0.5,
    irm: "test-irm",
    oracle_type: "chainlink",
  };

  const baseInput: LoopingSimulationInput = {
    protocol: "morpho-blue",
    chain: "base",
    collateral: { symbol: "WETH", decimals: 18 },
    debt: { symbol: "USDC", decimals: 6 },
    start_capital: "1",
    target_ltv: 0.5,
    loops: 2,
  };

  test("rejects invalid target LTV", () => {
    const result = preSimulationRiskCheck(
      { ...baseInput, target_ltv: 0.9 },
      market,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("LLTV"))).toBe(true);
  });

  test("flags health factor breaches", () => {
    const result = postSimulationRiskCheck({
      healthFactor: 1.02,
      grossLeverage: 5,
      minHealthFactor: 1.1,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("health factor");
  });
});
