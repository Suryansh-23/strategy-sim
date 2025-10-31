import type { MorphoMarketParams } from "../types.js";

export interface MorphoMarketSnapshot {
  market: MorphoMarketParams;
  rates: {
    supplyApr: number;
    borrowApr: number;
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
}

interface LoadParams {
  protocol: string;
  chain: string;
  collateralSymbol: string;
  debtSymbol: string;
}

const WETH_USDC_BASE_SNAPSHOT: MorphoMarketSnapshot = {
  market: {
    lltv: 0.86,
    liquidation_incentive: 0.05,
    close_factor: 0.5,
    irm: "adaptive-curve-irm-v1",
    oracle_type: "chainlink",
    version: "2024-11-01",
  },
  rates: {
    supplyApr: 0.0325,
    borrowApr: 0.059,
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
};

export function loadMorphoMarketSnapshot(params: LoadParams): MorphoMarketSnapshot {
  const { protocol, chain, collateralSymbol, debtSymbol } = params;

  if (
    protocol !== "morpho-blue" ||
    chain !== "base" ||
    collateralSymbol.toUpperCase() !== "WETH" ||
    debtSymbol.toUpperCase() !== "USDC"
  ) {
    throw new Error(
      `Unsupported market. Only morpho-blue Base WETH/USDC is available in this release.`
    );
  }

  return WETH_USDC_BASE_SNAPSHOT;
}
