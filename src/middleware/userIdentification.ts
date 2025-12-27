import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma/client';

/**
 * Middleware to identify users by X-User-Email header.
 * - Extracts email from X-User-Email header
 * - Auto-creates user if not exists
 * - Returns 400 if header missing
 * - Attaches user to request object
 *
 * Requirements: 18.1, 18.3, 18.4
 */
export async function userIdentification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const email = req.headers['x-user-email'];

  // Validate header presence
  if (!email || typeof email !== 'string') {
    res.status(400).json({
      error: {
        code: 'USER_EMAIL_REQUIRED',
        message: 'X-User-Email header is required',
      },
    });
    return;
  }

  // Validate email format (basic validation)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({
      error: {
        code: 'INVALID_EMAIL',
        message: 'Invalid email format in X-User-Email header',
      },
    });
    return;
  }

  try {
    // Auto-create user if not exists (upsert)
    const user = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Error in user identification middleware:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  }
}

export default userIdentification;
