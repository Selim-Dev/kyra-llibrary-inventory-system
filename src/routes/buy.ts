/**
 * Buy Routes - Handles book buying and cancel endpoints
 *
 * POST /api/books/:isbn/buy - Buy a book
 * POST /api/purchases/:id/cancel - Cancel a purchase
 */

import { Router } from 'express';
import { userIdentification, idempotency, validate } from '../middleware';
import { buyBookSchema, cancelPurchaseSchema } from '../schemas';
import { buyController } from '../controllers';

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
  validate(buyBookSchema),
  userIdentification,
  idempotency(true), // Require idempotency key
  buyController.buyBook.bind(buyController)
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
  validate(cancelPurchaseSchema),
  userIdentification,
  buyController.cancelPurchase.bind(buyController)
);

export default router;
