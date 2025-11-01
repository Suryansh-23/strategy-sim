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
   bun run dev          # add -- --debug for verbose logging
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
- `PRICE_WETHUSD` – supply a deterministic spot price (or add additional symbols like `WBTCUSD`)
- `MORPHO_USE_LIVE=1` – force live market fetch (otherwise automatic with fallback)
- `TEST_USE_SWAP_MODEL=1` – skip Kyber and use a built-in constant-product swap model (handy on testnets)

You can also pass a raw payload as the second CLI argument:
```bash
bun run pay:call '{"protocol":"morpho-blue","chain":"base","collateral":{"symbol":"WETH","decimals":18},"debt":{"symbol":"USDC","decimals":6},"start_capital":"2","target_ltv":0.55,"loops":4}'
```

## API Contract

- **Method:** `POST /entrypoints/simulateLooping/invoke`
- **Price:** `$0.20 USD` via x402
- **Body:** `{ "input": { ...simulation fields... } }`
- **Required fields:**
  ```json
  {
    "input": {
      "protocol": "morpho-blue",
      "chain": "base",
      "collateral": { "symbol": "WETH", "decimals": 18 },
      "debt": { "symbol": "USDC", "decimals": 6 },
      "start_capital": "1.0",
      "target_ltv": 0.6,
      "loops": 3
    }
  }
  ```
- **Optional:** `price`, `swap_model`, `oracle`, `rates`, `horizon_days`, `scenarios`, `risk_limits`

Token specs accept optional on-chain addresses for disambiguation when multiple assets share a symbol:

```json
"collateral": {
  "symbol": "wstETH",
  "decimals": 18,
  "address": "0x722e8645ff81919dfa44f1c6fda27affd2308a5d"
}
```

Without an address the simulator resolves markets by symbol/decimals on Base; provide addresses for faster lookups and to avoid ambiguity.

Headers:
- `Idempotency-Key` – optional string; when supplied, repeat requests return the cached response (up to the TTL) without recharging the 402 mandate.

Rate limits: default 30 requests per minute per IP (configurable via env). HTTP 429 is returned when exceeded. Use `bun run test:loop` (add `--pay` to include a payment attempt) to send a sample request and verify idempotent replay behaviour locally.

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
| `MORPHO_MARKET_LIST_CACHE_MS` | Optional | Cache TTL for market list query (default 120000ms) |
| `PAYMENT_ASSET_ADDRESS` | Yes on non-base | ERC-20 address x402 should charge (default: Base USDC) |
| `PAYMENT_ASSET_DECIMALS` | Optional | Asset decimals (default 6) |
| `PAYMENT_ASSET_NAME` | Optional | Asset EIP-712 name (default `USD Coin`) |
| `PAYMENT_ASSET_VERSION` | Optional | Asset EIP-712 version (default `2`) |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate limit window (default 60000) |
| `RATE_LIMIT_MAX` | Optional | Max requests per window per IP (default 30) |
| `IDEMPOTENCY_TTL_MS` | Optional | TTL for idempotent response cache (default 600000) |
| `IDEMPOTENCY_CACHE_MAX` | Optional | Max cached idempotent responses (default 512) |
| `DEFAULT_MIN_HEALTH_FACTOR` | Optional | Policy minimum HF (default 1.1) |
| `DEFAULT_MAX_LEVERAGE` | Optional | Policy maximum leverage (default 12) |
| `KYBER_AGGREGATOR_BASE_URL` | Optional | Override Kyber GET route base URL |
| `KYBER_CLIENT_ID` | Optional | Value for Kyber `X-Client-Id` header |
| `KYBER_CLIENT_SOURCE` | Optional | Value in Kyber `clientData.source` payload |
| `KYBER_INCLUDE_SOURCES` | Optional | Comma-separated DEX IDs to force-include |
| `KYBER_EXCLUDE_SOURCES` | Optional | Comma-separated DEX IDs to exclude |
| `KYBER_ORIGIN_ADDRESS` | Optional | Origin wallet address to unlock RFQ liquidity |
| `PAY_AND_CALL_MAX_USDC` | Optional | Max USDC spend (default 0.30) for helper script |
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

- Base is the supported chain in this release; any listed Morpho Blue market on Base can be simulated when symbols/addresses resolve.
- Borrow/supply APRs default to the latest live snapshot (or 5.9% / 3.25% when offline).
- When no swap model is provided the service queries KyberSwap V1 and caches responses with an LRU cache (30s TTL); provide a constant-product swap model for offline/deterministic runs.
- Default policy envelope enforces `HF ≥ 1.1` and `leverage ≤ 12` unless overridden in `risk_limits`.

## Next Steps

- Model time-varying oracle paths so oracle-lag scenarios incorporate stale price windows.
- Add sensitivity outputs (e.g. dHF/dPrice) and Monte Carlo stress harness.
- Introduce additional strategies via new entrypoints once multi-market support stabilises.
