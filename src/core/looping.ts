import crypto from "node:crypto";

import BigNumber from "bignumber.js";

import type {
  LoopingSimulationInput,
  LoopingSimulationResult,
  SimulationStep,
} from "../types.js";
import { getConstantProductQuote } from "../models/amm_xyk.js";
import { resolveOraclePrice } from "../models/oracle.js";
import type { MorphoMarketSnapshot } from "../adapters/morpho.js";
import type { KyberQuoteResult } from "../adapters/kyber.js";

const SECONDS_PER_YEAR = 31_536_000; // 365 days
const SECONDS_PER_DAY = 86_400;

export interface SwapQuoteInput {
  amountInDebt: BigNumber; // human units (e.g. USDC)
  idealAmountOutCollateral: BigNumber;
  borrowValueUsd: BigNumber;
}

export interface SwapQuoteOutput {
  amountOutCollateral: BigNumber;
  feesUsd: BigNumber;
  route?: unknown;
  provenance?: unknown;
}

export type SwapQuoteProvider = (
  input: SwapQuoteInput,
) => Promise<SwapQuoteOutput>;

export interface SimulationDependencies {
  marketSnapshot: MorphoMarketSnapshot;
  priceMap: Record<string, number>;
  swapProvider: SwapQuoteProvider;
  oracleLagSeconds?: number;
}

export interface SimulationArtifacts {
  result: LoopingSimulationResult;
  provenance: {
    version: string;
    input: LoopingSimulationInput;
    protocol_params_used: LoopingSimulationResult["protocol_params_used"];
    prices: Record<string, number>;
    kyber_quotes: unknown[];
    timestamp: number;
  };
}

export const SIM_ENGINE_VERSION = "0.2.0";

function resolvePrice(
  symbol: string,
  priceMap: Record<string, number>,
  fallback: number,
): number {
  const upper = symbol.toUpperCase();
  const direct = priceMap[upper];
  if (typeof direct === "number") {
    return direct;
  }

  const usdKey = `${upper}USD`;
  const usd = priceMap[usdKey];
  if (typeof usd === "number") {
    return usd;
  }

  return fallback;
}

function expApr(amount: BigNumber, apr: number, days: number): BigNumber {
  if (apr === 0 || days === 0) {
    return amount;
  }

  const exponent = (apr * days * SECONDS_PER_DAY) / SECONDS_PER_YEAR;
  const growth = Math.exp(exponent);
  return amount.multipliedBy(growth);
}

function bigMax(value: BigNumber): BigNumber {
  return value.isNegative() ? new BigNumber(0) : value;
}

function bigToNumber(value: BigNumber): number {
  return Number(value.toFixed(12, BigNumber.ROUND_HALF_UP));
}

function computeLiquidationPrice(
  collateralAmount: BigNumber,
  debtAmount: BigNumber,
  debtPriceUsd: number,
  lltv: number,
): number {
  if (collateralAmount.isZero() || lltv === 0) {
    return Infinity;
  }

  const numerator = debtAmount.multipliedBy(debtPriceUsd);
  const denom = collateralAmount.multipliedBy(lltv);
  if (denom.isZero()) {
    return Infinity;
  }

  return numerator.dividedBy(denom).toNumber();
}

function buildTimeSeries(params: {
  collateralAmount: BigNumber;
  debtAmount: BigNumber;
  horizonDays: number;
  supplyApr: number;
  borrowApr: number;
  collateralPriceUsd: number;
  debtPriceUsd: number;
  lltv: number;
  oracleLagSeconds?: number;
}): Array<LoopingSimulationResult["time_series"][number]> {
  const {
    collateralAmount,
    debtAmount,
    horizonDays,
    supplyApr,
    borrowApr,
    collateralPriceUsd,
    debtPriceUsd,
    lltv,
    oracleLagSeconds,
  } = params;

  const series: Array<LoopingSimulationResult["time_series"][number]> = [];
  let oracleState = {
    lastPrice: collateralPriceUsd,
    lastUpdateTimestamp: 0,
  };

  for (let day = 0; day <= horizonDays; day += 1) {
    const collateralAtT = expApr(collateralAmount, supplyApr, day);
    const debtAtT = expApr(debtAmount, borrowApr, day);

    const timestamp = day * SECONDS_PER_DAY;
    const { price: oraclePrice, state } = resolveOraclePrice({
      spotPrice: collateralPriceUsd,
      timestamp,
      config: oracleLagSeconds
        ? {
            lagSeconds: oracleLagSeconds,
          }
        : undefined,
      state: oracleState,
    });
    oracleState = state;

    const collateralValueUsd = collateralAtT.multipliedBy(oraclePrice);
    const debtValueUsd = debtAtT.multipliedBy(debtPriceUsd);
    const equityUsd = collateralValueUsd.minus(debtValueUsd);

    const hf = debtValueUsd.isZero()
      ? Number.POSITIVE_INFINITY
      : collateralValueUsd.multipliedBy(lltv).dividedBy(debtValueUsd).toNumber();

    series.push({
      t: day,
      collateral: bigToNumber(collateralAtT),
      debt: bigToNumber(debtAtT),
      equity: bigToNumber(equityUsd),
      hf,
    });
  }

  return series;
}

