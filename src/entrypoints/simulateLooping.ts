import type { EntrypointDef } from "@lucid-dreams/agent-kit";
import BigNumber from "bignumber.js";
import type { Network } from "x402-hono";

import { getKyberQuote } from "../adapters/kyber.js";
import { loadMorphoMarketSnapshot } from "../adapters/morpho.js";
import {
  createAmmSwapProvider,
  createKyberSwapProvider,
  simulateLooping,
} from "../core/looping.js";
import {
  postSimulationRiskCheck,
  preSimulationRiskCheck,
} from "../risk/canExecute.js";
import { LoopingSimulationInputSchema } from "../schema.js";
import type {
  LoopingSimulationInput,
  LoopingSimulationResult,
} from "../types.js";
import { getCachedValue, storeValue } from "../utils/idempotency.js";
import { enforceRateLimit } from "../utils/quota.js";

const DEBUG = process.env.DEBUG_LOOP === "1";

function debugLog(message: Record<string, unknown>): void {
  if (!DEBUG) return;
  console.debug(JSON.stringify({ level: "debug", ...message }));
}

function resolveClientIp(headers: Headers): string | null {
  const ipHeader =
    headers.get("x-forwarded-for") ||
    headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    headers.get("x-real-ip") ||
    headers.get("remote-addr") ||
    null;
  return ipHeader?.split(",")[0]?.trim() ?? null;
}

