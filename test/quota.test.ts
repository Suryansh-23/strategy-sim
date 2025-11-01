import { describe, expect, test } from "bun:test";

import { enforceRateLimit, clearRateLimitBuckets } from "../src/utils/quota.js";

describe("rate limiting", () => {
  test("throws once the bucket is exhausted", () => {
    clearRateLimitBuckets();
    const ip = "127.0.0.1";
    const route = "/entrypoints/simulateLooping/invoke";

    for (let i = 0; i < 30; i += 1) {
      enforceRateLimit(ip, route);
    }

    expect(() => enforceRateLimit(ip, route)).toThrowError(/Rate limit exceeded/);
  });
});
