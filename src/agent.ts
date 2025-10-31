import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";
import { exact } from "x402/schemes";
import { HTTPException } from "hono/http-exception";
import type BigNumber from "bignumber.js";

import { LoopingSimulationInputSchema } from "./schema.js";
import type { LoopingSimulationInput, LoopingSimulationResult } from "./types.js";
import {
  simulateLooping,
  createAmmSwapProvider,
  createKyberSwapProvider,
} from "./core/looping.js";
import { loadMorphoMarketSnapshot } from "./adapters/morpho.js";
import { getKyberQuote } from "./adapters/kyber.js";
import {
  preSimulationRiskCheck,
  postSimulationRiskCheck,
} from "./risk/canExecute.js";

const PAY_TO_ADDRESS =
  (process.env.PAY_TO as `0x${string}` | undefined) ||
  "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429";
const FACILITATOR_URL = (
  process.env.FACILITATOR_URL || "https://facilitator.daydreams.systems"
) as `${string}://${string}`;
const NETWORK = (process.env.NETWORK as "base" | "base-sepolia") || "base";
const ROUTE_PRICE = "$0.20";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.use(
  paymentMiddleware(
    PAY_TO_ADDRESS,
    {
      "/entrypoints/simulateLooping/invoke": {
        price: ROUTE_PRICE,
        network: NETWORK,
        config: {
          description: "Simulate Morpho Blue looping strategy on Base",
          mimeType: "application/json",
        },
      },
    },
    { url: FACILITATOR_URL },
  ),
);

app.post("/entrypoints/simulateLooping/invoke", async (c) => {
  try {
    const contentType = c.req.header("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new HTTPException(415, {
        message: "Content-Type must be application/json",
      });
    }

    const body = await c.req.json();
    const parsed = LoopingSimulationInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: parsed.error.message,
      });
    }

    const input: LoopingSimulationInput = parsed.data;

    const marketSnapshot = await loadMorphoMarketSnapshot({
      protocol: input.protocol,
      chain: input.chain,
      collateralSymbol: input.collateral.symbol,
      debtSymbol: input.debt.symbol,
    });

    if (input.collateral.decimals !== marketSnapshot.tokens.collateral.decimals) {
      throw new HTTPException(400, {
        message: `Collateral decimals mismatch. Expected ${marketSnapshot.tokens.collateral.decimals}.`,
      });
    }

    if (input.debt.decimals !== marketSnapshot.tokens.debt.decimals) {
      throw new HTTPException(400, {
        message: `Debt decimals mismatch. Expected ${marketSnapshot.tokens.debt.decimals}.`,
      });
    }

    const riskPre = preSimulationRiskCheck(input, marketSnapshot.market);
    if (!riskPre.ok) {
      throw new HTTPException(400, {
        message: `Invalid request: ${riskPre.reasons.join(", ")}`,
      });
    }

    const priceMap: Record<string, number> = {
      ...marketSnapshot.defaultPrices,
      ...(input.price ?? {}),
    };

    const collateralKey = `${input.collateral.symbol.toUpperCase()}USD`;
    const debtKey = `${input.debt.symbol.toUpperCase()}USD`;

    const collateralPriceUsd =
      priceMap[collateralKey] ?? marketSnapshot.defaultPrices.WETHUSD;
    const debtPriceUsd = priceMap[debtKey] ?? marketSnapshot.defaultPrices.USDCUSD;

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
              tokenIn: marketSnapshot.tokens.debt.address,
              tokenOut: marketSnapshot.tokens.collateral.address,
              amount: amountIn,
              slippageBps: 50,
            }),
          collateralPriceUsd,
          debtPriceUsd,
          collateralDecimals: marketSnapshot.tokens.collateral.decimals,
          debtDecimals: marketSnapshot.tokens.debt.decimals,
        });

    const simulation = await simulateLooping(input, {
      marketSnapshot,
      priceMap,
      swapProvider,
      oracleLagSeconds: input.oracle?.lag_seconds,
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
    } else if (input.risk_limits) {
      simulation.result.canExecute = true;
    }

    const paymentHeader = c.req.header("X-PAYMENT");
    if (paymentHeader) {
      try {
        const decoded = exact.evm.decodePayment(paymentHeader);
        simulation.result.receipt.payment = decoded;
      } catch (error) {
        simulation.result.receipt.payment = { error: String(error) };
      }
    }

    return c.json(simulation.result satisfies LoopingSimulationResult);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    console.error("simulateLooping error", error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default app;
