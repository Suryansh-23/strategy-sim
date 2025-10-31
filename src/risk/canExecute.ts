import type { LoopingSimulationInput, MorphoMarketParams } from "../types.js";

const DEFAULT_MAX_LOOPS = 10;

export interface RiskCheckResult {
  ok: boolean;
  reasons: string[];
}

export interface PostSimulationCheck {
  healthFactor: number;
  grossLeverage: number;
  minHealthFactor?: number;
  maxLeverage?: number;
}

export function preSimulationRiskCheck(
  input: LoopingSimulationInput,
  market: MorphoMarketParams,
  maxLoops = DEFAULT_MAX_LOOPS,
): RiskCheckResult {
  const reasons: string[] = [];

  if (input.target_ltv <= 0) {
    reasons.push("target_ltv must be positive");
  }

  if (input.target_ltv >= market.lltv) {
    reasons.push(
      `target_ltv ${input.target_ltv} violates market LLTV ${market.lltv}`,
    );
  }

  if (!Number.isFinite(input.loops) || input.loops <= 0) {
    reasons.push("loops must be a positive integer");
  } else if (input.loops > maxLoops) {
    reasons.push(`loops ${input.loops} exceeds policy maximum ${maxLoops}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function postSimulationRiskCheck(
  payload: PostSimulationCheck,
): RiskCheckResult {
  const { healthFactor, grossLeverage, minHealthFactor, maxLeverage } = payload;
  const reasons: string[] = [];

  if (typeof minHealthFactor === "number" && healthFactor < minHealthFactor) {
    reasons.push(
      `final health factor ${healthFactor.toFixed(
        4,
      )} is below minimum ${minHealthFactor}`,
    );
  }

  if (typeof maxLeverage === "number" && grossLeverage > maxLeverage) {
    reasons.push(
      `gross leverage ${grossLeverage.toFixed(4)} exceeds maximum ${maxLeverage}`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
