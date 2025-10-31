import { describe, expect, test } from "bun:test";
import BigNumber from "bignumber.js";

import { getConstantProductQuote } from "../src/models/amm_xyk.js";

describe("constant product model", () => {
  test("calculates amount out with fee and slippage", () => {
    const amountIn = new BigNumber(10_000);
    const reserveIn = new BigNumber(2_000_000);
    const reserveOut = new BigNumber(1_000);
    const feeBps = 30;

    const quote = getConstantProductQuote({
      amountIn,
      reserveIn,
      reserveOut,
      feeBps,
    });

    const expectedAmountOut = amountIn
      .multipliedBy(1 - feeBps / 10_000)
      .multipliedBy(reserveOut)
      .dividedBy(reserveIn.plus(amountIn.multipliedBy(1 - feeBps / 10_000)));

    expect(quote.amountOut.toNumber()).toBeCloseTo(
      expectedAmountOut.toNumber(),
      8,
    );

    const expectedFee = amountIn.multipliedBy(feeBps).dividedBy(10_000);
    expect(quote.feePaid.toNumber()).toBeCloseTo(expectedFee.toNumber(), 8);
    expect(quote.priceImpactPct).toBeGreaterThan(0);
  });
});