function runPriceJumpScenario(params: {
  baseSeries: Array<LoopingSimulationResult["time_series"][number]>;
  shockPct: number;
  atDay: number;
  lltv: number;
  collateralPriceUsd: number;
  debtPriceUsd: number;
}): { minHf: number; liquidated: boolean; liqLossUsd?: number } {
  const {
    baseSeries,
    shockPct,
    atDay,
    lltv,
    collateralPriceUsd,
    debtPriceUsd,
  } = params;
  let minHf = Number.POSITIVE_INFINITY;
  let liqLossUsd: number | undefined;

  for (const point of baseSeries) {
    const priceMultiplier = point.t >= atDay ? 1 + shockPct : 1;
    const collateralValueUsd =
      point.collateral * collateralPriceUsd * priceMultiplier;
    const debtValueUsd = point.debt * debtPriceUsd;

    const hf = debtValueUsd === 0
      ? Number.POSITIVE_INFINITY
      : (collateralValueUsd * lltv) / debtValueUsd;

    if (hf < minHf) {
      minHf = hf;
      if (hf < 1) {
        const shortfall = debtValueUsd - collateralValueUsd * lltv;
        liqLossUsd = shortfall > 0 ? shortfall : undefined;
      }
    }
  }

  if (!Number.isFinite(minHf)) {
    minHf = Number.POSITIVE_INFINITY;
  }

  return {
    minHf,
    liquidated: minHf < 1,
    liqLossUsd,
  };
}

function evaluateSeries(
  series: Array<LoopingSimulationResult["time_series"][number]>,
  lltv: number,
  collateralPriceUsd: number,
  debtPriceUsd: number,
): { minHf: number; liquidated: boolean; liqLossUsd?: number } {
  let minHf = Number.POSITIVE_INFINITY;
  let liqLossUsd: number | undefined;

  for (const point of series) {
    const hf = point.hf;
    if (hf < minHf) {
      minHf = hf;
      if (hf < 1) {
        const collateralValueUsd = point.collateral * collateralPriceUsd;
        const debtValueUsd = point.debt * debtPriceUsd;
        const shortfall = debtValueUsd - collateralValueUsd * lltv;
        liqLossUsd = shortfall > 0 ? shortfall : undefined;
      }
    }
  }

  if (!Number.isFinite(minHf)) {
    minHf = Number.POSITIVE_INFINITY;
  }

  return {
    minHf,
    liquidated: minHf < 1,
    liqLossUsd,
  };
}

