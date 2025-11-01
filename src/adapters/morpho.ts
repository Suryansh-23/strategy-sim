import axios from "axios";
import BigNumber from "bignumber.js";

import type { MorphoMarketParams, TokenSpec } from "../types.js";

export interface MorphoMarketSnapshot {
  market: MorphoMarketParams;
  rates: {
    supplyApr: number;
    borrowApr: number;
    source: "fixture" | "live";
    utilization?: number;
  };
  defaultPrices: Record<string, number>;
  tokens: {
    collateral: TokenSpec;
    debt: TokenSpec;
  };
  source: "fixture" | "live";
  fetchedAt: number;
}

interface LoadParams {
  protocol: string;
  chain: string;
  collateral: TokenSpec;
  debt: TokenSpec;
}

const GRAPH_URL =
  process.env.MORPHO_BLUE_GRAPH_URL || "https://blue-api.morpho.org/graphql";
const CACHE_TTL_MS = 30_000;
const MARKET_LIST_CACHE_MS = 120_000;
const BASE_CHAIN_ID = 8453;

interface GraphAsset {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceUsd?: number | string | null;
}

interface GraphMarketState {
  borrowApy: number | null;
  supplyApy: number | null;
  utilization: number | null;
  supplyAssets: string | null;
  borrowAssets: string | null;
}

interface GraphMarketItem {
  id: string;
  uniqueKey: string;
  lltv: string;
  irmAddress: `0x${string}`;
  oracle: { address: `0x${string}` };
  loanAsset: GraphAsset;
  collateralAsset: GraphAsset;
  morphoBlue: { chain: { id: number; network: string } };
  state: GraphMarketState | null;
}

const WETH_USDC_FIXTURE: MorphoMarketSnapshot = {
  market: {
    lltv: 0.86,
    liquidation_incentive: 0.05,
    close_factor: 0.5,
    irm: "adaptive-curve-irm-v1",
    irm_address: "0x46415998764C29aB2a25CbeA6254146D50D22687",
    oracle_type: "chainlink",
    oracle_address: "0x0A8C46EcFa05B08F279498F98B0613AcD77FCF94",
    version: "2024-11-01",
    data_source: "fixture",
  },
  rates: {
    supplyApr: 0.0325,
    borrowApr: 0.059,
    source: "fixture",
    utilization: 0.25,
  },
  defaultPrices: {
    WETHUSD: 3200,
    USDCUSD: 1,
  },
  tokens: {
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
  },
  source: "fixture",
  fetchedAt: Date.now(),
};

let cachedLiveSnapshots = new Map<
  string,
  { snapshot: MorphoMarketSnapshot; expiresAt: number }
>();
let cachedMarketList:
  | {
      items: GraphMarketItem[];
      expiresAt: number;
    }
  | undefined;

function shouldSkipLiveFetch(): boolean {
  return (
    process.env.MORPHO_LIVE_DISABLED === "1" || process.env.NODE_ENV === "test"
  );
}

function sanitizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function parsePriceUsd(
  value: number | string | null | undefined
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const price = Number(value);
  return Number.isFinite(price) ? price : undefined;
}

function parseLltv(raw: string | number | undefined): number {
  if (!raw) return WETH_USDC_FIXTURE.market.lltv;
  try {
    return new BigNumber(raw.toString()).dividedBy(1e18).toNumber();
  } catch {
    return WETH_USDC_FIXTURE.market.lltv;
  }
}

function isWethUsdcPair(collateral: TokenSpec, debt: TokenSpec): boolean {
  return (
    sanitizeSymbol(collateral.symbol) === "WETH" &&
    sanitizeSymbol(debt.symbol) === "USDC"
  );
}

async function fetchMarketList(): Promise<GraphMarketItem[]> {
  const now = Date.now();
  if (cachedMarketList && cachedMarketList.expiresAt > now) {
    return cachedMarketList.items;
  }

  const response = await axios.post<{
    data?: { markets?: { items: GraphMarketItem[] } };
  }>(
    GRAPH_URL,
    {
      query: `query Markets($chains: [Int!]) {
        markets(first: 200, where: { chainId_in: $chains }) {
          items {
            id
            uniqueKey
            lltv
            irmAddress
            oracle { address }
            loanAsset { address symbol decimals priceUsd }
            collateralAsset { address symbol decimals priceUsd }
            morphoBlue { chain { id network } }
            state {
              borrowApy
              supplyApy
              utilization
              supplyAssets
              borrowAssets
            }
          }
        }
      }`,
      variables: {
        chains: [BASE_CHAIN_ID],
      },
    },
    {
      timeout: Number(process.env.MORPHO_LIVE_TIMEOUT_MS || 3_000),
    }
  );

  const items = response.data?.data?.markets?.items ?? [];
  cachedMarketList = {
    items,
    expiresAt: now + MARKET_LIST_CACHE_MS,
  };
  return items;
}

function tokenMatches(asset: GraphAsset, token: TokenSpec): boolean {
  const addressMatches = token.address
    ? asset.address.toLowerCase() === token.address.toLowerCase()
    : true;
  if (!addressMatches) return false;
  const symbolMatches =
    sanitizeSymbol(asset.symbol) === sanitizeSymbol(token.symbol);
  const decimalsMatch = asset.decimals === token.decimals;
  return symbolMatches && decimalsMatch;
}

