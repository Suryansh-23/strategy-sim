export interface TokenSpec {
  symbol: string;
  decimals: number;
  address?: string;
}

export interface SwapModelSpec {
  type: "amm_xyk";
  fee_bps: number;
  pool: {
    base_reserve: number;
    quote_reserve: number;
  };
}

export type ScenarioSpec =
  | {
      type: "price_jump";
      asset: string;
      shock_pct: number;
      at_day: number;
    }
  | {
      type: "rates_shift";
      borrow_apr_delta_bps: number;
    }
  | {
      type: "oracle_lag";
      lag_seconds: number;
    };

export interface LoopingSimulationInput {
  protocol: "morpho-blue";
  chain: "base";
  collateral: TokenSpec;
  debt: TokenSpec;
  start_capital: string;
  target_ltv: number;
  loops: number;
  price?: Record<string, number>;
  swap_model?: SwapModelSpec;
  oracle?: {
    type: "chainlink";
    lag_seconds: number;
  };
  rates?: {
    supply_apr?: number;
    borrow_apr?: number;
  };
  horizon_days?: number;
  scenarios?: ScenarioSpec[];
  risk_limits?: {
    min_hf?: number;
    max_leverage?: number;
  };
}

export interface SimulationStep {
  borrow?: {
    asset: string;
    amount: number;
  };
  swap?: {
    from: string;
    to: string;
    amount_in: number;
    amount_out: number;
    route?: unknown;
  };
  supply?: {
    asset: string;
    amount: number;
  };
}

export interface MorphoMarketParams {
  lltv: number;
  liquidation_incentive: number;
  close_factor: number;
  irm: string;
  oracle_type: string;
  version?: string;
  oracle_address?: `0x${string}`;
  irm_address?: `0x${string}`;
  market_id?: string;
  data_source?: "fixture" | "live";
  fetched_at?: number;
}

export interface LoopingSimulationResult {
  summary: {
    loops_done: number;
    gross_leverage: number;
    net_apr: number;
    hf_now: number;
    liq_price: Record<string, number>;
    slip_cost_usd: number;
  };
  time_series: Array<{
    t: number;
    collateral: number;
    debt: number;
    equity: number;
    hf: number;
  }>;
  stress: Array<{
    scenario: string;
    min_hf: number;
    liquidated: boolean;
    liq_loss_usd?: number;
  }>;
  action_plan: SimulationStep[];
  protocol_params_used: MorphoMarketParams;
  receipt: {
    payment: unknown;
    provenance_hash: string;
  };
  canExecute?: boolean;
  reason?: string;
}
