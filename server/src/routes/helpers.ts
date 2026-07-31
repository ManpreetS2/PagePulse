import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

/** Wrap async handlers so rejections reach the error middleware. */
export function asyncHandler(fn: Handler): Handler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function safeJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
