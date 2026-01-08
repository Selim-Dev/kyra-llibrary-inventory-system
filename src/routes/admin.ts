/**
 * Admin Routes - Handles admin-only endpoints
 *
 * GET /api/admin/events - View all events with filters
 * GET /api/admin/wallet - View wallet balance
 * GET /api/admin/wallet/movements - View wallet movements with filters
 * GET /api/admin/emails - View simulated emails
 * GET /api/admin/users/:email/history - View user history (bonus)
 */

import { Router } from 'express';
import { userIdentification, adminOnly, validate } from '../middleware';
import {
  getEventsSchema,
  getWalletMovementsSchema,
  getEmailsSchema,
  getUserHistorySchema,
} from '../schemas';
import { adminController } from '../controllers';

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
  validate(getEventsSchema),
  adminController.getEvents.bind(adminController)
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
router.get('/wallet', adminController.getWalletBalance.bind(adminController));

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
  validate(getWalletMovementsSchema),
  adminController.getWalletMovements.bind(adminController)
);

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
  validate(getEmailsSchema),
  adminController.getEmails.bind(adminController)
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
  validate(getUserHistorySchema),
  adminController.getUserHistory.bind(adminController)
);

export default router;
