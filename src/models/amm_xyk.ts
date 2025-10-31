import BigNumber from "bignumber.js";

export interface AmmSwapParams {
  amountIn: BigNumber;
  reserveIn: BigNumber;
  reserveOut: BigNumber;
  feeBps: number;
}

export interface AmmSwapQuote {
  amountOut: BigNumber;
  priceImpactPct: number;
  feePaid: BigNumber;
}

const BPS_DENOMINATOR = 10_000;

export function getConstantProductQuote(params: AmmSwapParams): AmmSwapQuote {
  const { amountIn, reserveIn, reserveOut, feeBps } = params;

  if (amountIn.isNegative()) {
    throw new Error("amountIn must be non-negative");
  }

  if (reserveIn.lte(0) || reserveOut.lte(0)) {
    throw new Error("reserves must be positive");
  }

  const feeFraction = new BigNumber(feeBps).dividedBy(BPS_DENOMINATOR);
  const amountInAfterFee = amountIn.multipliedBy(new BigNumber(1).minus(feeFraction));

  if (amountInAfterFee.isZero()) {
    return {
      amountOut: new BigNumber(0),
      priceImpactPct: 0,
      feePaid: amountIn,
    };
  }

  const numerator = amountInAfterFee.multipliedBy(reserveOut);
  const denominator = reserveIn.plus(amountInAfterFee);
  const amountOut = numerator.dividedBy(denominator);

  const initialPrice = reserveIn.isZero()
    ? new BigNumber(0)
    : reserveOut.dividedBy(reserveIn);
  const finalPrice = reserveIn
    .plus(amountInAfterFee)
    .isZero()
    ? new BigNumber(0)
    : reserveOut.minus(amountOut).dividedBy(reserveIn.plus(amountInAfterFee));

  const priceImpactPct = initialPrice.isZero()
    ? 0
    : initialPrice
        .minus(finalPrice)
        .dividedBy(initialPrice)
        .multipliedBy(100)
        .toNumber();

  const feePaid = amountIn.minus(amountInAfterFee);

  return {
    amountOut,
    priceImpactPct,
    feePaid,
  };
}
