import { HTTPException } from "hono/http-exception";

interface BucketState {
  count: number;
  reset: number;
}

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 30);

const buckets = new Map<string, BucketState>();

function getKey(ip: string | null, entrypoint: string): string {
  return `${ip ?? "unknown"}:${entrypoint}`;
}

export function enforceRateLimit(ip: string | null, entrypoint: string): void {
  const now = Date.now();
  const key = getKey(ip, entrypoint);
  const bucket = buckets.get(key);

  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (process.env.LOG_RATE_LIMIT === "1") {
      console.info(
        JSON.stringify({
          event: "rate_limit_reset",
          timestamp: new Date().toISOString(),
          ip,
          entrypoint,
          windowMs,
          maxRequests,
        }),
      );
    }
    return;
  }

  if (bucket.count >= maxRequests) {
    const retryAfter = Math.ceil((bucket.reset - now) / 1000);
    console.warn(
      JSON.stringify({
        event: "rate_limit_block",
        timestamp: new Date().toISOString(),
        ip,
        entrypoint,
        retryAfter,
      }),
    );
    const error = new HTTPException(429, {
      message: `Rate limit exceeded. Try again in ${retryAfter}s`,
    });
    throw error;
  }

  bucket.count += 1;
  if (process.env.LOG_RATE_LIMIT === "1") {
    console.info(
      JSON.stringify({
        event: "rate_limit_increment",
        timestamp: new Date().toISOString(),
        ip,
        entrypoint,
        count: bucket.count,
        maxRequests,
      }),
    );
  }
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
