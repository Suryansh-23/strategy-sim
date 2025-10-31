import { getSafeSlippageEntrypoint } from "../src/agent";

interface TestScenario {
  token_in: string;
  token_out: string;
  token_out_name: string;
  amount_in: number;
  route_hint: string;
}

// Dataset test - fokus WETH->USDC on Base (10 scenarios)
const testScenarios: TestScenario[] = [
  {
    token_in: "0x4200000000000000000000000000000000000006", // WETH on Base
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    token_out_name: "USDC",
    amount_in: 0.1,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 0.5,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 1,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 2,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 5,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 10,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 20,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 50,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 100,
    route_hint: "base",
  },
  {
    token_in: "0x4200000000000000000000000000000000000006",
    token_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    token_out_name: "USDC",
    amount_in: 200,
    route_hint: "base",
  },
];

/**
 * Simulate swap berdasarkan price impact calculation dari DexScreener data
 * Tidak perlu API key - pure calculation based on pool liquidity
 */
async function simulateSwap(
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  slippageBps: number,
  poolDepth: number,
  volatility: number,
): Promise<string> {
  // Fetch real price data dari DexScreener
  const dexScreenerUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenIn}`;

  try {
    const response = await fetch(dexScreenerUrl, {
      headers: {
        "user-agent": "slippage-sentinel-test/0.1",
      },
    });

    if (!response.ok) {
      return "REVERT"; // No pool data
    }

    const data = await response.json();
    const pairs = data.pairs || [];

    // Find matching pair on Base
    const pair = pairs.find((p: any) => {
      const base = p?.baseToken?.address?.toLowerCase();
      const quote = p?.quoteToken?.address?.toLowerCase();
      const chainId = p?.chainId?.toLowerCase();

      return (
        chainId === "base" &&
        ((base === tokenIn.toLowerCase() && quote === tokenOut.toLowerCase()) ||
          (base === tokenOut.toLowerCase() && quote === tokenIn.toLowerCase()))
      );
    });

    if (!pair) {
      return "REVERT"; // No matching pair
    }

    const priceUsd = Number(pair.priceUsd || 0);
    if (priceUsd <= 0) {
      return "REVERT"; // Invalid price
    }

    // Calculate expected slippage
    const tradeValueUsd = amountIn * priceUsd;
    const liquidityUsd = poolDepth || Number(pair.liquidity?.usd || 0);

    if (liquidityUsd <= 0) {
      return "REVERT"; // No liquidity
    }

    // Price impact calculation (simplified constant product formula)
    // Impact = (trade_size / liquidity) * 100
    const priceImpactPct = (tradeValueUsd / liquidityUsd) * 100;

    // Add volatility buffer (agent's volatility index / 10)
    const volatilityBuffer = volatility / 10;

    // Add DEX fee (typically 0.3%)
    const dexFee = 0.3;

    // Total expected slippage needed
    const requiredSlippagePct = priceImpactPct + volatilityBuffer + dexFee;
    const requiredSlippageBps = Math.ceil(requiredSlippagePct * 100);

    // Success if recommended slippage >= required slippage
    if (slippageBps >= requiredSlippageBps) {
      return "SUCCESS";
    } else {
      // Return REVERT if slippage too low
      return "REVERT";
    }
  } catch (error) {
    console.error("  Error simulating swap:", error);
    return "ERROR";
  }
}

async function runTests(): Promise<string> {
  let successCount = 0;
  const results: Array<{
    scenario: TestScenario;
    slippageBps: number;
    status: string;
    requiredBps?: number;
  }> = [];

  console.log("Running swap success tests on Base network...");
  console.log("Using DexScreener for price impact simulation\n");

  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];
    console.log(
      `Testing scenario ${i + 1}/${testScenarios.length}: ${scenario.amount_in} ${scenario.token_out_name === "USDC" ? "WETH" : "USDC"} → ${scenario.token_out_name}`,
    );

    try {
      // Get agent recommendation
      const ctx = { input: scenario, req: { headers: new Map() } };
      const result = await getSafeSlippageEntrypoint.handler(ctx);

      if (result.output.error) {
        console.log("  ❌ Agent error:", result.output.error);
        results.push({ scenario, slippageBps: 0, status: "ERROR" });
        continue;
      }

      const slippageBps = result.output.min_safe_slip_bps || 200;
      const poolDepth = result.output.pool_depths || 0;
      const volatility = result.output.volatility_index || 0;

      console.log(
        `  Agent: ${slippageBps} bps (${(slippageBps / 100).toFixed(2)}%)`,
      );
      console.log(
        `  Pool: $${poolDepth.toLocaleString()}, Vol: ${volatility.toFixed(2)}%`,
      );

      // Simulate swap with recommended slippage
      const status = await simulateSwap(
        scenario.token_in,
        scenario.token_out,
        scenario.amount_in,
        slippageBps,
        poolDepth,
        volatility,
      );

      results.push({ scenario, slippageBps, status });
      if (status === "SUCCESS") {
        successCount++;
        console.log(`  ✅ SUCCESS\n`);
      } else {
        console.log(`  ❌ ${status}\n`);
      }
    } catch (error) {
      console.error(`  ❌ Error:`, error);
      results.push({ scenario, slippageBps: 0, status: "ERROR" });
    }

    // Delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const successRate = (successCount / testScenarios.length) * 100;

  console.log("=".repeat(60));
  console.log(`\n📊 Test Results:`);
  console.log(
    `Success Rate: ${successRate.toFixed(2)}% (${successCount}/${testScenarios.length})`,
  );

  if (successRate >= 95) {
    console.log("✅ PASSED (≥95% success)");
  } else {
    console.log("❌ FAILED (below 95%)");
  }

  console.log("\nDetailed Results:", JSON.stringify(results, null, 2));

  return successRate >= 95 ? "PASSED (≥95% success)" : "FAILED (below 95%)";
}

runTests().then(console.log).catch(console.error);
