import axios from "axios";
import BigNumber from "bignumber.js";

import type { MorphoMarketParams } from "../types.js";

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
    collateral: {
      symbol: string;
      address: `0x${string}`;
      decimals: number;
    };
    debt: {
      symbol: string;
      address: `0x${string}`;
      decimals: number;
    };
  };
  source: "fixture" | "live";
  fetchedAt: number;
}

interface LoadParams {
  protocol: string;
  chain: string;
  collateralSymbol: string;
  debtSymbol: string;
}

const GRAPH_URL =
  process.env.MORPHO_BLUE_GRAPH_URL || "https://blue-api.morpho.org/graphql";
const CACHE_TTL_MS = Number(process.env.MORPHO_LIVE_CACHE_MS || 30_000);

const FIXTURE_SNAPSHOT: MorphoMarketSnapshot = {
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
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
    },
    debt: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
  },
  source: "fixture",
  fetchedAt: Date.now(),
};

interface GraphMarketState {
  borrowApy: number;
  supplyApy: number;
  utilization: number;
  supplyAssets: string;
  borrowAssets: string;
}

interface GraphMarketItem {
  id: string;
  uniqueKey: string;
  lltv: string;
  irmAddress: `0x${string}`;
  oracle: { address: `0x${string}` };
  loanAsset: { address: `0x${string}`; symbol: string; decimals: number };
  collateralAsset: { address: `0x${string}`; symbol: string; decimals: number };
  morphoBlue: { chain: { id: number; network: string } };
  state: GraphMarketState | null;
}

let cachedLiveSnapshot:
  | { snapshot: MorphoMarketSnapshot; expiresAt: number }
  | undefined;

function shouldSkipLiveFetch(): boolean {
  return (
    process.env.MORPHO_LIVE_DISABLED === "1" ||
    process.env.NODE_ENV === "test"
  );
}

function isSupportedMarket(params: LoadParams): boolean {
  return (
    params.protocol === "morpho-blue" &&
    params.chain === "base" &&
    params.collateralSymbol.toUpperCase() === "WETH" &&
    params.debtSymbol.toUpperCase() === "USDC"
  );
}

function parseLltv(raw: string | number | undefined): number {
  if (!raw) return FIXTURE_SNAPSHOT.market.lltv;
  try {
    return new BigNumber(raw.toString()).dividedBy(1e18).toNumber();
  } catch {
    return FIXTURE_SNAPSHOT.market.lltv;
  }
}

function buildLiveSnapshot(data: GraphMarketItem): MorphoMarketSnapshot {
  const supplyApr = data.state?.supplyApy ?? FIXTURE_SNAPSHOT.rates.supplyApr;
  const borrowApr = data.state?.borrowApy ?? FIXTURE_SNAPSHOT.rates.borrowApr;
  const utilization = data.state?.utilization ?? undefined;

  const market: MorphoMarketParams = {
    lltv: parseLltv(data.lltv),
    liquidation_incentive: FIXTURE_SNAPSHOT.market.liquidation_incentive,
    close_factor: FIXTURE_SNAPSHOT.market.close_factor,
    irm: "adaptive-curve-irm-v1",
    irm_address: data.irmAddress,
    oracle_type: "chainlink",
    oracle_address: data.oracle.address,
    version: data.uniqueKey,
    market_id: data.id,
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
    defaultPrices: {
      ...FIXTURE_SNAPSHOT.defaultPrices,
    },
    tokens: {
      collateral: {
        symbol: data.collateralAsset.symbol,
        address: data.collateralAsset.address,
        decimals: data.collateralAsset.decimals,
      },
      debt: {
        symbol: data.loanAsset.symbol,
        address: data.loanAsset.address,
        decimals: data.loanAsset.decimals,
      },
    },
    source: "live",
    fetchedAt: Date.now(),
  };
}

async function fetchLiveSnapshot(): Promise<MorphoMarketSnapshot | null> {
  try {
    const response = await axios.post<{ data?: { markets?: { items: GraphMarketItem[] } } }>(
      GRAPH_URL,
      {
        query: `query Market($loan: [String!], $collateral: [String!], $chains: [Int!]) {
          markets(first: 1, where: {
            chainId_in: $chains,
            loanAssetAddress_in: $loan,
            collateralAssetAddress_in: $collateral
          }) {
            items {
              id
              uniqueKey
              lltv
              irmAddress
              oracle { address }
              loanAsset { address symbol decimals }
              collateralAsset { address symbol decimals }
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
          loan: [FIXTURE_SNAPSHOT.tokens.debt.address],
          collateral: [FIXTURE_SNAPSHOT.tokens.collateral.address],
          chains: [8453],
        },
      },
      {
        timeout: Number(process.env.MORPHO_LIVE_TIMEOUT_MS || 3_000),
      },
    );

    const items = response.data?.data?.markets?.items;
    if (!items || items.length === 0) {
      return null;
    }

    return buildLiveSnapshot(items[0]);
  } catch (error) {
    if (process.env.MORPHO_DEBUG_LIVE === "1") {
      console.warn("Morpho live fetch failed", error);
    }
    return null;
  }
}

export async function loadMorphoMarketSnapshot(
  params: LoadParams,
): Promise<MorphoMarketSnapshot> {
  if (!isSupportedMarket(params)) {
    throw new Error(
      "Unsupported market. Only morpho-blue Base WETH/USDC is available in this release.",
    );
  }

  const now = Date.now();

  if (!shouldSkipLiveFetch()) {
    if (cachedLiveSnapshot && cachedLiveSnapshot.expiresAt > now) {
      return cachedLiveSnapshot.snapshot;
    }

    const live = await fetchLiveSnapshot();
    if (live) {
      cachedLiveSnapshot = {
        snapshot: live,
        expiresAt: now + CACHE_TTL_MS,
      };
      return live;
    }
  }

  return {
    ...FIXTURE_SNAPSHOT,
    fetchedAt: now,
  };
}
