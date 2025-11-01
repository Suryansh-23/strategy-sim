import { randomUUID } from "node:crypto";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  decodeXPaymentResponse,
  Signer,
  wrapFetchWithPayment,
} from "x402-fetch";

interface SimulationPayload {
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
}

const DEFAULT_ENDPOINT =
  "http://localhost:8787/entrypoints/simulateLooping/invoke";

const DEFAULT_COLLATERAL_SYMBOL = "WETH";
const DEFAULT_COLLATERAL_DECIMALS = 18;

const DEFAULT_DEBT_SYMBOL = "USDC";
const DEFAULT_DEBT_DECIMALS = 6;

const DEFAULT_CAPITAL = "1";
const DEFAULT_TARGET_LTV = 0.6;
const DEFAULT_LOOPS = 3;
const DEFAULT_HORIZON = 30;
const USE_SWAP_MODEL = "1";

const headersToObject = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const args = new Set(process.argv.slice(2));
const endpoint =
  [...args].find((arg) => arg.startsWith("http")) ?? DEFAULT_ENDPOINT;
const shouldPay = args.has("--pay") || args.has("-p") || true;
const debugEnabled = args.has("--debug") || false;

if (debugEnabled) {
  process.env.DEBUG_LOOP = "1";
}

const idempotencyKey = `loop-${randomUUID()}`;

const payload: SimulationPayload = {
  protocol: "morpho-blue",
  chain: "base",
  collateral: {
    symbol: DEFAULT_COLLATERAL_SYMBOL,
    decimals: DEFAULT_COLLATERAL_DECIMALS,
  },
  debt: {
    symbol: DEFAULT_DEBT_SYMBOL,
    decimals: DEFAULT_DEBT_DECIMALS,
  },
  start_capital: DEFAULT_CAPITAL,
  target_ltv: DEFAULT_TARGET_LTV,
  loops: DEFAULT_LOOPS,
  horizon_days: DEFAULT_HORIZON,
  swap_model: USE_SWAP_MODEL
    ? {
        type: "amm_xyk",
        fee_bps: 30,
        pool: {
          base_reserve: 100_000,
          quote_reserve: 300_000_000,
        },
      }
    : undefined,
  price: process.env.TEST_PRICE_WETHUSD
    ? {
        [`${DEFAULT_COLLATERAL_SYMBOL.toUpperCase()}USD`]: 4000,
        [`${DEFAULT_DEBT_SYMBOL.toUpperCase()}USD`]: 1,
      }
    : undefined,
};

async function main() {
  console.log("🚀 Testing simulateLooping entrypoint");
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Idempotency-Key: ${idempotencyKey}`);
  console.log(
    `   Network: ${process.env.NETWORK ?? "base"} | Pay? ${
      shouldPay ? "yes" : "no"
    }`
  );
  console.log(`   Payment asset: "<default base USDC>"`);
  console.log(`   Rate limit: 30/60000ms`);
  console.log(`   Debug logging: ${debugEnabled ? "enabled" : "disabled"}`);
  console.log(
    `   Swap model override: ${USE_SWAP_MODEL ? "const-product" : "Kyber"}`
  );
  console.log("   Payload:");
  console.log(JSON.stringify(payload, null, 2));

  let fetcher: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = globalThis.fetch;

  if (shouldPay) {
    const privateKey = process.env.PRIVATE_KEY as Hex;
    if (!privateKey) {
      throw new Error(
        "PRIVATE_KEY is required when running with payment (set TEST_LOOP_PAY=1)"
      );
    }
    const network = process.env.NETWORK ?? "base";
    console.log("💸 Payment enabled (TEST_LOOP_PAY)");
    console.log(`   Network: ${network}`);

    const account = privateKeyToAccount(privateKey);

    const proxySigner: Signer = {
      ...(account as unknown as Signer),
      signTypedData: async (parameters: any): Promise<Hex> => {
        console.info(
          "[x402] web-fetch: signTypedData called:",
          JSON.stringify(parameters, (_, v) =>
            typeof v === "bigint" ? v.toString() : v
          )
        );
        const result = await account.signTypedData(parameters);
        console.info("[x402] web-fetch: signTypedData result:", result);
        return result;
      },
    };

    const paymentFetch = wrapFetchWithPayment(
      globalThis.fetch,
      proxySigner,
      200000n
    );
    fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
      const requestInput = input instanceof URL ? input.toString() : input;
      return paymentFetch(requestInput, init);
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };

  const response = await fetcher(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: payload }),
  });
  console.log("   Response headers:", headersToObject(response.headers));

  const raw = await response.text();

  console.log(`\nHTTP ${response.status} ${response.statusText}`);
  console.log("   Response headers:", headersToObject(response.headers));

  const paymentHeader = response.headers.get("x-payment-response");
  if (paymentHeader) {
    try {
      const decoded = decodeXPaymentResponse(paymentHeader);
      console.log("💰 Payment settled:", decoded);
    } catch (error) {
      console.warn("💰 Failed to decode payment response", error);
      console.log(paymentHeader);
    }
  }

  const idempotentReplay = response.headers.get("x-idempotent-replay");
  if (idempotentReplay) {
    console.log(`🔁 Replay detected (X-Idempotent-Replay=${idempotentReplay})`);
  }

  if (response.status === 402) {
    console.log("❗ Received 402 Payment Required");
    console.log(raw);
    console.log("👉 Check NETWORK, PAYMENT_ASSET_ADDRESS, and wallet balance");
    return;
  }

  if (response.status >= 400) {
    console.error("❌ Error response:");
    try {
      console.error(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      console.error(raw);
    }
    process.exitCode = 1;
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse JSON response", error);
    console.log(raw);
    process.exitCode = 1;
    return;
  }

  console.log("\n✅ Simulation result:");
  console.log(JSON.stringify(json, null, 2));

  // Demonstrate idempotent replay when 200
  console.log(
    "\n🔁 Replaying request with same Idempotency-Key to verify caching..."
  );
  const replay = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: payload }),
  });
  const replayHeader = replay.headers.get("x-idempotent-replay");
  console.log(
    `   Replay status: ${replay.status} ${replay.statusText} (X-Idempotent-Replay=${replayHeader})`
  );
  console.log("   Replay headers:", headersToObject(replay.headers));
}

main().catch((error) => {
  console.error("test-loop failed", error);
  process.exitCode = 1;
});
