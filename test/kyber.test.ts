import { afterEach, describe, expect, test, vi } from "bun:test";
import BigNumber from "bignumber.js";
import axios from "axios";

import {
  getKyberQuote,
  getKyberCacheSnapshot,
  clearKyberCache,
} from "../src/adapters/kyber.js";

describe("kyber adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearKyberCache();
  });

  test("caches identical quote requests", async () => {
    const mockResponse = {
      data: {
        data: {
          routeSummary: {
            amountOut: "1000000000000000000",
          },
          routes: [],
        },
      },
    };

    const spy = vi.spyOn(axios, "get").mockResolvedValue(mockResponse as never);

    const params = {
      chain: "base",
      tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      tokenOut: "0x4200000000000000000000000000000000000006",
      amount: new BigNumber("1000000"),
      slippageBps: 50,
    };

    await getKyberQuote(params);
    await getKyberQuote(params);

    expect(spy).toHaveBeenCalledTimes(1);
    const snapshot = getKyberCacheSnapshot();
    expect(Object.keys(snapshot).length).toBe(1);
  });
});
