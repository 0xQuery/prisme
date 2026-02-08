import { getServerState } from "@/lib/server-state";

interface RateLimitOptions {
  key: string;
  windowMs: number;
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export function applyRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const state = getServerState();
  const existing = state.rateLimits.get(options.key);

  if (!existing || now >= existing.resetAtMs) {
    state.rateLimits.set(options.key, {
      count: 1,
      resetAtMs: now + options.windowMs,
    });
    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetAtMs: now + options.windowMs,
    };
  }

  existing.count += 1;
  const remaining = Math.max(options.maxRequests - existing.count, 0);

  return {
    allowed: existing.count <= options.maxRequests,
    remaining,
    resetAtMs: existing.resetAtMs,
  };
}

