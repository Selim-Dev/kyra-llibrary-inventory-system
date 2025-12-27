/**
 * Idempotency Middleware - Handles X-Idempotency-Key header for buy operations
 *
 * Features:
 * - Checks X-Idempotency-Key header
 * - Returns 400 if missing for buy endpoint
 * - Wraps res.json to capture response body
 * - Stores/retrieves idempotency records (24 hour expiry)
 * - Scopes keys per user + endpoint
 *
 * Requirements: 17.3-17.6
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma/client';

// 24 hours in milliseconds
const IDEMPOTENCY_KEY_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Middleware to handle idempotency keys for buy operations.
 * Must be used after userIdentification middleware.
 *
 * @param requireKey - If true, returns 400 if X-Idempotency-Key header is missing
 */
export function idempotency(requireKey: boolean = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.headers['x-idempotency-key'];
    const userId = req.user?.id;
    const endpoint = `${req.method}:${req.path}`;

    // Check if key is required but missing
    if (requireKey && (!key || typeof key !== 'string')) {
      res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'X-Idempotency-Key header is required',
        },
      });
      return;
    }

    // If no key provided and not required, proceed without idempotency handling
    if (!key || typeof key !== 'string' || !userId) {
      next();
      return;
    }

    try {
      // Check for existing idempotency record
      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          key_userId_endpoint: { key, userId, endpoint },
        },
      });

      // If record exists and not expired, return cached response
      if (existing && existing.expiresAt > new Date()) {
        res.status(existing.statusCode).json(existing.response);
        return;
      }

      // If record exists but expired, delete it
      if (existing) {
        await prisma.idempotencyKey.delete({
          where: { id: existing.id },
        });
      }

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override res.json to capture response body
      res.json = function (body: unknown): Response {
        // Store response in locals for later use
        res.locals.responseBody = body;
        res.locals.idempotencyKey = key;
        res.locals.userId = userId;
        res.locals.endpoint = endpoint;

        // Call original json method
        return originalJson(body);
      };

      // Store response after handler completes (on finish event)
      res.on('finish', async () => {
        // Only store successful responses (not 5xx errors)
        if (res.statusCode < 500 && res.locals.responseBody && res.locals.idempotencyKey) {
          try {
            await prisma.idempotencyKey.upsert({
              where: {
                key_userId_endpoint: {
                  key: res.locals.idempotencyKey,
                  userId: res.locals.userId,
                  endpoint: res.locals.endpoint,
                },
              },
              create: {
                key: res.locals.idempotencyKey,
                userId: res.locals.userId,
                endpoint: res.locals.endpoint,
                response: res.locals.responseBody as object,
                statusCode: res.statusCode,
                expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_EXPIRY_MS),
              },
              update: {}, // Don't update if already exists
            });
          } catch (error) {
            // Log but don't fail the request if idempotency storage fails
            console.error('Failed to store idempotency key:', error);
          }
        }
      });

      next();
    } catch (error) {
      console.error('Error in idempotency middleware:', error);
      next(error);
    }
  };
}

export default idempotency;
