/**
 * Buy Routes - Handles book buying and cancel endpoints
 *
 * POST /api/books/:isbn/buy - Buy a book
 * POST /api/purchases/:id/cancel - Cancel a purchase
 *
 * Requirements: 4.1-4.15, 5.1-5.9
 */

import { Router, Request, Response, NextFunction } from 'express';
import { buyBook, cancelPurchase } from '../services/buyService';
import { userIdentification, idempotency } from '../middleware';
import { formatMoney } from '../utils/money';

const router = Router();

/**
 * POST /api/books/:isbn/buy
 *
 * Buy a book by ISBN.
 *
 * Headers:
 * - X-User-Email: User's email address (required)
 * - X-Idempotency-Key: Idempotency key (required)
 *
 * Response:
 * - 200: Buy successful
 * - 400: Missing X-User-Email or X-Idempotency-Key header
 * - 404: Book not found
 * - 409: No copies available or buy limit exceeded
 */
router.post(
  '/books/:isbn/buy',
  userIdentification,
  idempotency(true), // Require idempotency key
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isbn } = req.params;
      const userEmail = req.user!.email;

      const result = await buyBook(userEmail, isbn);

      const response = {
        purchase: {
          id: result.purchase.id,
          bookIsbn: result.purchase.book.isbn,
          bookTitle: result.purchase.book.title,
          purchasedAt: result.purchase.purchasedAt.toISOString(),
          status: result.purchase.status,
          priceCents: result.purchase.priceCents,
          priceFormatted: formatMoney(result.purchase.priceCents),
        },
        isExisting: result.isExisting,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/purchases/:id/cancel
 *
 * Cancel a purchase by ID.
 *
 * Headers:
 * - X-User-Email: User's email address (required)
 *
 * Response:
 * - 200: Cancel successful (or already canceled for idempotency)
 * - 400: Missing X-User-Email header or cancellation window expired
 * - 404: Purchase not found
 */
router.post(
  '/purchases/:id/cancel',
  userIdentification,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userEmail = req.user!.email;

      const result = await cancelPurchase(userEmail, id);

      const response = {
        purchase: {
          id: result.purchase.id,
          bookIsbn: result.purchase.book.isbn,
          bookTitle: result.purchase.book.title,
          purchasedAt: result.purchase.purchasedAt.toISOString(),
          canceledAt: result.purchase.canceledAt?.toISOString() || null,
          status: result.purchase.status,
          priceCents: result.purchase.priceCents,
          priceFormatted: formatMoney(result.purchase.priceCents),
        },
        isExisting: result.isExisting,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
