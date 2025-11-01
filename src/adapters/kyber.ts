import axios, { AxiosResponse } from "axios";
import BigNumber from "bignumber.js";
import { LRUCache } from "lru-cache";

const KYBER_CACHE_TTL_SECONDS = 30;

const cache = new LRUCache<string, KyberQuoteResult>({
  max: 256,
  ttl: KYBER_CACHE_TTL_SECONDS * 1000,
});

const DEFAULT_BASE_URL = "https://aggregator-api.kyberswap.com";

const CHAIN_SLUG_MAP: Record<string, string> = {
  base: "base",
};

export interface KyberQuoteOptions {
  includedSources?: string;
  excludedSources?: string;
  excludeRfq?: boolean;
  onlyScalableSources?: boolean;
  onlyDirectPools?: boolean;
  onlySinglePath?: boolean;
  gasInclude?: boolean;
  gasPriceWei?: string;
  feeAmount?: string;
  chargeFeeBy?: "currency_in" | "currency_out";
  isInBps?: boolean;
  feeReceiver?: string;
  origin?: string;
}

export interface KyberQuoteParams {
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amount: BigNumber;
  slippageBps?: number;
  options?: KyberQuoteOptions;
}

export interface KyberQuoteResult {
  amountOut: BigNumber;
  route?: unknown;
  raw?: unknown;
}

function buildCacheKey(params: KyberQuoteParams): string {
  const { chain, tokenIn, tokenOut, amount, slippageBps } = params;
  return [
    chain,
    tokenIn.toLowerCase(),
    tokenOut.toLowerCase(),
    amount.toFixed(),
    slippageBps ?? "default",
  ].join(":");
}

export async function getKyberQuote(
  params: KyberQuoteParams
): Promise<KyberQuoteResult> {
  const cacheKey = buildCacheKey(params);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const chainSlug = CHAIN_SLUG_MAP[params.chain];
  if (!chainSlug) {
    throw new Error(`Kyber quote unsupported chain: ${params.chain}`);
  }

  const baseUrl = process.env.KYBER_AGGREGATOR_BASE_URL || DEFAULT_BASE_URL;
  const url = `${baseUrl}/${chainSlug}/api/v1/routes`;

  const slippagePercent = (params.slippageBps ?? 100) / 100;
  const tokenIn = params.tokenIn.toLowerCase();
  const tokenOut = params.tokenOut.toLowerCase();
  const amountIn = params.amount.toFixed(0);
  const clientSource = process.env.KYBER_CLIENT_SOURCE || "strategy-sim";
  const clientId = process.env.KYBER_CLIENT_ID || clientSource;
  const opts = params.options ?? {};

  const query: Record<string, string | boolean> = {
    tokenIn,
    tokenOut,
    amountIn,
  };

  const envInclude = process.env.KYBER_INCLUDE_SOURCES;
  const envExclude = process.env.KYBER_EXCLUDE_SOURCES;
  if (envInclude) query.includedSources = envInclude;
  if (envExclude) query.excludedSources = envExclude;

  if (opts.includedSources) query.includedSources = opts.includedSources;
  if (opts.excludedSources) query.excludedSources = opts.excludedSources;
  if (opts.excludeRfq !== undefined) query.excludeRFQSources = opts.excludeRfq;
  if (opts.onlyScalableSources !== undefined)
    query.onlyScalableSources = opts.onlyScalableSources;
  if (opts.onlyDirectPools !== undefined)
    query.onlyDirectPools = opts.onlyDirectPools;
  if (opts.onlySinglePath !== undefined)
    query.onlySinglePath = opts.onlySinglePath;
  if (opts.gasInclude !== undefined) query.gasInclude = opts.gasInclude;
  else query.gasInclude = true;
  if (opts.gasPriceWei) query.gasPrice = opts.gasPriceWei;
  if (opts.feeAmount) query.feeAmount = opts.feeAmount;
  if (opts.chargeFeeBy) query.chargeFeeBy = opts.chargeFeeBy;
  if (opts.isInBps !== undefined) query.isInBps = opts.isInBps;
  if (opts.feeReceiver) query.feeReceiver = opts.feeReceiver;
  if (opts.origin || process.env.KYBER_ORIGIN_ADDRESS) {
    query.origin = opts.origin || process.env.KYBER_ORIGIN_ADDRESS!;
  }

  if (params.slippageBps !== undefined) {
    query.slippageTolerance = slippagePercent.toString();
  }

  try {
    const response = await axios.get(url, {
      params: query,
      timeout: 7_000,
      headers: {
        "X-Client-Id": clientId,
      },
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
    throw new Error(
      `Kyber quote fetch failed [chain=${
        params.chain
      } tokenIn=${tokenIn} tokenOut=${tokenOut} amount=${amountIn}]: ${String(
        error
      )}`
    );
  }
}

export function getKyberCacheSnapshot(): Record<string, KyberQuoteResult> {
  const snapshot: Record<string, KyberQuoteResult> = {};
  cache.forEach((value, key) => {
    snapshot[key] = value;
  });
  return snapshot;
}

export function clearKyberCache(): void {
  cache.clear();
}
