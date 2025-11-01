import { beforeAll, describe, expect, test } from "bun:test";

import { loadMorphoMarketSnapshot } from "../src/adapters/morpho.js";
import { createAmmSwapProvider, simulateLooping } from "../src/core/looping.js";
import type { LoopingSimulationInput } from "../src/types.js";

beforeAll(() => {
  process.env.MORPHO_LIVE_DISABLED = "1";
});

describe("simulateLooping core engine", () => {
  test("matches baseline sample output", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
    });

    const input: LoopingSimulationInput = {
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
      start_capital: "1",
      target_ltv: 0.6,
      loops: 3,
      horizon_days: 30,
      swap_model: {
        type: "amm_xyk",
        fee_bps: 30,
        pool: {
          base_reserve: 100_000,
          quote_reserve: 300_000_000,
        },
      },
    };

    const swapProvider = createAmmSwapProvider({
      feeBps: input.swap_model!.fee_bps,
      poolBaseReserve: input.swap_model!.pool.base_reserve,
      poolQuoteReserve: input.swap_model!.pool.quote_reserve,
      collateralPriceUsd: snapshot.defaultPrices.WETHUSD,
      debtPriceUsd: snapshot.defaultPrices.USDCUSD,
    });

    const { result } = await simulateLooping(input, {
      marketSnapshot: snapshot,
      priceMap: snapshot.defaultPrices,
      swapProvider,
    });

    expect(result.summary.loops_done).toBe(3);
    expect(result.action_plan).toHaveLength(3);
    expect(result.summary.hf_now).toBeGreaterThan(1);
    expect(result.summary.liq_price.WETH).toBeGreaterThan(0);
    expect(result.time_series).toHaveLength(input.horizon_days + 1);
    expect(result.time_series[0].hf).toBeCloseTo(result.summary.hf_now, 8);
  });

  test("handles full-featured input with scenarios and overrides", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
    });

    const input: LoopingSimulationInput = {
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
      start_capital: "2.5",
      target_ltv: 0.55,
      loops: 2,
      horizon_days: 45,
      price: {
        WETHUSD: 3200,
        USDCUSD: 1,
      },
      rates: {
        supply_apr: 0.02,
        borrow_apr: 0.035,
      },
      oracle: {
        type: "chainlink",
        lag_seconds: 600,
      },
      swap_model: {
        type: "amm_xyk",
        fee_bps: 10,
        pool: {
          base_reserve: 500_000,
          quote_reserve: 150_000_000,
        },
      },
      risk_limits: {
        min_hf: 1.05,
        max_leverage: 8,
      },
      scenarios: [
        {
          type: "price_jump",
          asset: "WETH",
          shock_pct: -0.15,
          at_day: 10,
        },
        {
          type: "rates_shift",
          borrow_apr_delta_bps: 150,
        },
        {
          type: "oracle_lag",
          lag_seconds: 1_200,
        },
      ],
    };

    const swapProvider = createAmmSwapProvider({
      feeBps: input.swap_model!.fee_bps,
      poolBaseReserve: input.swap_model!.pool.base_reserve,
      poolQuoteReserve: input.swap_model!.pool.quote_reserve,
      collateralPriceUsd: input.price!.WETHUSD,
      debtPriceUsd: input.price!.USDCUSD,
    });

    const { result } = await simulateLooping(input, {
      marketSnapshot: snapshot,
      priceMap: { ...snapshot.defaultPrices, ...input.price },
      swapProvider,
      oracleLagSeconds: input.oracle?.lag_seconds,
    });

    expect(result.summary.loops_done).toBe(2);
    expect(result.summary.gross_leverage).toBeLessThanOrEqual(
      input.risk_limits!.max_leverage!
    );
    expect(result.summary.hf_now).toBeGreaterThan(1);
    expect(result.stress).toHaveLength(3);
    expect(result.time_series).toHaveLength((input.horizon_days ?? 30) + 1);
    expect(result.action_plan).toHaveLength(2);
    expect(result.protocol_params_used.data_source).toBe("fixture");
  });
});
