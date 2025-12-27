/**
 * Admin Routes - Handles admin-only endpoints
 *
 * GET /api/admin/events - View all events with filters
 * GET /api/admin/wallet - View wallet balance
 * GET /api/admin/wallet/movements - View wallet movements with filters
 * GET /api/admin/emails - View simulated emails
 * GET /api/admin/users/:email/history - View user history (bonus)
 *
 * Requirements: 8.1-8.7, 9.1-9.4, 10.1-10.3, 15.1-15.4
 */

import { Router, Request, Response, NextFunction } from 'express';
import { EventType, EmailType } from '@prisma/client';
import { userIdentification, adminOnly } from '../middleware';
import { getEvents } from '../services/eventService';
import { getBalance, getMovements } from '../services/walletService';
import { getEmails } from '../services/emailService';
import { getUserHistory } from '../services/userService';

const router = Router();

// Apply user identification and admin check to all routes
router.use(userIdentification);
router.use(adminOnly);

/**
 * GET /api/admin/events
 *
 * View all events with optional filters and pagination.
 *
 * Query Parameters:
 * - userEmail: Filter by user email
 * - bookIsbn: Filter by book ISBN
 * - type: Filter by event type (BORROW, RETURN, BUY, etc.)
 * - startDate: Filter by start date (ISO string)
 * - endDate: Filter by end date (ISO string)
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 10, max: 100)
 *
 * Response:
 * - 200: Paginated list of events
 * - 403: Not admin
 */
router.get(
  '/events',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userEmail, bookIsbn, type, startDate, endDate, page, pageSize } =
        req.query;

      const result = await getEvents({
        userEmail: userEmail as string | undefined,
        bookIsbn: bookIsbn as string | undefined,
        type: type as EventType | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/wallet
 *
 * View the current wallet balance.
 *
 * Response:
 * - 200: Wallet balance in cents and formatted string
 * - 403: Not admin
 */
router.get(
  '/wallet',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const balance = await getBalance();

      res.status(200).json(balance);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/wallet/movements
 *
 * View wallet movements with optional filters and pagination.
 *
 * Query Parameters:
 * - type: Filter by credit/debit
 * - startDate: Filter by start date (ISO string)
 * - endDate: Filter by end date (ISO string)
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 10, max: 100)
 *
 * Response:
 * - 200: Paginated list of wallet movements
 * - 403: Not admin
 */
router.get(
  '/wallet/movements',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type, startDate, endDate, page, pageSize } = req.query;

      const result = await getMovements({
        type: type as 'credit' | 'debit' | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;


/**
 * GET /api/admin/emails
 *
 * View simulated emails with optional filters and pagination.
 *
 * Query Parameters:
 * - recipient: Filter by recipient email
 * - type: Filter by email type (LOW_STOCK, REMINDER, MILESTONE)
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 10, max: 100)
 *
 * Response:
 * - 200: Paginated list of simulated emails
 * - 403: Not admin
 */
router.get(
  '/emails',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recipient, type, page, pageSize } = req.query;

      const result = await getEmails({
        recipient: recipient as string | undefined,
        type: type as EmailType | undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/admin/users/:email/history
 *
 * View a specific user's borrowing and buying history with summary statistics.
 *
 * Path Parameters:
 * - email: User's email address
 *
 * Response:
 * - 200: User history with borrows, purchases, and summary stats
 * - 403: Not admin
 * - 404: User not found
 */
router.get(
  '/users/:email/history',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.params;

      const result = await getUserHistory(email);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);
