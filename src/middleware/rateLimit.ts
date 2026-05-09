import type { Request, Response, NextFunction } from 'express';

// Lightweight in-memory rate limiter — fine for single-process dev.
// For production with multiple workers, swap the bucket store for Redis.

interface Options {
  keyPrefix: string;
  windowMs: number;
  max: number;
  message?: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientKey(req: Request, prefix: string): string {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';
  return `${prefix}:${ip}`;
}

export function rateLimit({ keyPrefix, windowMs, max, message }: Options) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }

    const key = clientKey(req, keyPrefix);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: message ?? 'Too many requests. Try again later.',
        retryAfter,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}
