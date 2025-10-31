import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

export const MIN_SLIPPAGE_BPS = 50; // 0.5%
export const MAX_SLIPPAGE_BPS = 1000; // 10%
export const FEE_OVERHEAD_PCT = 0.3; // 0.3% overhead for fees

export const ERROR_MESSAGES = {
  INVALID_TOKEN_ADDRESS: "Invalid token address format",
  NO_POOLS_FOUND: "No matching liquidity pool found for this token pair.",
  INVALID_AMOUNT: "Invalid amount: must be a positive number",
  API_ERROR: "Failed to fetch pool data",
  CALCULATION_ERROR: "Error calculating slippage",
} as const;

export const CHAIN_MAP: Record<string, string> = {
  eth: "eth",
  ethereum: "eth",
  bsc: "bsc",
  "binance-smart-chain": "bsc",
  polygon: "polygon",
  matic: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  avalanche: "avax",
  avax: "avax",
  fantom: "ftm",
  ftm: "fantom",
};

// ============================================================================
// Zod Schemas
// ============================================================================

export const SafeSlippageInputSchema = z.object({
  token_in: z.string().min(1, "token_in is required"),
  token_out: z.string().min(1, "token_out is required"),
  amount_in: z.coerce
    .number()
    .positive("amount_in must be positive")
    .describe("Amount to trade (number or string, e.g., 10 or '10')"),
  route_hint: z.string().optional(),
});

export const SafeSlippageOutputSchema = z.object({
  min_safe_slip_bps: z.number().optional(),
  pool_depths: z.number().optional(),
  recent_trade_size_p95: z.number().optional(),
  volatility_index: z.number().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Type Definitions
// ============================================================================

export type SafeSlippageInput = z.infer<typeof SafeSlippageInputSchema>;
export type SafeSlippageOutput = z.infer<typeof SafeSlippageOutputSchema>;

export interface TokenInfo {
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
}

export interface LiquidityInfo {
  usd: number;
  base?: number;
  quote?: number;
}

export interface PriceChangeInfo {
  h1?: number;
  h6?: number;
  h24?: number;
  m5?: number;
}

export interface NormalizedPool {
  pairAddress?: string;
  baseToken?: TokenInfo;
  quoteToken?: TokenInfo;
  priceUsd: number;
  liquidity: LiquidityInfo;
  priceChange?: PriceChangeInfo;
  chainId?: string;
  dexId?: string;
  volume?: {
    h24?: number;
  };
  txns?: {
    h24?: {
      buys?: number;
      sells?: number;
    };
  };
}

export interface PoolMetrics {
  maxSafeSlipBps: number;
  maxPoolDepth: number;
  maxTradeP95: number;
  maxVolatility: number;
}

// ============================================================================
// DexScreener API Types
// ============================================================================

export interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress: string;
  baseToken?: {
    address: string;
    name?: string;
    symbol: string;
  };
  quoteToken?: {
    address: string;
    name?: string;
    symbol: string;
  };
  priceNative?: string;
  priceUsd?: string;
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  txns?: {
    m5?: {
      buys?: number;
      sells?: number;
    };
    h1?: {
      buys?: number;
      sells?: number;
    };
    h6?: {
      buys?: number;
      sells?: number;
    };
    h24?: {
      buys?: number;
      sells?: number;
    };
  };
  volume?: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  info?: {
    imageUrl?: string;
    websites?: Array<{ label: string; url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

// ============================================================================
// GeckoTerminal API Types
// ============================================================================

export interface GeckoTerminalPool {
  id: string;
  type: string;
  attributes: {
    base_token?: {
      address: string;
      name?: string;
      symbol: string;
    };
    quote_token?: {
      address: string;
      name?: string;
      symbol: string;
    };
    name?: string;
    pool_created_at?: string;
    token_price_usd?: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    base_token_price_native_currency?: string;
    quote_token_price_native_currency?: string;
    pool_address?: string;
    price_change_percentage_1h?: string;
    price_change_percentage_24h?: string;
    price_change_percentage_7d?: string;
    transactions_1h_count?: number;
    transactions_24h_count?: number;
    volume_usd_1h?: string;
    volume_usd_24h?: string;
    reserve_in_usd?: string;
  };
  relationships?: {
    dex?: {
      data?: {
        id: string;
        type: string;
      };
    };
  };
}

export interface GeckoTerminalResponse {
  data: GeckoTerminalPool[];
  links?: {
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
  meta?: {
    base?: {
      address: string;
      name: string;
      symbol: string;
    };
    quote?: {
      address: string;
      name: string;
      symbol: string;
    };
  };
}

// ============================================================================
// 1inch API Types (for testing)
// ============================================================================

export interface OneInchQuoteResponse {
  fromToken: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    logoURI: string;
  };
  toToken: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    logoURI: string;
  };
  toTokenAmount: string;
  fromTokenAmount: string;
  protocols: Array<
    Array<
      Array<{
        name: string;
        part: number;
        fromTokenAddress: string;
        toTokenAddress: string;
      }>
    >
  >;
  estimatedGas: number;
}

export interface OneInchSwapResponse extends OneInchQuoteResponse {
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gasPrice: string;
    gas: number;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

export type ChainId = keyof typeof CHAIN_MAP;

export interface ApiError {
  message: string;
  code?: string | number;
  status?: number;
}

export interface SlippageCalculationParams {
  tradeAmountUsd: number;
  poolDepthUsd: number;
  volatility24h: number;
  feeOverhead?: number;
}

export interface SlippageResult {
  recommendedSlippageBps: number;
  minSlippageBps: number;
  maxSlippageBps: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasoning: string;
}