export async function simulateLooping(
  input: LoopingSimulationInput,
  deps: SimulationDependencies,
): Promise<SimulationArtifacts> {
  const { marketSnapshot, priceMap, swapProvider, oracleLagSeconds } = deps;

  const collateralPriceUsd = resolvePrice(
    input.collateral.symbol,
    priceMap,
    marketSnapshot.defaultPrices.WETHUSD,
  );
  const debtPriceUsd = resolvePrice(
    input.debt.symbol,
    priceMap,
    marketSnapshot.defaultPrices.USDCUSD,
  );

  const supplyApr = input.rates?.supply_apr ?? marketSnapshot.rates.supplyApr;
  const borrowApr = input.rates?.borrow_apr ?? marketSnapshot.rates.borrowApr;
  const horizonDays = input.horizon_days ?? 30;

  const collateralAmount = new BigNumber(input.start_capital);
  if (!collateralAmount.isFinite() || collateralAmount.isNegative()) {
    throw new Error("start_capital must be a positive numeric string");
  }

  const borrowFraction = new BigNumber(input.target_ltv).dividedBy(
    marketSnapshot.market.lltv,
  );

  let runningCollateral = collateralAmount;
  let runningDebt = new BigNumber(0);
  let collateralValueUsd = runningCollateral.multipliedBy(collateralPriceUsd);
  let debtValueUsd = new BigNumber(0);
  let slippageCostUsd = new BigNumber(0);

  const actionPlan: SimulationStep[] = [];
  const kyberQuotes: unknown[] = [];

  for (let i = 0; i < input.loops; i += 1) {
    const borrowValueUsd = collateralValueUsd.multipliedBy(borrowFraction);
    if (borrowValueUsd.isZero()) {
      break;
    }

    const borrowAmountDebt = borrowValueUsd.dividedBy(debtPriceUsd);

    const idealOutCollateral = borrowValueUsd.dividedBy(collateralPriceUsd);

    const quote = await swapProvider({
      amountInDebt: borrowAmountDebt,
      idealAmountOutCollateral: idealOutCollateral,
      borrowValueUsd,
    });

    if (quote.provenance) {
      kyberQuotes.push(quote.provenance);
    }

    const loopCollateralOut = quote.amountOutCollateral;
    runningCollateral = runningCollateral.plus(loopCollateralOut);
    runningDebt = runningDebt.plus(borrowAmountDebt);

    collateralValueUsd = runningCollateral.multipliedBy(collateralPriceUsd);
    debtValueUsd = runningDebt.multipliedBy(debtPriceUsd);

    const slippageUnits = idealOutCollateral.minus(loopCollateralOut);
    const slippageUsd = bigMax(slippageUnits).multipliedBy(collateralPriceUsd);
    const loopFeesUsd = quote.feesUsd ?? new BigNumber(0);

    slippageCostUsd = slippageCostUsd.plus(slippageUsd).plus(loopFeesUsd);

    actionPlan.push({
      borrow: {
        asset: input.debt.symbol,
        amount: bigToNumber(borrowAmountDebt),
      },
      swap: {
        from: input.debt.symbol,
        to: input.collateral.symbol,
        amount_in: bigToNumber(borrowAmountDebt),
        amount_out: bigToNumber(loopCollateralOut),
        route: quote.route,
      },
      supply: {
        asset: input.collateral.symbol,
        amount: bigToNumber(loopCollateralOut),
      },
    });
  }

  const hfNow = debtValueUsd.isZero()
    ? Number.POSITIVE_INFINITY
    : collateralValueUsd
        .multipliedBy(marketSnapshot.market.lltv)
        .dividedBy(debtValueUsd)
        .toNumber();

  const equityUsd = collateralValueUsd.minus(debtValueUsd);
  const grossLeverage = equityUsd.lte(0)
    ? Number.POSITIVE_INFINITY
    : collateralValueUsd.dividedBy(equityUsd).toNumber();

  const timeSeries = buildTimeSeries({
    collateralAmount: runningCollateral,
    debtAmount: runningDebt,
    horizonDays,
    supplyApr,
    borrowApr,
    collateralPriceUsd,
    debtPriceUsd,
    lltv: marketSnapshot.market.lltv,
    oracleLagSeconds,
  });

  const stressResults: LoopingSimulationResult["stress"] = [];
  if (input.scenarios) {
    for (const scenario of input.scenarios) {
      if (scenario.type === "price_jump") {
        const outcome = runPriceJumpScenario({
          baseSeries: timeSeries,
          shockPct: scenario.shock_pct,
          atDay: scenario.at_day,
          lltv: marketSnapshot.market.lltv,
          collateralPriceUsd,
          debtPriceUsd,
        });
        stressResults.push({
          scenario: `price_jump:${scenario.asset}:${scenario.shock_pct}:${scenario.at_day}`,
          min_hf: outcome.minHf,
          liquidated: outcome.liquidated,
          liq_loss_usd: outcome.liqLossUsd,
        });
      } else if (scenario.type === "rates_shift") {
        const delta = scenario.borrow_apr_delta_bps / 10_000;
        const shiftedSeries = buildTimeSeries({
          collateralAmount: runningCollateral,
          debtAmount: runningDebt,
          horizonDays,
          supplyApr,
          borrowApr: borrowApr + delta,
          collateralPriceUsd,
          debtPriceUsd,
          lltv: marketSnapshot.market.lltv,
          oracleLagSeconds,
        });
        const outcome = evaluateSeries(
          shiftedSeries,
          marketSnapshot.market.lltv,
          collateralPriceUsd,
          debtPriceUsd,
        );
        stressResults.push({
          scenario: `rates_shift:${scenario.borrow_apr_delta_bps}`,
          min_hf: outcome.minHf,
          liquidated: outcome.liquidated,
          liq_loss_usd: outcome.liqLossUsd,
        });
      } else if (scenario.type === "oracle_lag") {
        const laggedSeries = buildTimeSeries({
          collateralAmount: runningCollateral,
          debtAmount: runningDebt,
          horizonDays,
          supplyApr,
          borrowApr,
          collateralPriceUsd,
          debtPriceUsd,
          lltv: marketSnapshot.market.lltv,
          oracleLagSeconds: scenario.lag_seconds,
        });
        const outcome = evaluateSeries(
          laggedSeries,
          marketSnapshot.market.lltv,
          collateralPriceUsd,
          debtPriceUsd,
        );
        stressResults.push({
          scenario: `oracle_lag:${scenario.lag_seconds}`,
          min_hf: outcome.minHf,
          liquidated: outcome.liquidated,
          liq_loss_usd: outcome.liqLossUsd,
        });
      }
    }
  }

  const liqPrice = {
    [input.collateral.symbol]: computeLiquidationPrice(
      runningCollateral,
      runningDebt,
      debtPriceUsd,
      marketSnapshot.market.lltv,
    ),
  };

  const slipCostNumber = bigToNumber(slippageCostUsd);

  const equityStart = timeSeries[0]?.equity ?? 0;
  const equityEnd = timeSeries[timeSeries.length - 1]?.equity ?? equityStart;
  const horizonYears = horizonDays / 365;
  const netApr =
    equityStart > 0 && horizonYears > 0
      ? (equityEnd - equityStart) / equityStart / horizonYears
      : supplyApr - borrowApr;

  const summary = {
    loops_done: actionPlan.length,
    gross_leverage: grossLeverage,
    net_apr: netApr,
    hf_now: hfNow,
    liq_price: liqPrice,
    slip_cost_usd: slipCostNumber,
  } satisfies LoopingSimulationResult["summary"];

  const protocolParams = marketSnapshot.market;

  const pricesUsed = {
    ...marketSnapshot.defaultPrices,
    ...priceMap,
  };

  const provenancePayload = {
    version: SIM_ENGINE_VERSION,
    input,
    protocol_params_used: protocolParams,
    prices: pricesUsed,
    kyber_quotes: kyberQuotes,
    timestamp: Date.now(),
  };

  const provenance_hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(provenancePayload))
    .digest("hex");

  const result: LoopingSimulationResult = {
    summary,
    time_series: timeSeries,
    stress: stressResults,
    action_plan: actionPlan,
    protocol_params_used: protocolParams,
    receipt: {
      payment: null,
      provenance_hash,
    },
  };

  return {
    result,
    provenance: provenancePayload,
  };
}

