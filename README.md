# Morpho Blue Looping Simulator

Simulate recursive lending loops on Morpho Blue (Base) before committing on-chain. The service returns leverage stats, health factor trajectories, stress scenarios, and an executable action plan for WETH/USDC markets with deterministic pricing and optional Kyber quotes.

## Quick Start

1. **Install dependencies**
   ```bash
   bun install
   ```
2. **Configure environment**
   Copy `.env.example` and set the values you need (payment wallet, facilitator, etc.).
   ```bash
   cp .env.example .env
   ```
3. **Run the development server**
   ```bash
   bun run dev
   ```
   The agent listens on `http://localhost:8787` and exposes `/.well-known/agent.json` plus the paid entrypoint `/entrypoints/simulateLooping/invoke`.

## Paying & Invoking

Use the helper script to settle the 402 mandate and invoke the simulator:
```bash
PRIVATE_KEY=0x... bun run pay:call
```
Optional environment overrides:
- `API_BASE_URL` – default `http://localhost:8787`
- `START_CAPITAL`, `TARGET_LTV`, `LOOPS` – quick value overrides
- `PRICE_WETHUSD` – supply a deterministic spot price
- `MORPHO_USE_LIVE=1` – force live market fetch (otherwise automatic with fallback)

You can also pass a raw payload as the second CLI argument:
```bash
bun run pay:call '{"protocol":"morpho-blue","chain":"base","collateral":{"symbol":"WETH","decimals":18},"debt":{"symbol":"USDC","decimals":6},"start_capital":"2","target_ltv":0.55,"loops":4}'
```

## API Contract

- **Method:** `POST /entrypoints/simulateLooping/invoke`
- **Price:** `$0.20 USD` via x402
- **Required fields:**
  ```json
  {
    "protocol": "morpho-blue",
    "chain": "base",
    "collateral": { "symbol": "WETH", "decimals": 18 },
    "debt": { "symbol": "USDC", "decimals": 6 },
    "start_capital": "1.0",
    "target_ltv": 0.6,
    "loops": 3
  }
  ```
- **Optional:** `price`, `swap_model`, `oracle`, `rates`, `horizon_days`, `scenarios`, `risk_limits`

Supported stress scenarios:
- `price_jump` – apply collateral price shock at a specific day
- `rates_shift` – shift borrow APR by the provided delta (basis points)
- `oracle_lag` – recompute trajectory with a slower oracle heartbeat

Successful responses follow the `LoopingSimulationResult` schema defined in `src/types.ts`, including summary metrics, a full time series, stress outcomes, action plan, and a receipt that embeds the provenance hash.

## Testing & QA

```bash
bun test             # unit and integration tests
bunx tsc --noEmit    # strict type checking
bun run lint         # linting
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PRIVATE_KEY` | For script | Wallet signing x402 payments |
| `FACILITATOR_URL` | Yes | x402 facilitator URL (default: Coinbase) |
| `PAY_TO` | Yes | Address that receives invoke payments |
| `NETWORK` | Yes | Payment network (`base` or `base-sepolia`) |
| `MORPHO_BLUE_GRAPH_URL` | Optional | Override Morpho Blue GraphQL endpoint |
| `MORPHO_LIVE_DISABLED` | Optional | Set to `1` to use fixture parameters only |
| `MORPHO_LIVE_CACHE_MS` | Optional | Cache TTL for live market snapshot (default 30000ms) |
| `KYBER_AGGREGATOR_BASE_URL` | Optional | Override Kyber GET route base URL |
| `PORT` | Optional | Local port for dev server (default: 8787) |

## Project Layout

```
.well-known/agent.json   # Agent manifest
api/index.ts             # Hono + x402 server bootstrap
src/adapters/            # Morpho fixtures & Kyber client
src/core/                # Pure simulation engine
src/models/              # AMM + oracle models
src/risk/                # Policy checks
src/schema.ts            # Runtime validation (zod)
src/types.ts             # Shared TypeScript interfaces
test/                    # bun test suites
```

## Assumptions

- The primary market is Base WETH/USDC; live market data is fetched from Morpho's Blue API with fixture fallback.
- Borrow/supply APRs default to the latest live snapshot (or 5.9% / 3.25% when offline).
- When no swap model is provided the service queries KyberSwap V1 and caches responses for 30 seconds; for tests or fully offline use provide a constant-product swap model.

## Next Steps

- Model time-varying oracle paths so oracle-lag scenarios incorporate stale price windows.
- Add sensitivity outputs (e.g. dHF/dPrice) and Monte Carlo stress harness.
- Introduce additional strategies via new entrypoints once Phase 2 stabilises.
