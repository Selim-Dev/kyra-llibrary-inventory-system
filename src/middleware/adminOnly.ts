import { Request, Response, NextFunction } from 'express';

const ADMIN_EMAIL = 'admin@dummy-library.com';

/**
 * Middleware to restrict access to admin users only.
 * Must be used after userIdentification middleware.
 * - Checks if user email is admin@dummy-library.com
 * - Returns 403 if not admin
 */
export function adminOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Ensure user is attached (userIdentification should run first)
  if (!req.user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'User identification required',
      },
    });
    return;
  }

  // Check if user is admin
  if (req.user.email !== ADMIN_EMAIL) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
      },
    });
    return;
  }

  next();
}

export default adminOnly;
