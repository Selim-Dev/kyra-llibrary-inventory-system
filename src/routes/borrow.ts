/**
 * Borrow Routes - Handles book borrowing and returning endpoints
 *
 * POST /api/books/:isbn/borrow - Borrow a book
 * POST /api/books/:isbn/return - Return a book
 */

import { Router } from 'express';
import { userIdentification, validate } from '../middleware';
import { borrowBookSchema, returnBookSchema } from '../schemas';
import { borrowController } from '../controllers';

const router = Router();

/**
 * POST /api/books/:isbn/borrow
 *
 * Borrow a book by ISBN.
 *
 * Headers:
 * - X-User-Email: User's email address (required)
 *
 * Response:
 * - 200: Borrow successful (or existing borrow returned for idempotency)
 * - 400: Missing X-User-Email header
 * - 404: Book not found
 * - 409: No copies available or borrow limit exceeded
 */
router.post(
  '/:isbn/borrow',
  validate(borrowBookSchema),
  userIdentification,
  borrowController.borrowBook.bind(borrowController)
);

/**
 * POST /api/books/:isbn/return
 *
 * Return a borrowed book by ISBN.
 *
 * Headers:
 * - X-User-Email: User's email address (required)
 *
 * Response:
 * - 200: Return successful (or already returned for idempotency)
 * - 400: Missing X-User-Email header
 * - 404: Book not found or no active borrow found
 */
router.post(
  '/:isbn/return',
  validate(returnBookSchema),
  userIdentification,
  borrowController.returnBook.bind(borrowController)
);

export default router;
