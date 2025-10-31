const manifest = {
  name: "morpho-blue-looping-sim",
  version: "0.2.0",
  description: "Simulate recursive lending loops on Morpho Blue (Base) with live market data",
  endpoints: [
    {
      key: "simulateLooping",
      description:
        "Run a looping simulation on Morpho Blue's Base WETH/USDC market using live parameters",
      method: "POST",
      path: "/entrypoints/simulateLooping/invoke",
      price: "$0.20",
      inputExample: {
        protocol: "morpho-blue",
        chain: "base",
        collateral: { symbol: "WETH", decimals: 18 },
        debt: { symbol: "USDC", decimals: 6 },
        start_capital: "1",
        target_ltv: 0.6,
        loops: 3,
      },
    },
  ],
  payments: {
    facilitatorUrl:
      process.env.FACILITATOR_URL || "https://facilitator.daydreams.systems",
    payTo:
      process.env.PAY_TO || "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429",
    network: process.env.NETWORK || "base",
    price: "$0.20",
  },
};

console.log(JSON.stringify(manifest, null, 2));
