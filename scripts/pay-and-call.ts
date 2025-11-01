import {
  wrapFetchWithPayment,
  createSigner,
  decodeXPaymentResponse,
} from "x402-fetch";

import type { LoopingSimulationResult } from "../src/types.js";

interface SimulationInput {
  protocol: "morpho-blue";
  chain: "base";
  collateral: { symbol: string; decimals: number };
  debt: { symbol: string; decimals: number };
  start_capital: string;
  target_ltv: number;
  loops: number;
  price?: Record<string, number>;
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8787";
const endpoint =
  process.argv[2] ??
  process.env.PAY_AND_CALL_ENDPOINT ??
  `${apiBaseUrl}/entrypoints/simulateLooping/invoke`;

const payloadArg = process.argv[3];

const defaultInput: SimulationInput = {
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
  value: unknown,
): value is LoopingSimulationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "summary" in value &&
    typeof (value as { summary?: unknown }).summary === "object"
  );
}

let input: SimulationInput = defaultInput;

if (payloadArg) {
  try {
    input = JSON.parse(payloadArg);
  } catch (error) {
    console.warn("Failed to parse payload argument. Using defaults.", error);
  }
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
      parsed && typeof parsed === "object" && parsed !== null && "output" in parsed
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
      console.log(`\nRun: ${envelope.run_id} (${envelope.status ?? "unknown"})`);
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
