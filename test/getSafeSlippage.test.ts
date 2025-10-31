import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getSafeSlippageEntrypoint } from "../src/agent";

type Handler = typeof getSafeSlippageEntrypoint.handler;

const handler: Handler = getSafeSlippageEntrypoint.handler;

const sampleInput = {
  token_in: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  token_out: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  amount_in: 10,
  route_hint: "base",
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getSafeSlippageEntrypoint.handler", () => {
  it("returns error when upstream fetch fails", async () => {
    globalThis.fetch = async () =>
      ({
        ok: false,
      }) as Response;

    const result = await handler({ input: sampleInput } as any);
    expect(result.output.error).toContain("No matching liquidity pool found");
  });

  it("returns error when no matching pool is found", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ pairs: [] }),
      }) as Response;

    const result = await handler({ input: sampleInput } as any);
    expect(result.output.error).toBe(
      "No matching liquidity pool found for this token pair.",
    );
  });

  it("returns slippage metrics when pool data is available", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          pairs: [
            {
              chainId: "base",
              baseToken: { address: sampleInput.token_in },
              quoteToken: { address: sampleInput.token_out },
              liquidity: { usd: "1000000" },
              priceUsd: "2000",
              priceChange: { h24: "1.5" },
            },
          ],
        }),
      }) as Response;

    const result = await handler({ input: sampleInput } as any);

    expect(result.output.error).toBeUndefined();
    expect(result.output.pool_depths).toBe(1000000);
    expect(result.output.min_safe_slip_bps).toBeGreaterThan(0);
    expect(result.output.recent_trade_size_p95).toBeGreaterThan(0);
    expect(result.output.volatility_index).toBeCloseTo(1.5);
  });
});
