import { LRUCache } from "lru-cache";

interface StoredEntry<T = unknown> {
  value: T;
  storedAt: number;
}

const ttlMs = Number(process.env.IDEMPOTENCY_TTL_MS ?? 10 * 60 * 1000);
const maxEntries = Number(process.env.IDEMPOTENCY_CACHE_MAX ?? 512);

const cache = new LRUCache<string, StoredEntry>({ ttl: ttlMs, max: maxEntries });

export function getCachedValue<T>(key: string): T | undefined {
  const entry = cache.get(key);
  return entry?.value as T | undefined;
}

export function storeValue<T>(key: string, value: T): void {
  cache.set(key, { value, storedAt: Date.now() });
}

export function clearIdempotencyCache(): void {
  cache.clear();
}
