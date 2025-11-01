# AGENT SPECIFICATION: DeFi Strategy Simulator for Morpho Blue

## Overview

This document defines the requirements, architecture, API contracts and development phases for a **DeFi Strategy Simulation API** targeted at agents. The service simulates looping (recursive lending) positions on Morpho Blue markets deployed to the **Base** network. The API is designed to be invoked via HTTP 402 with a flat per‑call payment of **\$0.20** and returns detailed analytics, risk metrics and a machine‑readable action plan to the caller.

Morpho Blue lending markets expose clear risk metrics: the Loan‑To‑Value (LTV) ratio measures the proportion of debt relative to collateral[\[1\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=The%20Loan,Morpho%2C%20use%20the%20following%20formula), and the **Liquidation Loan‑To‑Value** (LLTV) parameter defines the maximum borrowable amount before liquidation[\[2\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan). Morpho derives a **Health Factor** from these values; a position is considered healthy when Health Factor > 1.0 and becomes eligible for liquidation when the ratio drops below 1.0[\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan). Borrow interest rates are calculated by a market‑specific **Interest Rate Model (IRM)**, typically AdaptiveCurveIRM, which adjusts rates according to market utilisation[\[4\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=Interest%20Rates). Interest accrues continuously on outstanding debt[\[5\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=How%20Interest%20Accrues%20on%20Debt), causing the LTV to rise even if prices remain constant. Oracles supply price information for each market; Morpho markets are configured at deployment with an immutable oracle and risk parameters[\[6\]](https://docs.morpho.org/curate/tutorials-market-v1/deploying-oracle#:~:text=Understanding%20Oracles%20in%20Morpho). The simulation API must respect these mechanics to produce accurate results.

KyberSwap's Aggregator API will be used as the optional source of truth for swap quotes. The V1 API exposes a GET endpoint to return the best route for a given token pair and amount[\[7\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Please%20use%20the%20%60,change%20being%20the%20queried%20path), followed by a POST endpoint that returns encoded swap data[\[8\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Step%201%3A%20Query%20Swap%20Route). For performance reasons, the API will query the GET route for each loop step when the user does not provide their own swap_model and will cache the result with a short Time‑To‑Live (TTL). Note that Kyber's API returns raw calldata and route information and requires integrators to verify transaction details themselves[\[9\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Overview).

### Purpose

Agents that plan to open leveraged positions or rebalance debt on lending platforms need a deterministic view of how their health factor, leverage and net yield evolve under different conditions. Simulating the loop process off‑chain reduces on‑chain risk and prevents execution failures due to unsafe parameters. The simulator should provide: a summary of leverage and risk at the target number of loops, a time series of collateral and debt, stress scenarios (price jumps, rate shifts, oracle lag), and a machine‑readable action plan describing the borrow/swap/supply steps.

## Phases

### Phase 1: Minimum Viable Product (MVP)

#### Scope

- **Protocol & Network:** Implement support for the WETH/USDC market on **Morpho Blue**, deployed on **Base**. All market parameters (LLTV, liquidation bonus, IRM, oracle type) must be read from fixtures or query functions. The IRM may be approximated by supplying fixed APR snapshots for borrow and supply in the first release.
- **Endpoint:** Expose a single entrypoint at POST /entrypoints/simulateLooping/invoke. The server must enforce HTTP 402 (Payment Required) using the x402 protocol: return a 402 mandate when the call is unpaid, accept the payment and then return the simulation result including a payment receipt. Price each call at **\$0.20**.
- **Inputs:** The request body is a JSON object with fields listed in the LoopingSimulationInput type (see below). Only the following are required: protocol, chain, collateral, debt, start_capital, target_ltv and loops. Optional fields include price, swap_model, oracle, rates, horizon_days, scenarios and risk_limits.
- **Outputs:** Return a JSON object matching the LoopingSimulationResult type. In addition to summary metrics, return a receipt object containing the x402 payment metadata and a provenance_hash computed by hashing the input, protocol parameters used, cached quote payloads and version identifier.
- **Determinism:** The engine must be deterministic for identical inputs. When price and swap_model are omitted, external data (spot price, Kyber quotes) may vary; therefore, cache the Kyber quote response keyed by (chain, tokenIn, tokenOut, amount, slippage_bps) with a TTL of 30 seconds. If the cached entry exists, reuse it; otherwise, fetch a fresh quote.
- **Core Mechanics:** Implement the loop formulas for collateral, debt, leverage and health factor. The borrow fraction per loop is b = target_ltv / LLTV and swap efficiency is (1 - fee - slippage). Accrue interest per second using supplied or snapshot APRs. Compute health factor as (collateral_value × LLTV) / debt_value[\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan). Liquidation occurs when HF < 1.0.
- **Stress Scenarios:** Support a single price jump scenario in v0. A scenario is defined by {type:"price_jump", asset, shock_pct, at_day}. Apply the shock to price (or chainlink price) at the specified horizon and recompute min health factor and liquidation outcome.
- **Fixtures & Tests:** Add fixtures for Morpho Blue WETH/USDC market on Base capturing LLTV, liquidation bonus and IRM details. Write unit tests to verify health factor formula, APR accrual and constant‑product slippage calculation.

#### Directory Structure

When cloning the slippage-sentinel boilerplate, remove all application‑specific .ts files. Build the new project under the same structure:

```
.well-known/agent.json # Agent manifest describing price and entrypoints
api/index.ts # HTTP server with x402 middleware and routing
src/core/looping.ts # Pure functions for loops, HF, interest, slippage
src/models/amm_xyk.ts # Constant-product AMM model
src/models/oracle.ts # Models Oracle lag via heartbeat/deviation
src/adapters/morpho.ts # Fixtures for Morpho Blue Base market
src/adapters/kyber.ts # Kyber API client and caching layer
src/risk/canExecute.ts # Rejects unsafe inputs (e.g. target LTV ≥ LLTV)
test/ # Unit and golden test cases
```

Ensure .well-known/agent.json advertises the entrypoint, price and description as per the boilerplate pattern. Keep all pure logic in src/core without side effects; only api/index.ts and adapters interact with network or caching.

### Phase 2: Strategy and Realism Upgrades

After delivering the MVP, extend functionality while maintaining the existing API contract.

- **Interest Rate Model:** Integrate Morpho Blue's real IRM. Each market uses an immutable IRM contract which calculates the borrow rate based on utilisation[\[10\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=The%20Role%20of%20the%20Interest,IRM). Pull utilisation and apply the IRM to accrue debt. Provide a way to override IRM or use latest snapshot when deterministic output is required.
- **Live Market Parameters:** Use Morpho Blue SDK (such as @morpho-blue/core via viem) to fetch LLTV, liquidation incentive and current APRs at request time. Include these parameters in protocol_params_used for reproducibility. Expose overrides in the input when needed.
- **Additional Strategies:** Add new entrypoints under /entrypoints/simulate{Strategy} for collateral swaps, perp basis trades, Pendle carry, or Uniswap V3 LP simulations. Each strategy must define its own input type and reuse core models where possible.
- **Expanded Stress Tests:** Support multiple shocks (e.g., price jumps, rate shifts, oracle lag) and Monte Carlo sampling for price paths. Return sensitivity metrics such as dHF/dPrice or probability of liquidation.
- **Distribution:** Publish .well-known/agent.json with all entrypoints and pricing so that external agent frameworks can discover and pay for the service.

### Phase 3: Productization and Ecosystem

- **Caching and Quotas:** Implement an LRU cache for Kyber quotes and tune TTL to balance freshness and cost. Add per‑IP or per‑API key rate limits. Enforce idempotency keys to avoid duplicate charges.
- **Observability:** Log each run with input hash, HF trajectory, minHF, fees and quote identifier. Emit metrics for latency and success rates.
- **Safety and Governance:** Introduce policy envelopes: default minimum HF (e.g. 1.10), maximum number of loops (e.g. 10), and maximum slippage tolerance. Return a canExecute flag with reasons if a simulation violates policy.
- **More Strategies:** Continue adding modules such as liquidation simulators, RWA cash management and cross‑chain bridging models.
- **Documentation & Examples:** Provide sample client scripts that demonstrate paying with x402, invoking the endpoint and parsing results. Include guidelines for unit testing and integration.

## Input and Output Types

Define interfaces in TypeScript (or JSON Schema) to enforce strict types. These types should live in src/types.ts and be reused by controllers and tests.

```typescript
// LoopingSimulationInput specifies parameters for the looping simulation.
export interface LoopingSimulationInput {
  protocol: "morpho-blue"; // protocol name
  chain: "base"; // deployment chain
  collateral: TokenSpec; // collateral token (symbol, decimals)
  debt: TokenSpec; // debt token (symbol, decimals)
  start_capital: string; // collateral amount in human units
  target_ltv: number; // per-loop LTV ratio (0-1)
  loops: number; // number of recursive loops to perform
  price?: Record<string, number>; // optional price map, e.g. {WETHUSD: 3200}
  swap_model?: SwapModelSpec; // optional constant-product model spec
  oracle?: {
    type: "chainlink";
    lag_seconds: number; // heartbeat/deviation lag to model stale updates
  };
  rates?: {
    supply_apr: number; // fixed supply APR (decimal), optional
    borrow_apr: number; // fixed borrow APR (decimal), optional
  };
  horizon_days?: number; // analysis horizon in days (default 30)
  scenarios?: ScenarioSpec[]; // list of stress scenarios (see below)
  risk_limits?: {
    min_hf?: number; // minimum acceptable health factor
    max_leverage?: number; // maximum gross leverage
  };
}
export interface TokenSpec {
  symbol: string;
  decimals: number;
}
export interface SwapModelSpec {
  type: "amm_xyk";
  fee_bps: number; // pool fee in basis points
  pool: {
    base_reserve: number;
    quote_reserve: number;
  };
}
export type ScenarioSpec =
  | {
      type: "price_jump";
      asset: string; // symbol of asset to shock
      shock_pct: number; // e.g. -0.15 for −15%
      at_day: number; // day index to apply shock
    }
  | {
      type: "rates_shift";
      borrow_apr_delta_bps: number; // shift in borrow APR (basis points)
    }
  | {
      type: "oracle_lag";
      lag_seconds: number; // override oracle lag for scenario
    };
// Result of simulation
export interface LoopingSimulationResult {
  summary: {
    loops_done: number;
    gross_leverage: number;
    net_apr: number; // net carry APR after fees and borrow
    hf_now: number; // current health factor after loops
    liq_price: Record<string, number>; // price at which HF crosses 1.0
    slip_cost_usd: number; // slippage & fee cost from swaps
  };
  time_series: Array<{
    t: number; // day index (0-horizon_days)
    collateral: number; // collateral amount (units)
    debt: number; // debt amount (loan units)
    equity: number; // collateral_value − debt_value (USD)
    hf: number; // health factor at time t
  }>;
  stress: Array<{
    scenario: string;
    min_hf: number;
    liquidated: boolean;
    liq_loss_usd?: number;
  }>;
  action_plan: Array<SimulationStep>; // borrow/swap/supply steps
  protocol_params_used: MorphoMarketParams; // snapshot of LLTV, bonus, IRM
  receipt: {
    payment: any; // decoded x402 receipt information
    provenance_hash: string; // sha256 over input + params + quotes
  };
  canExecute?: boolean; // optional flag when risk limits are violated
  reason?: string; // reason when canExecute is false
}
export interface SimulationStep {
  borrow?: {
    asset: string;
    amount: number; // debt units
  };
  swap?: {
    from: string;
    to: string;
    amount_in: number;
    amount_out: number;
    route?: any; // optional route details from Kyber
  };
  supply?: {
    asset: string;
    amount: number;
  };
}
export interface MorphoMarketParams {
  lltv: number; // liquidation LTV (decimal)
  liquidation_incentive: number; // liquidation bonus (decimal)
  close_factor: number; // portion of debt that can be repaid by liquidator
  irm: string; // interest rate model identifier
  oracle_type: string; // e.g. chainlink
}
```

Ensure that numeric values are parsed as BigNumber or BigInt where precision matters (token units, USD amounts, reserves). Avoid floating‑point arithmetic; wrap all multiplications and divisions in a safe decimal library (e.g. ethers.js FixedNumber or bignumber.js).

## Application Flow

- **Client Request:** The caller sends a POST request to /entrypoints/simulateLooping/invoke with a JSON body conforming to LoopingSimulationInput.
- **Payment Check:** The HTTP server checks for an x402 payment. If none is provided, respond with status 402 and a payment mandate describing the price. Once payment is received, continue.
- **Parameter Validation:** In canExecute.ts, validate that target_ltv < protocol_params.lltv and loops is positive and does not exceed policy maximum. Ensure that required fields are present.
- **Market Parameter Resolution:** Load MorphoMarketParams for WETH/USDC on Base. If phase 2 enhancements are implemented, query live parameters via Morpho SDK; otherwise, use fixtures.
- **Price & Swap Resolution:**
- If price is provided, use it for display and slippage calculations.
- If price is absent, fetch a spot price via a pricing API or Chainlink feed (for display only) and use the oracle for HF.
- If swap_model is provided, compute slippage using the constant‑product formula and fee_bps. Otherwise, call the KyberSwap V1 GET route API to obtain the best route. Cache the response with 30 seconds TTL to avoid repeated calls. Extract amountOut and fees as the effective output for each swap.
- **Loop Computation:** For each loop k from 1 to loops:
- Compute the borrow amount as borrow = collateral_value × target_ltv.
- Swap borrowed assets into more collateral using the slippage model or Kyber quote; deduct fees.
- Update total collateral and debt.
- Update health factor using HF = (collateral_value × LLTV) / debt_value[\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan).
- **Interest Accrual:** Convert fixed or IRM‑derived APRs to per‑second rates. For a horizon of horizon_days, accrue interest on debt D(t) = D(0) × e^(borrow_rate × t). For supply, compute earned interest similarly and add to collateral. See Morpho docs describing how interest accrues continuously and increases debt[\[5\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=How%20Interest%20Accrues%20on%20Debt).
- **Stress Testing:** If scenarios are provided, simulate each scenario on top of the base trajectory. For a price jump, apply the shock to the price at at_day and recompute health factor. For rate shifts, adjust borrow rate by the delta. For oracle lag, freeze the oracle price for lag_seconds before updating.
- **Action Plan:** Generate a list of steps (borrow, swap, supply) for the client. Include the Kyber route details when applicable.
- **Receipt Construction:** Compute a provenance_hash as sha256(JSON.stringify({input, protocol_params_used, kyber_quotes, version})). Return both the payment receipt from x402 and the provenance hash.
- **Response:** Return a 200 JSON response with the result. If the simulation violates policy (e.g. final HF below min_hf), set canExecute to false and include a descriptive reason.

## Development Guidelines

To ensure a robust, maintainable implementation, adhere to the following principles and practices:

- **Separation of Concerns:** Keep pure simulation logic free from network or file system side effects. Adapters handle external interactions (pricing API, Kyber, Morpho SDK).
- **Strong Typing:** Use TypeScript with strict type checking. Define types for all inputs and outputs and avoid using any.
- **Determinism and Purity:** The core engine should be deterministic. External randomness must be injected via parameters. Hash all inputs and external data for reproducibility.
- **Error Handling:** Throw clear, descriptive errors for invalid inputs. When fetching external data, catch and wrap errors with context. Return canExecute:false rather than crashing.
- **Test Coverage:** Write unit tests for math functions (health factor, slippage, interest accrual) and integration tests for the API. Use fixtures for deterministic tests and store golden outputs for regression detection.
- **Documentation:** Document every function with JSDoc. Provide examples in README or docs on how to call the API with and without optional parameters. Reference Morpho docs for risk formulas and IRM behaviour[\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan)[\[5\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=How%20Interest%20Accrues%20on%20Debt).
- **Security Practices:** Never trust external inputs. Sanitize and validate all request data. Use dotenv or a secrets manager for API keys. Avoid exposing private keys or secrets in code.
- **Performance:** Cache Kyber quotes and expensive network calls. Use asynchronous operations for I/O. Avoid blocking the event loop with heavy computation; offload to worker threads if needed.
- **Compliance and Licensing:** Ensure that integration with external services (Kyber, Chainlink) complies with their terms of use.
- **Versioning:** Include a version field in protocol_params_used and in the provenance_hash. Update the version when the engine or market parameters change.

## Implementation Notes (2025-03-17)

- Phase 1 fixtures use Morpho Blue Base WETH/USDC parameters with LLTV `0.86`, liquidation incentive `0.05`, close factor `0.5`, and APR snapshots borrow `5.9%`, supply `3.25%`.
- When `price` is omitted, the simulator falls back to fixture prices (`WETHUSD: 3200`, `USDCUSD: 1`). Callers can override per request.
- Swap resolution prefers caller-provided constant-product models; otherwise it hits KyberSwap GET quotes with a 30-second in-memory cache.
- Receipt provenance hashes the raw request payload, protocol parameters, merged price map, collected Kyber payloads, and engine version `0.2.0`.

## Implementation Notes (2025-03-18)

- Phase 2 enables live Morpho Blue data via the Blue GraphQL API with a 30s cache; set `MORPHO_LIVE_DISABLED=1` to force fixture (used in tests).
- Live snapshots populate `protocol_params_used` with oracle/IRM addresses, market IDs, utilization, and timestamp; fixtures remain as fallback.
- Stress engine now supports `rates_shift` (borrow APR delta) and `oracle_lag` scenarios alongside `price_jump`.
- Net APR is derived from equity growth over the analysis horizon (slippage + financing costs reflected in the initial equity).
- Next targets: dynamic oracle price paths and expanded sensitivity metrics before introducing new entrypoints.

## Implementation Notes (2025-03-19)

- Morpho adapter now resolves any Base market by symbol/decimals (addresses optional) with cached market lists; WETH/USDC fixture remains a deterministic fallback.
- Kyber quote caching upgraded to an LRU strategy with configurable max entries/TTL to align with Phase 3 performance goals.
- Default policy envelope enforced: HF ≥ 1.1 and leverage ≤ 12 unless overrides are passed in `risk_limits`.
- Simulator version bumped to `0.3.0`; manifests/README updated to advertise multi-market support and new environment knobs.
- Rate limiting (30 req/min/IP by default) and idempotency caching (`Idempotency-Key` header) implemented per Phase 3 quotas. Cached responses persist for 10 minutes unless configured.
- Payment middleware now derives its ERC-20 asset from env; set `PAYMENT_ASSET_ADDRESS` when targeting Base Sepolia (defaults to Base mainnet USDC).
- Agent now leverages `@lucid-dreams/agent-kit` for payment handling/manifest generation, matching the Slippage Sentinel pattern.

## Instructions for the Coding Agent

- **Setup:** Clone the provided boilerplate repository and remove application‑specific .ts files. Initialize a new npm project or reuse the existing configuration. Install dependencies such as bun or express, ethers, axios, bignumber.js, and any Morpho SDK packages.
- **Agent Manifest:** Create .well-known/agent.json describing the service. Include metadata: name, description, icon URL, payment: {amount: "0.20", currency: "USD"}, and the entrypoint description. Follow the example from the boilerplate and keep relative URLs when possible.
- **HTTP Server:** Implement api/index.ts based on the sentinel template. Add middleware to enforce x402 payment. Validate content‑type, parse JSON and route to the appropriate handler.
- **Core Engine:** In src/core/looping.ts, implement functions for computing borrow amounts, slippage, collateral and debt after each loop, interest accrual and health factor. Use BigNumber arithmetic.
- **Adapters:**
- src/adapters/morpho.ts should load or query LLTV, liquidation incentives and IRM snapshots for the specified market. Provide default fixtures with values taken from Morpho docs and update them in phase 2.
- src/adapters/kyber.ts should define a function getQuote({ chain, tokenIn, tokenOut, amount }) which calls Kyber's V1 GET API and caches the response. Use environment variables for API keys if required.
- **Risk & Validation:** Implement canExecute.ts to check for safe parameter ranges. Reject any request where target_ltv is greater than or equal to LLTV[\[2\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan), loops are non‑positive, or external dependencies fail.
- **Receipt Handling:** Integrate with the x402 client library from Coinbase to decode payment receipts. Include the decoded receipt and provenance hash in the response.
- **Testing:** Use Jest or Bun's built‑in testing framework to write tests. Cover: health factor calculation, interest accrual, swap slippage with constant product model, Kyber quote caching, and policy enforcement.
- **Documentation:** At the end of development, ensure this AGENTS.md and inline JSDoc cover all public functions. Provide examples in the project README for calling the API with and without optional parameters.

## Summary

This specification describes a self‑contained, deterministic simulation service for Morpho Blue looping strategies with x402 payments. It outlines phased development, input/output schemas, core algorithms and practical guidelines for building and maintaining the system. By following these instructions, the coding agent will implement a robust and extensible simulator that aligns with DeFi risk mechanics and external service integrations. All critical formulas and behaviours derive from Morpho documentation[\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan) and Chainlink/IRMs[\[5\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=How%20Interest%20Accrues%20on%20Debt).

[\[1\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=The%20Loan,Morpho%2C%20use%20the%20following%20formula) [\[2\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan) [\[3\]](https://docs.morpho.org/build/borrow/concepts/ltv#:~:text=Liquidation%20Loan) Collateral, LTV & Health - Morpho Docs

<https://docs.morpho.org/build/borrow/concepts/ltv>

[\[4\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=Interest%20Rates) [\[5\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=How%20Interest%20Accrues%20on%20Debt) [\[10\]](https://docs.morpho.org/build/borrow/concepts/interest-rates#:~:text=The%20Role%20of%20the%20Interest,IRM) Interest Rates - Morpho Docs

<https://docs.morpho.org/build/borrow/concepts/interest-rates>

[\[6\]](https://docs.morpho.org/curate/tutorials-market-v1/deploying-oracle#:~:text=Understanding%20Oracles%20in%20Morpho) Deploy an Oracle for Morpho Markets - Morpho Docs

<https://docs.morpho.org/curate/tutorials-market-v1/deploying-oracle>

[\[7\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Please%20use%20the%20%60,change%20being%20the%20queried%20path) [\[8\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Step%201%3A%20Query%20Swap%20Route) [\[9\]](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api#:~:text=Overview) Execute A Swap With The Aggregator API | KyberSwap Docs

<https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/developer-guides/execute-a-swap-with-the-aggregator-api>
