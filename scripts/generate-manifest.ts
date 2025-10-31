import agent from "../src/agent";

console.log(
  JSON.stringify(
    {
      name: "slippage-sentinel",
      version: "0.1.0",
      description: "Estimate safe slippage tolerance for any route",
      endpoints: [
        {
          key: "getSafeSlippage",
          description:
            "Estimate safe slippage tolerance for a given swap route",
          input: {
            token_in: "string",
            token_out: "string",
            amount_in: "number",
            route_hint: "string?",
          },
          output: {
            min_safe_slip_bps: "number",
            pool_depths: "number",
            recent_trade_size_p95: "number",
            volatility_index: "number",
            payment: {
              success: "boolean",
              transaction: "string",
              network: "string",
              payer: "string",
            },
          },
        },
      ],
      payments: {
        facilitatorUrl:
          process.env.FACILITATOR_URL ||
          "https://facilitator.daydreams.systems",
        payTo:
          process.env.PAY_TO || "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429",
        network: process.env.NETWORK || "base",
        defaultPrice: process.env.DEFAULT_PRICE || "0.02",
      },
    },
    null,
    2,
  ),
);
