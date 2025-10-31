import { z } from "zod";

const TokenSpecSchema = z.object({
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
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