async function resolveMarket(
  collateral: TokenSpec,
  debt: TokenSpec
): Promise<GraphMarketItem | undefined> {
  const markets = await fetchMarketList();
  return markets.find(
    (item) =>
      tokenMatches(item.collateralAsset, collateral) &&
      tokenMatches(item.loanAsset, debt)
  );
}

function buildDefaultPrices(item: GraphMarketItem): Record<string, number> {
  const prices: Record<string, number> = {};
  const collateralPrice = parsePriceUsd(item.collateralAsset.priceUsd);
  const loanPrice = parsePriceUsd(item.loanAsset.priceUsd);

  if (collateralPrice !== undefined) {
    prices[`${sanitizeSymbol(item.collateralAsset.symbol)}USD`] =
      collateralPrice;
  }
  if (loanPrice !== undefined) {
    prices[`${sanitizeSymbol(item.loanAsset.symbol)}USD`] = loanPrice;
  }

  return {
    ...WETH_USDC_FIXTURE.defaultPrices,
    ...prices,
  };
}

function buildLiveSnapshot(
  item: GraphMarketItem,
  collateral: TokenSpec,
  debt: TokenSpec
): MorphoMarketSnapshot {
  const supplyApr = item.state?.supplyApy ?? WETH_USDC_FIXTURE.rates.supplyApr;
  const borrowApr = item.state?.borrowApy ?? WETH_USDC_FIXTURE.rates.borrowApr;
  const utilization = item.state?.utilization ?? undefined;

  const market: MorphoMarketParams = {
    lltv: parseLltv(item.lltv),
    liquidation_incentive: WETH_USDC_FIXTURE.market.liquidation_incentive,
    close_factor: WETH_USDC_FIXTURE.market.close_factor,
    irm: "adaptive-curve-irm-v1",
    irm_address: item.irmAddress,
    oracle_type: "chainlink",
    oracle_address: item.oracle.address,
    version: item.uniqueKey,
    market_id: item.id,
    data_source: "live",
    fetched_at: Date.now(),
  };

  return {
    market,
    rates: {
      supplyApr,
      borrowApr,
      source: "live",
      utilization,
    },
    defaultPrices: buildDefaultPrices(item),
    tokens: {
      collateral: {
        symbol: collateral.symbol,
        decimals: collateral.decimals,
        address: collateral.address ?? item.collateralAsset.address,
      },
      debt: {
        symbol: debt.symbol,
        decimals: debt.decimals,
        address: debt.address ?? item.loanAsset.address,
      },
    },
    source: "live",
    fetchedAt: Date.now(),
  };
}

async function fetchLiveSnapshot(
  collateral: TokenSpec,
  debt: TokenSpec
): Promise<MorphoMarketSnapshot | null> {
  try {
    const market = await resolveMarket(collateral, debt);
    if (!market) {
      return null;
    }
    return buildLiveSnapshot(market, collateral, debt);
  } catch (error) {
    if (process.env.MORPHO_DEBUG_LIVE === "1") {
      console.warn("Morpho live fetch failed", error);
    }
    return null;
  }
}

function cacheKey(collateral: TokenSpec, debt: TokenSpec): string {
  return [
    sanitizeSymbol(collateral.symbol),
    collateral.address?.toLowerCase() ?? "",
    collateral.decimals.toString(),
    sanitizeSymbol(debt.symbol),
    debt.address?.toLowerCase() ?? "",
    debt.decimals.toString(),
  ].join(":");
}

export async function loadMorphoMarketSnapshot(
  params: LoadParams
): Promise<MorphoMarketSnapshot> {
  const { protocol, chain, collateral, debt } = params;

  if (protocol !== "morpho-blue" || sanitizeSymbol(chain) !== "BASE") {
    throw new Error(
      "Unsupported protocol or chain; only Morpho Blue on Base is supported"
    );
  }

  const now = Date.now();
  const cacheId = cacheKey(collateral, debt);
  const cached = cachedLiveSnapshots.get(cacheId);
  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  if (!shouldSkipLiveFetch()) {
    const live = await fetchLiveSnapshot(collateral, debt);
    if (live) {
      cachedLiveSnapshots.set(cacheId, {
        snapshot: live,
        expiresAt: now + CACHE_TTL_MS,
      });
      return live;
    }
  }

  if (isWethUsdcPair(collateral, debt)) {
    return {
      ...WETH_USDC_FIXTURE,
      fetchedAt: now,
      tokens: {
        collateral: {
          ...WETH_USDC_FIXTURE.tokens.collateral,
          address:
            collateral.address ?? WETH_USDC_FIXTURE.tokens.collateral.address,
        },
        debt: {
          ...WETH_USDC_FIXTURE.tokens.debt,
          address: debt.address ?? WETH_USDC_FIXTURE.tokens.debt.address,
        },
      },
    };
  }

  throw new Error(
    `Unable to resolve Morpho Blue market for ${collateral.symbol}/${debt.symbol} on Base. Provide token addresses or ensure the market exists.`
  );
}

export function clearMorphoCaches(): void {
  cachedLiveSnapshots.clear();
  cachedMarketList = undefined;
}
