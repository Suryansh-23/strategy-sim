import axios from "axios";
import BigNumber from "bignumber.js";
import NodeCache from "node-cache";

const KYBER_CACHE_TTL_SECONDS = 30;

const cache = new NodeCache({
  stdTTL: KYBER_CACHE_TTL_SECONDS,
  useClones: false,
});

const DEFAULT_BASE_URL = "https://aggregator-api.kyberswap.com/best-route";

const CHAIN_ID_MAP: Record<string, number> = {
  base: 8453,
};

export interface KyberQuoteParams {
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amount: BigNumber;
  slippageBps?: number;
}

export interface KyberQuoteResult {
  amountOut: BigNumber;
  route?: unknown;
  raw?: unknown;
}

function buildCacheKey(params: KyberQuoteParams): string {
  const { chain, tokenIn, tokenOut, amount, slippageBps } = params;
  return [chain, tokenIn.toLowerCase(), tokenOut.toLowerCase(), amount.toFixed(), slippageBps ?? "default"].join(":");
}

export async function getKyberQuote(params: KyberQuoteParams): Promise<KyberQuoteResult> {
  const chainId = CHAIN_ID_MAP[params.chain];
  if (!chainId) {
    throw new Error(`Kyber quote unsupported chain: ${params.chain}`);
  }

  const cacheKey = buildCacheKey(params);
  const cached = cache.get<KyberQuoteResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const baseUrl = process.env.KYBER_AGGREGATOR_BASE_URL || DEFAULT_BASE_URL;
  const url = `${baseUrl}/${chainId}`;

  const slippagePercent = (params.slippageBps ?? 100) / 100;

  try {
    const response = await axios.get(url, {
      params: {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amount.toFixed(),
        gasInclude: true,
        saveGas: true,
        slippageTolerance: slippagePercent,
      },
      timeout: 7_000,
    });

    const routeSummary = response.data?.data?.routeSummary;
    if (!routeSummary?.amountOut) {
      throw new Error("Kyber quote response missing amountOut");
    }

    const result: KyberQuoteResult = {
      amountOut: new BigNumber(routeSummary.amountOut),
      route: response.data?.data?.routes,
      raw: response.data,
    };

    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    throw new Error(`Kyber quote fetch failed: ${String(error)}`);
  }
}

export function getKyberCacheSnapshot(): Record<string, KyberQuoteResult> {
  const keys = cache.keys();
  const snapshot: Record<string, KyberQuoteResult> = {};
  for (const key of keys) {
    const value = cache.get<KyberQuoteResult>(key);
    if (value) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

export function clearKyberCache(): void {
  cache.flushAll();
}
