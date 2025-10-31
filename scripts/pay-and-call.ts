import { createRuntimePaymentContext } from "@lucid-dreams/agent-kit";

type SafeSlippageInput = {
  token_in: string;
  token_out: string;
  amount_in: number;
  route_hint?: string;
};

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8787";

// Allow override via command line or environment variable
const endpoint =
  process.argv[2] ??
  process.env.PAY_AND_CALL_ENDPOINT ??
  `${apiBaseUrl}/entrypoints/getSafeSlippage/invoke`;

// Show warning if localhost is used but server might not be running
if (endpoint.includes("localhost")) {
  console.log(
    "⚠️  Using localhost endpoint. Make sure server is running with 'bun run dev'",
  );
  console.log("💡 Or set API_BASE_URL env variable to use production URL\n");
}

const payloadArg = process.argv[3];

const defaultInput: SafeSlippageInput = {
  token_in:
    process.env.PAY_AND_CALL_TOKEN_IN ??
    "0x4200000000000000000000000000000000000006", // WETH on Base
  token_out:
    process.env.PAY_AND_CALL_TOKEN_OUT ??
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  amount_in: Number(process.env.PAY_AND_CALL_AMOUNT ?? 1),
  route_hint: process.env.PAY_AND_CALL_ROUTE ?? "base",
};

let input: SafeSlippageInput = defaultInput;

if (payloadArg) {
  try {
    input = JSON.parse(payloadArg);
  } catch (error) {
    console.warn(
      "Failed to parse payload argument. Falling back to defaults.",
      error,
    );
  }
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY is missing. Set it before running this script.");
    process.exitCode = 1;
    return;
  }

  const network = process.env.NETWORK ?? "base";

  console.log("🔧 Setting up payment context...");
  console.log(`   Network: ${network}`);
  console.log(`   Endpoint: ${endpoint}\n`);

  try {
    const context = await createRuntimePaymentContext({
      privateKey,
      network,
    });

    const fetchWithPayment = context.fetchWithPayment ?? globalThis.fetch;

    console.log("📤 Sending request with payment...");
    console.log("   Input:", JSON.stringify(input, null, 2));

    // Retry logic for payment
    let response: Response;
    let attempts = 0;
    const maxAttempts = 3;
    const retryDelay = 2000; // 2 seconds

    while (attempts < maxAttempts) {
      attempts++;

      if (attempts > 1) {
        console.log(`\n🔄 Retry attempt ${attempts}/${maxAttempts}...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }

      response = await fetchWithPayment(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      // If successful or non-payment error, break
      if (response.status === 200 || response.status !== 402) {
        break;
      }

      // If 402 and last attempt, continue to show error
      if (response.status === 402 && attempts < maxAttempts) {
        console.log("   ⏳ Payment pending, retrying...");
      }
    }

    const rawBody = await response.text();
    const paymentHeader = response.headers.get("x-payment-response");
    const paymentError = response.headers.get("x-payment-error");

    console.log("\n" + "=".repeat(60));
    console.log("📊 Response");
    console.log("=".repeat(60));
    console.log(`Status: ${response.status} ${response.statusText}`);

    if (paymentHeader) {
      console.log("\n💰 Payment Info:");
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentHeader, "base64").toString(),
        );
        console.log("   ✅ Payment successful!");
        console.log(`   Transaction: ${decoded.transaction}`);
        console.log(`   Network: ${decoded.network}`);
        console.log(`   Payer: ${decoded.payer}`);
      } catch {
        console.log("   Raw:", paymentHeader);
      }
    }

    if (paymentError) {
      console.log("\n❌ Payment Error:");
      console.log("   ", paymentError);
    }

    console.log("\n📄 Response Body:");
    try {
      const json = JSON.parse(rawBody);
      console.log(JSON.stringify(json, null, 2));

      if (json.output && !json.output.error) {
        console.log("\n🎯 Slippage Recommendation:");
        console.log(
          `   Safe Slippage: ${(json.output.min_safe_slip_bps / 100).toFixed(2)}% (${json.output.min_safe_slip_bps} bps)`,
        );
        console.log(
          `   Pool Depth: $${json.output.pool_depths?.toLocaleString() || "Unknown"}`,
        );
        console.log(
          `   Volatility: ${json.output.volatility_index?.toFixed(2) || "Unknown"}%`,
        );
      }
    } catch {
      console.log(rawBody);
    }

    console.log("\n" + "=".repeat(60));

    if (response.status === 200) {
      console.log("✅ SUCCESS! Payment completed and agent responded.");
    } else if (response.status === 402) {
      console.log("⚠️  Payment required but not completed.");
      console.log("\n💡 Troubleshooting:");
      console.log(
        "   - Ensure wallet has sufficient USDC balance (~0.02 USDC)",
      );
      console.log("   - Check PRIVATE_KEY is set correctly");
      console.log("   - Verify network connection");
      process.exitCode = 1;
    } else {
      console.log(`❌ Unexpected status: ${response.status}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n❌ Request failed:", error);

    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        console.log(
          "\n💡 Make sure you have enough USDC for payment (~0.02 USDC)",
        );
      } else if (
        error.message.includes("network") ||
        error.message.includes("connect")
      ) {
        console.log(
          "\n💡 Check your internet connection and that the server is running",
        );
      }
    }

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exitCode = 1;
});