export function createSimulateLoopingEntrypoint(options: {
  network: Network;
}): EntrypointDef {
  const { network } = options;

  return {
    key: "simulateLooping",
    description: "Simulate a looping strategy on Morpho Blue (Base)",
    input: LoopingSimulationInputSchema,
    async handler(ctx) {
      const headers = ctx.headers;
      const clientIp = resolveClientIp(headers);

      enforceRateLimit(clientIp, ctx.key);
      debugLog({ event: "request_received", key: ctx.key, clientIp });

      const idempotencyKey = headers.get("idempotency-key")?.trim();
      if (idempotencyKey) {
        const cached = getCachedValue<LoopingSimulationResult>(idempotencyKey);
        if (cached) {
          console.info(
            JSON.stringify({
              event: "idempotency_hit",
              timestamp: new Date().toISOString(),
              key: idempotencyKey,
            })
          );
          return { output: cached };
        }
      }

      const input = ctx.input as LoopingSimulationInput;

      try {
        const marketSnapshot = await loadMorphoMarketSnapshot({
          protocol: input.protocol,
          chain: input.chain,
          collateral: input.collateral,
          debt: input.debt,
        });

        debugLog({
          event: "market_snapshot",
          market_id: marketSnapshot.market.market_id,
          data_source: marketSnapshot.market.data_source,
          rate_source: marketSnapshot.rates.source,
          utilization: marketSnapshot.rates.utilization,
        });

        const collateralAddress = marketSnapshot.tokens.collateral.address;
        const debtAddress = marketSnapshot.tokens.debt.address;

        if (!collateralAddress || !debtAddress) {
          const message =
            "Unable to resolve token addresses for selected market. Provide explicit addresses in the request.";
          console.warn(
            JSON.stringify({
              event: "market_resolution_failed",
              timestamp: new Date().toISOString(),
              market_id: marketSnapshot.market.market_id,
              message,
            })
          );
          return { output: { error: message } };
        }

        if (
          input.collateral.decimals !==
          marketSnapshot.tokens.collateral.decimals
        ) {
          const message = `Collateral decimals mismatch. Expected ${marketSnapshot.tokens.collateral.decimals}.`;
          console.warn(
            JSON.stringify({
              event: "collateral_decimals_mismatch",
              timestamp: new Date().toISOString(),
              expected: marketSnapshot.tokens.collateral.decimals,
              provided: input.collateral.decimals,
            })
          );
          return { output: { error: message } };
        }

        if (input.debt.decimals !== marketSnapshot.tokens.debt.decimals) {
          const message = `Debt decimals mismatch. Expected ${marketSnapshot.tokens.debt.decimals}.`;
          console.warn(
            JSON.stringify({
              event: "debt_decimals_mismatch",
              timestamp: new Date().toISOString(),
              expected: marketSnapshot.tokens.debt.decimals,
              provided: input.debt.decimals,
            })
          );
          return { output: { error: message } };
        }

        const riskPre = preSimulationRiskCheck(input, marketSnapshot.market);
        if (!riskPre.ok) {
          console.warn(
            JSON.stringify({
              event: "risk_pre_fail",
              timestamp: new Date().toISOString(),
              reasons: riskPre.reasons,
            })
          );
          return {
            output: {
              error: `Invalid request: ${riskPre.reasons.join(", ")}`,
            },
          };
        }

        const priceMap: Record<string, number> = {
          ...marketSnapshot.defaultPrices,
          ...(input.price ?? {}),
        };

        const collateralPriceKey = `${input.collateral.symbol.toUpperCase()}USD`;
        const debtPriceKey = `${input.debt.symbol.toUpperCase()}USD`;

        const collateralPriceUsd =
          priceMap[collateralPriceKey] ?? marketSnapshot.defaultPrices.WETHUSD;
        const debtPriceUsd =
          priceMap[debtPriceKey] ?? marketSnapshot.defaultPrices.USDCUSD;

        const swapProvider = input.swap_model
          ? createAmmSwapProvider({
              feeBps: input.swap_model.fee_bps,
              poolBaseReserve: input.swap_model.pool.base_reserve,
              poolQuoteReserve: input.swap_model.pool.quote_reserve,
              collateralPriceUsd,
              debtPriceUsd,
            })
          : createKyberSwapProvider({
              getQuote: (amountIn: BigNumber) =>
                getKyberQuote({
                  chain: input.chain,
                  tokenIn: debtAddress,
                  tokenOut: collateralAddress,
                  amount: amountIn,
                  slippageBps: 50,
                }),
              collateralPriceUsd,
              debtPriceUsd,
              collateralDecimals: marketSnapshot.tokens.collateral.decimals,
              debtDecimals: marketSnapshot.tokens.debt.decimals,
            });

        debugLog({
          event: "swap_provider_initialized",
          model: input.swap_model ? "amm_xyk" : "kyber",
          collateralPriceUsd,
          debtPriceUsd,
        });

        const simulation = await simulateLooping(input, {
          marketSnapshot,
          priceMap,
          swapProvider,
          oracleLagSeconds: input.oracle?.lag_seconds,
        });

        debugLog({
          event: "simulation_completed",
          loops: simulation.result.summary.loops_done,
          hf_now: simulation.result.summary.hf_now,
          gross_leverage: simulation.result.summary.gross_leverage,
          slip_cost_usd: simulation.result.summary.slip_cost_usd,
        });

        const postCheck = postSimulationRiskCheck({
          healthFactor: simulation.result.summary.hf_now,
          grossLeverage: simulation.result.summary.gross_leverage,
          minHealthFactor: input.risk_limits?.min_hf,
          maxLeverage: input.risk_limits?.max_leverage,
        });

        if (!postCheck.ok) {
          simulation.result.canExecute = false;
          simulation.result.reason = postCheck.reasons.join("; ");
          console.warn(
            JSON.stringify({
              event: "risk_post_fail",
              timestamp: new Date().toISOString(),
              reasons: postCheck.reasons,
            })
          );
        } else {
          simulation.result.canExecute = true;
        }

        const minHf = simulation.result.time_series.reduce((acc, point) => {
          if (!Number.isFinite(point.hf)) return acc;
          return Math.min(acc, point.hf);
        }, Number.POSITIVE_INFINITY);

        console.info(
          JSON.stringify({
            event: "simulation_run",
            timestamp: new Date().toISOString(),
            ip: clientIp,
            network,
            market_id: simulation.result.protocol_params_used.market_id,
            loops: simulation.result.summary.loops_done,
            hf_now: simulation.result.summary.hf_now,
            hf_min: Number.isFinite(minHf) ? minHf : null,
            gross_leverage: simulation.result.summary.gross_leverage,
            slip_cost_usd: simulation.result.summary.slip_cost_usd,
            rate_source: marketSnapshot.rates.source,
            data_source: marketSnapshot.market.data_source,
            can_execute: simulation.result.canExecute,
          })
        );

        if (idempotencyKey) {
          console.debug(`Storing idempotency key ${idempotencyKey}`);
          storeValue(idempotencyKey, simulation.result);
          console.info(
            JSON.stringify({
              event: "idempotency_store",
              timestamp: new Date().toISOString(),
              key: idempotencyKey,
            })
          );
        }

        debugLog({
          event: "response_ready",
          idempotency: idempotencyKey ?? null,
          can_execute: simulation.result.canExecute,
        });

        console.debug("Returning simulation result to client");
        return { output: simulation.result };
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "unexpected_error",
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return {
          output: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    },
  };
}

export { resolveClientIp };
