import { describe, expect, test } from "bun:test";
import BigNumber from "bignumber.js";

import { simulateLooping, createAmmSwapProvider } from "../src/core/looping.js";
import { loadMorphoMarketSnapshot } from "../src/adapters/morpho.js";
import type { LoopingSimulationInput } from "../src/types.js";

process.env.MORPHO_LIVE_DISABLED = "1";

describe("looping simulation", () => {
  test("produces expected health factor for simple loop", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateralSymbol: "WETH",
      debtSymbol: "USDC",
    });

    const input: LoopingSimulationInput = {
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
      start_capital: "1",
      target_ltv: 0.6,
      loops: 1,
      price: {
        WETHUSD: 2000,
        USDCUSD: 1,
      },
      swap_model: {
        type: "amm_xyk",
        fee_bps: 30,
        pool: {
          base_reserve: 10_000,
          quote_reserve: 20_000_000,
        },
      },
      rates: {
        supply_apr: 0,
        borrow_apr: 0,
      },
      horizon_days: 7,
    };

    const swapModel = input.swap_model;
    if (!swapModel) {
      throw new Error("swap model missing in test setup");
    }

    const swapProvider = createAmmSwapProvider({
      feeBps: swapModel.fee_bps,
      poolBaseReserve: swapModel.pool.base_reserve,
      poolQuoteReserve: swapModel.pool.quote_reserve,
      collateralPriceUsd: 2000,
      debtPriceUsd: 1,
    });

    const priceMap = {
      ...snapshot.defaultPrices,
      ...input.price,
    };

    const simulation = await simulateLooping(input, {
      marketSnapshot: snapshot,
      priceMap,
      swapProvider,
    });

    const borrowFraction = input.target_ltv / snapshot.market.lltv;
    const initialCollateralUsd = 2000;
    const debtUsd = initialCollateralUsd * borrowFraction;
    const collateralAfterSwap = 1 + debtUsd * (1 - swapModel.fee_bps / 10_000) / 2000;
    const collateralValueUsd = collateralAfterSwap * 2000;
    const expectedHf =
      (collateralValueUsd * snapshot.market.lltv) / debtUsd;

    expect(simulation.result.summary.loops_done).toBe(1);
    expect(simulation.result.summary.hf_now).toBeCloseTo(expectedHf, 2);
  });

  test("accrues interest over horizon", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateralSymbol: "WETH",
      debtSymbol: "USDC",
    });

    const input: LoopingSimulationInput = {
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
      start_capital: "1",
      target_ltv: 0.5,
      loops: 1,
      price: {
        WETHUSD: 3000,
        USDCUSD: 1,
      },
      swap_model: {
        type: "amm_xyk",
        fee_bps: 0,
        pool: {
          base_reserve: 100_000,
          quote_reserve: 300_000_000,
        },
      },
      rates: {
        supply_apr: 0.05,
        borrow_apr: 0.03,
      },
      horizon_days: 30,
    };

    const swapModel = input.swap_model;
    if (!swapModel) {
      throw new Error("swap model missing in test setup");
    }

    const swapProvider = createAmmSwapProvider({
      feeBps: swapModel.fee_bps,
      poolBaseReserve: swapModel.pool.base_reserve,
      poolQuoteReserve: swapModel.pool.quote_reserve,
      collateralPriceUsd: 3000,
      debtPriceUsd: 1,
    });

    const priceMap = {
      ...snapshot.defaultPrices,
      ...input.price,
    };

    const simulation = await simulateLooping(input, {
      marketSnapshot: snapshot,
      priceMap,
      swapProvider,
    });

    const day30 = simulation.result.time_series.find((p) => p.t === 30);
    if (!day30) {
      throw new Error("missing day 30 data");
    }

    const equityStart = simulation.result.time_series[0];

    const collateral0 = new BigNumber(equityStart.collateral);
    const debt0 = new BigNumber(equityStart.debt);

    const expFactor = (rate: number) =>
      Math.exp((rate * 30 * 86_400) / 31_536_000);

    const expectedCollateral = collateral0.multipliedBy(expFactor(0.05));
    const expectedDebt = debt0.multipliedBy(expFactor(0.03));

    expect(day30.collateral).toBeCloseTo(expectedCollateral.toNumber(), 6);
    expect(day30.debt).toBeCloseTo(expectedDebt.toNumber(), 6);
  });

  test("rates shift scenario increases debt burden", async () => {
    const snapshot = await loadMorphoMarketSnapshot({
      protocol: "morpho-blue",
      chain: "base",
      collateralSymbol: "WETH",
      debtSymbol: "USDC",
    });

    const input: LoopingSimulationInput = {
      protocol: "morpho-blue",
      chain: "base",
      collateral: { symbol: "WETH", decimals: 18 },
      debt: { symbol: "USDC", decimals: 6 },
      start_capital: "1",
      target_ltv: 0.5,
      loops: 2,
      price: {
        WETHUSD: 2800,
        USDCUSD: 1,
      },
      swap_model: {
        type: "amm_xyk",
        fee_bps: 20,
        pool: {
          base_reserve: 50_000,
          quote_reserve: 140_000_000,
        },
      },
      rates: {
        supply_apr: snapshot.rates.supplyApr,
        borrow_apr: snapshot.rates.borrowApr,
      },
      horizon_days: 30,
      scenarios: [
        {
          type: "rates_shift",
          borrow_apr_delta_bps: 300,
        },
      ],
    };

    const swapModel = input.swap_model;
    if (!swapModel) throw new Error("swap model missing");

    const swapProvider = createAmmSwapProvider({
      feeBps: swapModel.fee_bps,
      poolBaseReserve: swapModel.pool.base_reserve,
      poolQuoteReserve: swapModel.pool.quote_reserve,
      collateralPriceUsd: 2800,
      debtPriceUsd: 1,
    });

    const priceMap = {
      ...snapshot.defaultPrices,
      ...input.price,
    };

    const simulation = await simulateLooping(input, {
      marketSnapshot: snapshot,
      priceMap,
      swapProvider,
    });

    const baseMinHf = Math.min(
      ...simulation.result.time_series.map((point) => point.hf),
    );
    const stress = simulation.result.stress[0];
    expect(stress.scenario).toBe("rates_shift:300");
    expect(stress.min_hf).toBeLessThanOrEqual(baseMinHf);
  });
});
