import {
  wrapFetchWithPayment,
  createSigner,
  decodeXPaymentResponse,
} from "x402-fetch";

import type { LoopingSimulationResult } from "../src/types.js";

interface SimulationInput {
  protocol: "morpho-blue";
  chain: "base";
  collateral: {
    symbol: string;
    decimals: number;
    address?: string;
  };
  debt: {
    symbol: string;
    decimals: number;
    address?: string;
  };
  start_capital: string;
  target_ltv: number;
  loops: number;
  price?: Record<string, number>;
  horizon_days?: number;
  swap_model?: {
    type: "amm_xyk";
    fee_bps: number;
    pool: {
      base_reserve: number;
      quote_reserve: number;
    };
  };
  oracle?: {
    type: "chainlink";
    lag_seconds: number;
  };
  rates?: {
    supply_apr?: number;
    borrow_apr?: number;
  };
  scenarios?: (
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
      }
  )[];
  risk_limits?: {
    min_hf?: number;
    max_leverage?: number;
  };
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8787";
const argv = process.argv.slice(2);
let endpoint =
  process.env.PAY_AND_CALL_ENDPOINT ??
  `${apiBaseUrl}/entrypoints/simulateLooping/invoke`;

let payloadArg: string | undefined;
let variant = process.env.PAY_AND_CALL_VARIANT ?? "baseline";

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--full" || arg === "-f") {
    variant = "full";
  } else if (arg === "--baseline") {
    variant = "baseline";
  } else if (arg === "--payload" && argv[i + 1]) {
    payloadArg = argv[i + 1];
    i += 1;
  } else if (arg.startsWith("http")) {
    endpoint = arg;
  } else if (!payloadArg && arg.startsWith("{")) {
    payloadArg = arg;
  }
}

const baselineInput: SimulationInput = {
  protocol: "morpho-blue",
  chain: "base",
  collateral: { symbol: "WETH", decimals: 18 },
  debt: { symbol: "USDC", decimals: 6 },
  start_capital: process.env.START_CAPITAL ?? "1",
  target_ltv: Number(process.env.TARGET_LTV ?? 0.6),
  loops: Number(process.env.LOOPS ?? 3),
  price: {
    WETHUSD: Number(process.env.PRICE_WETHUSD ?? 3200),
    USDCUSD: 1,
  },
};

function isLoopingSimulationResult(
  value: unknown
): value is LoopingSimulationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "summary" in value &&
    typeof (value as { summary?: unknown }).summary === "object"
  );
}

const fullFeaturedInput: SimulationInput = {
  protocol: "morpho-blue",
  chain: "base",
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
  start_capital: "2.5",
  target_ltv: 0.55,
  loops: 2,
  horizon_days: 45,
  price: {
    WETHUSD: 3200,
    USDCUSD: 1,
  },
  rates: {
    supply_apr: 0.02,
    borrow_apr: 0.035,
  },
  oracle: {
    type: "chainlink",
    lag_seconds: 600,
  },
  swap_model: {
    type: "amm_xyk",
    fee_bps: 10,
    pool: {
      base_reserve: 500_000,
      quote_reserve: 150_000_000,
    },
  },
  scenarios: [
    {
      type: "price_jump",
      asset: "WETH",
      shock_pct: -0.15,
      at_day: 10,
    },
    {
      type: "rates_shift",
      borrow_apr_delta_bps: 150,
    },
    {
      type: "oracle_lag",
      lag_seconds: 1_200,
    },
  ],
  risk_limits: {
    min_hf: 1.05,
    max_leverage: 8,
  },
};
let input: SimulationInput = baselineInput;

if (payloadArg) {
  try {
    input = JSON.parse(payloadArg);
  } catch (error) {
    console.warn("Failed to parse payload argument. Using defaults.", error);
  }
} else if (variant === "full") {
  input = fullFeaturedInput;
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Missing PRIVATE_KEY environment variable.");
    process.exit(1);
  }

  const network = process.env.NETWORK ?? "base";

  console.log("🔐 Preparing payment signer...");
  console.log(`   Network: ${network}`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Variant: ${payloadArg ? "custom" : variant}`);

  const signer = await createSigner(network, privateKey);
  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, signer);

  console.log("📦 Sending simulation request with payment...");
  console.log("   Payload:", JSON.stringify(input, null, 2));

  const response = await fetchWithPayment(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  const raw = await response.text();
  console.log(`\nHTTP ${response.status} ${response.statusText}`);

  const paymentHeader = response.headers.get("x-payment-response");
  if (paymentHeader) {
    try {
      const decoded = decodeXPaymentResponse(paymentHeader);
      console.log("💰 Payment settled:", decoded);
    } catch (error) {
      console.log("💰 Payment header:", paymentHeader);
      console.error("Failed to decode payment response:", error);
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    const envelope =
      parsed &&
      typeof parsed === "object" &&
      parsed !== null &&
      "output" in parsed
        ? (parsed as {
            run_id?: string;
            status?: string;
            output?: LoopingSimulationResult | null;
            error?: unknown;
          })
        : null;

    const resultCandidate = envelope?.output ?? parsed;
    const result = isLoopingSimulationResult(resultCandidate)
      ? resultCandidate
      : null;

    console.log("\nSimulation Result:");
    console.log(JSON.stringify(parsed, null, 2));

    if (envelope?.run_id) {
      console.log(
        `\nRun: ${envelope.run_id} (${envelope.status ?? "unknown"})`
      );
    }

    if (result) {
      const { summary } = result;
      console.log("\nSummary:");
      console.log(`   Loops: ${summary.loops_done}`);
      console.log(`   HF: ${summary.hf_now.toFixed(4)}`);
      console.log(`   Gross leverage: ${summary.gross_leverage.toFixed(4)}`);
      console.log(`   Net APR: ${(summary.net_apr * 100).toFixed(2)}%`);
    } else if (envelope?.error) {
      console.log("\nServer reported error:");
      console.log(JSON.stringify(envelope.error, null, 2));
    }
  } catch {
    console.log(raw);
  }

  if (response.status !== 200) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Request failed:", error);
  process.exit(1);
});
