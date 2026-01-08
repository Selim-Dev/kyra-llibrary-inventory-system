/**
 * Validation Middleware - Uses Zod for request validation
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../utils/errors';

/**
 * Middleware factory that validates request data against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export const validate = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
        headers: req.headers,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`);
        next(
          new BadRequestError('VALIDATION_ERROR', `Validation failed: ${messages.join(', ')}`)
        );
      } else {
        next(error);
      }
    }
  };
};