export function createAmmSwapProvider(params: {
  feeBps: number;
  poolBaseReserve: number;
  poolQuoteReserve: number;
  collateralPriceUsd: number;
  debtPriceUsd: number;
}): SwapQuoteProvider {
  let reserveCollateral = new BigNumber(params.poolBaseReserve);
  let reserveDebt = new BigNumber(params.poolQuoteReserve);
  const feeBps = params.feeBps;
  const _collateralPriceUsd = params.collateralPriceUsd;
  const debtPriceUsd = params.debtPriceUsd;

  return async ({ amountInDebt }): Promise<SwapQuoteOutput> => {
    const quote = getConstantProductQuote({
      amountIn: amountInDebt,
      reserveIn: reserveDebt,
      reserveOut: reserveCollateral,
      feeBps,
    });

    reserveDebt = reserveDebt.plus(amountInDebt);
    reserveCollateral = reserveCollateral.minus(quote.amountOut);

    const feeUsd = quote.feePaid.multipliedBy(debtPriceUsd);

    return {
      amountOutCollateral: quote.amountOut,
      feesUsd: feeUsd,
      route: {
        model: "amm_xyk",
        fee_bps: feeBps,
      },
    };
  };
}

export function createKyberSwapProvider(params: {
  getQuote: (amountIn: BigNumber) => Promise<KyberQuoteResult>;
  collateralPriceUsd: number;
  debtPriceUsd: number;
  collateralDecimals: number;
  debtDecimals: number;
}): SwapQuoteProvider {
  const { getQuote, collateralDecimals, debtDecimals } = params;
  const collateralPriceUsd = params.collateralPriceUsd;
  const debtPriceUsd = params.debtPriceUsd;

  return async ({ amountInDebt }): Promise<SwapQuoteOutput> => {
    const scaleDebt = new BigNumber(10).pow(debtDecimals);
    const amountInScaled = amountInDebt
      .multipliedBy(scaleDebt)
      .integerValue(BigNumber.ROUND_FLOOR);
    const quote = await getQuote(amountInScaled);

    const scaleCollateral = new BigNumber(10).pow(collateralDecimals);
    const amountOutCollateral = quote.amountOut.dividedBy(scaleCollateral);

    const amountInUsd = amountInDebt.multipliedBy(debtPriceUsd);
    const amountOutUsd = amountOutCollateral.multipliedBy(collateralPriceUsd);
    const impliedFees = bigMax(amountInUsd.minus(amountOutUsd));

    return {
      amountOutCollateral,
      feesUsd: impliedFees,
      route: quote.route,
      provenance: quote.raw,
    };
  };
}
