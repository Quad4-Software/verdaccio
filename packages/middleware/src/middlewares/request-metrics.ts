import type { NextFunction, Request, Response } from 'express';

export interface RequestMetrics {
  startedAt: string;
  total: number;
  byStatus: Record<string, number>;
}

const counters = {
  startedAt: new Date().toISOString(),
  total: 0,
  byStatus: {} as Record<string, number>,
};

/**
 * Counts finished responses by status class. Process-local on purpose, the
 * admin endpoint reports it as an in-memory signal, not a prometheus source.
 */
export function requestMetrics(_req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    counters.total += 1;
    const bucket = `${Math.floor(res.statusCode / 100)}xx`;
    counters.byStatus[bucket] = (counters.byStatus[bucket] ?? 0) + 1;
  });
  next();
}

export function getRequestMetrics(): RequestMetrics {
  return {
    startedAt: counters.startedAt,
    total: counters.total,
    byStatus: { ...counters.byStatus },
  };
}
