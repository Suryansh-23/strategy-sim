import { z } from "zod";

const addressRegex = /^0x[a-fA-F0-9]{40}$/;

const TokenSpecSchema = z.object({
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
  address: z
    .string()
    .regex(addressRegex, "invalid address")
    .optional(),
});

const SwapModelSpecSchema = z.object({
  type: z.literal("amm_xyk"),
  fee_bps: z.number().nonnegative(),
  pool: z.object({
    base_reserve: z.number().nonnegative(),
    quote_reserve: z.number().nonnegative(),
  }),
});

const ScenarioPriceJumpSchema = z.object({
  type: z.literal("price_jump"),
  asset: z.string().min(1),
  shock_pct: z.number(),
  at_day: z.number().int().nonnegative(),
});

const ScenarioRatesShiftSchema = z.object({
  type: z.literal("rates_shift"),
  borrow_apr_delta_bps: z.number(),
});

const ScenarioOracleLagSchema = z.object({
  type: z.literal("oracle_lag"),
  lag_seconds: z.number().nonnegative(),
});

export const ScenarioSpecSchema = z.union([
  ScenarioPriceJumpSchema,
  ScenarioRatesShiftSchema,
  ScenarioOracleLagSchema,
]);

export const LoopingSimulationInputSchema = z.object({
  protocol: z.literal("morpho-blue"),
  chain: z.literal("base"),
  collateral: TokenSpecSchema,
  debt: TokenSpecSchema,
  start_capital: z.string().min(1),
  target_ltv: z.number().positive().max(0.99),
  loops: z.number().int().positive(),
  price: z.record(z.string(), z.number()).optional(),
  swap_model: SwapModelSpecSchema.optional(),
  oracle: z
    .object({
      type: z.literal("chainlink"),
      lag_seconds: z.number().nonnegative(),
    })
    .optional(),
  rates: z
    .object({
      supply_apr: z.number().optional(),
      borrow_apr: z.number().optional(),
    })
    .optional(),
  horizon_days: z.number().int().positive().max(365).optional(),
  scenarios: z.array(ScenarioSpecSchema).optional(),
  risk_limits: z
    .object({
      min_hf: z.number().optional(),
      max_leverage: z.number().optional(),
    })
    .optional(),
});

export type LoopingSimulationInputValidated = z.infer<
  typeof LoopingSimulationInputSchema
>;

export const SimulationStepSchema = z
  .object({
    borrow: z
      .object({
        asset: z.string().min(1),
        amount: z.number(),
      })
      .optional(),
    swap: z
      .object({
        from: z.string().min(1),
        to: z.string().min(1),
        amount_in: z.number(),
        amount_out: z.number(),
        route: z.unknown().optional(),
      })
      .optional(),
    supply: z
      .object({
        asset: z.string().min(1),
        amount: z.number(),
      })
      .optional(),
  })
  .refine(
    (step) => Boolean(step.borrow || step.swap || step.supply),
    {
      message: "at least one action must be present",
    },
  );

const TimeSeriesPointSchema = z.object({
  t: z.number().int().nonnegative(),
  collateral: z.number(),
  debt: z.number(),
  equity: z.number(),
  hf: z.number(),
});

const StressResultSchema = z.object({
  scenario: z.string().min(1),
  min_hf: z.number(),
  liquidated: z.boolean(),
  liq_loss_usd: z.number().optional(),
});

const MorphoMarketParamsSchema = z.object({
  lltv: z.number(),
  liquidation_incentive: z.number(),
  close_factor: z.number(),
  irm: z.string().min(1),
  oracle_type: z.string().min(1),
  version: z.string().optional(),
  oracle_address: z
    .string()
    .regex(addressRegex, "invalid address")
    .optional(),
  irm_address: z
    .string()
    .regex(addressRegex, "invalid address")
    .optional(),
  market_id: z.string().optional(),
  data_source: z.enum(["fixture", "live"]).optional(),
  fetched_at: z.number().int().nonnegative().optional(),
});

const ReceiptSchema = z.object({
  payment: z.unknown(),
  provenance_hash: z.string().min(1),
});

export const LoopingSimulationResultSchema = z.object({
  summary: z.object({
    loops_done: z.number().int().nonnegative(),
    gross_leverage: z.number(),
    net_apr: z.number(),
    hf_now: z.number(),
    liq_price: z.record(z.string(), z.number()),
    slip_cost_usd: z.number(),
  }),
  time_series: z.array(TimeSeriesPointSchema),
  stress: z.array(StressResultSchema),
  action_plan: z.array(SimulationStepSchema),
  protocol_params_used: MorphoMarketParamsSchema,
  receipt: ReceiptSchema,
  canExecute: z.boolean().optional(),
  reason: z.string().optional(),
});

export type LoopingSimulationResultValidated = z.infer<
  typeof LoopingSimulationResultSchema
>;
