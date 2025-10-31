import { Hono } from "hono";
import {
  createAgentApp,
  type AgentKitConfig,
  type EntrypointDef,
} from "@lucid-dreams/agent-kit";

import {
  SafeSlippageInputSchema,
  SafeSlippageOutputSchema,
  type SafeSlippageInput,
  type SafeSlippageOutput,
  type NormalizedPool,
  type DexScreenerResponse,
  type GeckoTerminalResponse,
  type PoolMetrics,
  ERROR_MESSAGES,
  CHAIN_MAP,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  FEE_OVERHEAD_PCT,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

const dexScreenerBaseUrl =
  process.env.DEX_SCREENER_BASE_URL || "https://api.dexscreener.com";
const geckoTerminalBaseUrl =
  process.env.GECKO_TERMINAL_BASE_URL || "https://api.geckoterminal.com";

const DEFAULT_PAY_TO_ADDRESS: `0x${string}` =
  "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429";

const agentConfig: AgentKitConfig = {
  payments: {
    facilitatorUrl:
      process.env.FACILITATOR_URL || "https://facilitator.daydreams.systems",
    payTo: (process.env.PAY_TO as `0x${string}`) || DEFAULT_PAY_TO_ADDRESS,
    network: process.env.NETWORK || "base",
    defaultPrice: process.env.DEFAULT_PRICE || "0.02",
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeHex(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function buildDexScreenerUrl(
  routeHint: string | undefined,
  tokenIn: string,
): string {
  if (routeHint && routeHint.includes("/")) {
    return `${dexScreenerBaseUrl}/latest/dex/pairs/${routeHint}`;
  }
  return `${dexScreenerBaseUrl}/latest/dex/tokens/${tokenIn}`;
}

// ============================================================================
// API Fetching Functions
// ============================================================================

async function fetchDexScreenerPools(
  tokenIn: string,
  tokenOut: string,
  routeHint?: string,
): Promise<NormalizedPool[]> {
  const url = buildDexScreenerUrl(routeHint, tokenIn);
  const response = await fetch(url, {
    headers: {
      "user-agent": "slippage-sentinel/0.1 (+https://daydreams.systems)",
    },
  });

  if (!response.ok) return [];

  const data: DexScreenerResponse = await response.json();
  const pairs = data.pairs || [];

  const tokenInLower = normalizeHex(tokenIn);
  const tokenOutLower = normalizeHex(tokenOut);
  const routeChain =
    routeHint && !routeHint.includes("/") ? routeHint.toLowerCase() : null;

  return pairs
    .filter((p) => {
      const base = normalizeHex(p?.baseToken?.address);
      const quote = normalizeHex(p?.quoteToken?.address);
      const poolChain = p?.chainId?.toLowerCase();
      const chainMatches = !routeChain || poolChain === routeChain;

      return (
        chainMatches &&
        ((base === tokenInLower && quote === tokenOutLower) ||
          (base === tokenOutLower && quote === tokenInLower))
      );
    })
    .map((p) => ({
      pairAddress: p.pairAddress,
      baseToken: p.baseToken
        ? { address: p.baseToken.address || "", symbol: p.baseToken.symbol }
        : undefined,
      quoteToken: p.quoteToken
        ? { address: p.quoteToken.address || "", symbol: p.quoteToken.symbol }
        : undefined,
      priceUsd: Number(p.priceUsd || 0),
      liquidity: { usd: Number(p.liquidity?.usd || 0) },
      priceChange: { h24: Number(p.priceChange?.h24 || 0) },
      chainId: p.chainId,
      dexId: p.dexId,
    }));
}

async function fetchGeckoTerminalPools(
  tokenIn: string,
  tokenOut: string,
  routeHint?: string,
): Promise<NormalizedPool[]> {
  if (!routeHint || routeHint.includes("/")) return [];

  const geckoChain = CHAIN_MAP[routeHint] || routeHint;
  const url = `${geckoTerminalBaseUrl}/api/v2/networks/${geckoChain}/pools`;

  const response = await fetch(url, {
    headers: {
      "user-agent": "slippage-sentinel/0.1 (+https://daydreams.systems)",
    },
  });

  if (!response.ok) return [];

  const data: GeckoTerminalResponse = await response.json();
  const pools = data.data || [];

  const tokenInLower = normalizeHex(tokenIn);
  const tokenOutLower = normalizeHex(tokenOut);

  return pools
    .filter((p) => {
      const base = normalizeHex(p?.attributes?.base_token?.address);
      const quote = normalizeHex(p?.attributes?.quote_token?.address);
      return (
        (base === tokenInLower && quote === tokenOutLower) ||
        (base === tokenOutLower && quote === tokenInLower)
      );
    })
    .map((p) => ({
      baseToken: p.attributes?.base_token
        ? {
            address: p.attributes.base_token.address || "",
            symbol: p.attributes.base_token.symbol,
          }
        : undefined,
      quoteToken: p.attributes?.quote_token
        ? {
            address: p.attributes.quote_token.address || "",
            symbol: p.attributes.quote_token.symbol,
          }
        : undefined,
      priceUsd: Number(p.attributes?.base_token_price_usd || 0),
      liquidity: { usd: Number(p.attributes?.reserve_in_usd || 0) },
      priceChange: {
        h24: Number(p.attributes?.price_change_percentage_24h || 0),
      },
    }));
}

async function fetchAllPools(
  tokenIn: string,
  tokenOut: string,
  routeHint?: string,
): Promise<NormalizedPool[]> {
  const dexScreenerPools = await fetchDexScreenerPools(
    tokenIn,
    tokenOut,
    routeHint,
  );

  // If DexScreener found pools, use them
  if (dexScreenerPools.length > 0) {
    return dexScreenerPools;
  }

  // Fallback to GeckoTerminal
  const geckoPools = await fetchGeckoTerminalPools(
    tokenIn,
    tokenOut,
    routeHint,
  );
  return geckoPools;
}

// ============================================================================
// Slippage Calculation Logic
// ============================================================================

function analyzePoolMetrics(
  pools: NormalizedPool[],
  tradeAmountUsd: number,
): PoolMetrics {
  let maxSafeSlipBps = MIN_SLIPPAGE_BPS;
  let maxPoolDepth = 0;
  let maxTradeP95 = 0;
  let maxVolatility = 0;

  for (const pool of pools) {
    const poolDepthUsd = pool.liquidity.usd;
    const priceChange24h = pool.priceChange?.h24 || 0;

    if (!Number.isFinite(poolDepthUsd) || poolDepthUsd <= 0) continue;

    // Calculate price impact based on trade size vs pool depth
    const depthRatio = tradeAmountUsd / (poolDepthUsd + 1);
    const baseSlippage = Math.min(Math.max(depthRatio, 0) * 100, 5);

    // Add volatility adjustment
    const volatilityAdj = Math.abs(priceChange24h) / 10;

    // Add fee overhead
    const finalSlipPct = Math.min(
      baseSlippage + volatilityAdj + FEE_OVERHEAD_PCT,
      10,
    );

    // Ensure minimum slippage
    const safeSlipBps = Math.max(
      Math.ceil(finalSlipPct * 100),
      MIN_SLIPPAGE_BPS,
    );
    const cappedSlipBps = Math.min(safeSlipBps, MAX_SLIPPAGE_BPS);

    const tradeP95 = Number((tradeAmountUsd * 0.95).toFixed(2));

    if (cappedSlipBps > maxSafeSlipBps) maxSafeSlipBps = cappedSlipBps;
    if (poolDepthUsd > maxPoolDepth) maxPoolDepth = poolDepthUsd;
    if (tradeP95 > maxTradeP95) maxTradeP95 = tradeP95;
    if (Math.abs(priceChange24h) > maxVolatility)
      maxVolatility = Math.abs(priceChange24h);
  }

  return {
    maxSafeSlipBps,
    maxPoolDepth,
    maxTradeP95,
    maxVolatility,
  };
}

// ============================================================================
// Agent Setup
// ============================================================================

const { app, addEntrypoint, payments } = createAgentApp(
  {
    name: "slippage-sentinel",
    version: "0.1.0",
    description: "Estimate safe slippage tolerance for any route",
  },
  {
    config: agentConfig,
    useConfigPayments: true, // Enable automatic x402 payment handling for consistent behavior
  },
);

const getSafeSlippageEntrypoint: EntrypointDef = {
  key: "getSafeSlippage",
  description: "Estimate safe slippage tolerance for a given swap route",
  input: SafeSlippageInputSchema,
  output: SafeSlippageOutputSchema,
  async handler(ctx) {
    const input = ctx.input as SafeSlippageInput;

    try {
      // Validate inputs
      if (!isValidAddress(input.token_in)) {
        return {
          output: {
            error: `${ERROR_MESSAGES.INVALID_TOKEN_ADDRESS}: token_in`,
          },
        };
      }

      if (!isValidAddress(input.token_out)) {
        return {
          output: {
            error: `${ERROR_MESSAGES.INVALID_TOKEN_ADDRESS}: token_out`,
          },
        };
      }

      // amount_in is already validated and converted by Zod schema
      // No need for manual validation here

      // Fetch pool data
      const pools = await fetchAllPools(
        input.token_in,
        input.token_out,
        input.route_hint,
      );

      if (pools.length === 0) {
        return {
          output: {
            error: ERROR_MESSAGES.NO_POOLS_FOUND,
          },
        };
      }

      // Calculate trade amount in USD
      const firstPool = pools[0];
      const tradeAmountUsd = input.amount_in * firstPool.priceUsd;

      // Analyze metrics and calculate slippage
      const metrics = analyzePoolMetrics(pools, tradeAmountUsd);

      const output: SafeSlippageOutput = {
        min_safe_slip_bps: metrics.maxSafeSlipBps,
        pool_depths: Number(metrics.maxPoolDepth.toFixed(2)),
        recent_trade_size_p95: metrics.maxTradeP95,
        volatility_index: Number(metrics.maxVolatility.toFixed(2)),
      };

      return { output };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      return {
        output: {
          error: `Failed to calculate safe slippage: ${errorMessage}`,
        },
      };
    }
  },
};

addEntrypoint(getSafeSlippageEntrypoint);

// ============================================================================
// Hono App Setup for Vercel
// ============================================================================

const honoApp = new Hono();

// Wrap the agent app's fetch handler for Hono
honoApp.use("*", async (c) => {
  return app.fetch(c.req.raw);
});

const start = () => {
  console.log("Agent ready for deployment (Hono + Vercel).");

  const payTo =
    process.env.PAY_TO || agentConfig.payments?.payTo || DEFAULT_PAY_TO_ADDRESS;
  if (payTo && payTo !== DEFAULT_PAY_TO_ADDRESS) {
    console.log("💰 Agent is ready for payments via x402!");
  } else {
    console.log("⚠️  Agent is running in test mode (payments disabled).");
  }
};

const agentWithStart = Object.assign(honoApp, {
  start,
  payments,
  getSafeSlippageEntrypoint,
}) as typeof honoApp & {
  start: typeof start;
  payments: typeof payments;
  getSafeSlippageEntrypoint: typeof getSafeSlippageEntrypoint;
};

export default agentWithStart;
export { payments, getSafeSlippageEntrypoint };
