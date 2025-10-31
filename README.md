# Slippage Sentinel

Estimate safe slippage tolerance for any swap route across Ethereum, Base, Arbitrum, and BNB Smart Chain. Complete with pool depth analysis, trade size projections, and volatility signals.

## Quick Start

### 1. Install dependencies
```bash
bun install
```

### 2. Configure environment
Copy `.env.example` then fill in the keys (payment wallet, facilitator, API keys, etc.). Minimal local set:
```bash
cp .env.example .env
```

### 3. Generate manifest (after every config change)
```bash
bun run manifest
```

### 4. Run the development server
```bash
bun run dev
```
`http://localhost:8787/.well-known/agent.json` now serves the agent manifest.

## Invoke Locally

### Without payment (inspect 402)
```bash
curl -X POST http://localhost:8787/entrypoints/getSafeSlippage/invoke \
  -H "Content-Type: application/json" \
  -d '{"input":{"token_in":"0x4200000000000000000000000000000000000006","token_out":"0x2f2a2543b76a4166549f7aab2e75bef0aef033d0","amount_in":10,"route_hint":"base"}}'
```
You receive a 402 response describing the mandate.

### With payment (helper script)
```bash
bun run pay:call
```
The script reads `.env`, signs an x402 payment, retries the request, and prints the slippage recommendation plus decoded receipt.
By default the helper evaluates all supported chains; set `TOKEN_IN`, `TOKEN_OUT`, `AMOUNT_IN`, `ROUTE_HINT`, etc. to override:
```bash
TOKEN_IN=0x4200000000000000000000000000000000000006 TOKEN_OUT=0x2f2a2543b76a4166549f7aab2e75bef0aef033d0 AMOUNT_IN=100 ROUTE_HINT=ethereum bun run pay:call
```

## Endpoint Specification

| Field | Details |
| --- | --- |
| **Path** | `/entrypoints/getSafeSlippage/invoke` |
| **Method** | POST (x402 exact payment, invoke price `0.02 USDC`) |
| **Input** | `{ token_in, token_out, amount_in, route_hint }` |
| **Output** | `{ min_safe_slip_bps, pool_depths, recent_trade_size_p95, volatility_index }` |
| **Chains** | `ethereum`, `base`, `arbitrum`, `bsc` |

Example success payload:
```json
{
  "min_safe_slip_bps": 50,
  "pool_depths": 1500000.50,
  "recent_trade_size_p95": 50000.00,
  "volatility_index": 2.50
}
```

## Supported Networks

- Ethereum 
- Base (Tested on production)
- Arbitrum
- BSC (Binance Smart Chain)
- Polygon
- Optimism
- Avalanche
- Fantom

## Environment Variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PRIVATE_KEY` | Yes | Wallet that signs x402 requests (and receives payments if `PAY_TO` points to same address). |
| `FACILITATOR_URL` | Yes | Usually `https://facilitator.daydreams.systems`. |
| `PAY_TO` | Yes | Recipient wallet for the invoke payment. |
| `NETWORK` | Yes | Payment network (e.g. `base`, `base-sepolia`). |
| `DEX_SCREENER_BASE_URL` | Optional | Override default DexScreener API URL (default: `https://api.dexscreener.com`). |
| `GECKO_TERMINAL_BASE_URL` | Optional | Override default GeckoTerminal API URL (default: `https://api.geckoterminal.com`). |
| `DEFAULT_PRICE` | Optional | Default x402 price when an entrypoint omits `price`. |
| `API_BASE_URL` | Optional | Use when deploying (manifest generation). |
| `PORT` | Optional | Server port (default: 8787). |

## Testing & QA

```bash
bun test          # unit tests (slippage calculation logic)
bunx tsc --noEmit # type checking
bun run lint      # linting
```

## Deployment Checklist

- [ ] Update `.env` with production values (API base URL, facilitators, payment wallet).
- [ ] `bun run manifest` with `API_BASE_URL` pointing to deployed domain.
- [ ] Deploy to Vercel: `bunx vercel login && bunx vercel deploy`.
- [ ] Confirm `/.well-known/agent.json` is reachable at the deployed URL.
- [ ] Run `bun run pay:call` against production URL to verify x402 flow.
- [ ] Update this README with the live endpoint URL.

Happy swapping!
