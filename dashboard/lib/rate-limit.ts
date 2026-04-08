interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const RATE_LIMIT = 10; // requests per minute
const REFILL_INTERVAL_MS = 60_000; // 1 minute

const buckets = new Map<string, TokenBucket>();

/**
 * Simple in-memory token bucket rate limiter.
 * Returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: RATE_LIMIT, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = (elapsed / REFILL_INTERVAL_MS) * RATE_LIMIT;
  bucket.tokens = Math.min(RATE_LIMIT, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false;
  }

  bucket.tokens -= 1;
  return true;
}
