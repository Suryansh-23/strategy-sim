export interface OracleLagConfig {
  lagSeconds: number;
}

export interface OracleLagState {
  lastPrice: number;
  lastUpdateTimestamp: number;
}

export function resolveOraclePrice(params: {
  spotPrice: number;
  timestamp: number;
  config?: OracleLagConfig;
  state: OracleLagState;
}): {
  price: number;
  state: OracleLagState;
} {
  const { spotPrice, timestamp, state, config } = params;

  if (!config) {
    return {
      price: spotPrice,
      state: { lastPrice: spotPrice, lastUpdateTimestamp: timestamp },
    };
  }

  const { lagSeconds } = config;
  const elapsed = timestamp - state.lastUpdateTimestamp;

  if (elapsed < lagSeconds) {
    return {
      price: state.lastPrice,
      state,
    };
  }

  return {
    price: spotPrice,
    state: { lastPrice: spotPrice, lastUpdateTimestamp: timestamp },
  };
}
