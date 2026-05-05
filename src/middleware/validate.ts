import type { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { badRequest } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(badRequest('Validation failed', result.error.flatten()));
    }
    // Replace with parsed (coerced) data
    if (source === 'body') req.body = result.data;
    else if (source === 'query') req.query = result.data;
    else req.params = result.data;
    next();
  };
