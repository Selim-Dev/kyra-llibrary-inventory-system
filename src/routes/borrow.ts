/**
 * Borrow Routes - Handles book borrowing and returning endpoints
 *
 * POST /api/books/:isbn/borrow - Borrow a book
 * POST /api/books/:isbn/return - Return a book
 */

import { Router, Request, Response, NextFunction } from 'express';
import { borrowBook, returnBook } from '../services/borrowService';
import { userIdentification, validate } from '../middleware';
import { formatMoney } from '../utils/money';
import { borrowBookSchema, returnBookSchema } from '../schemas';

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
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isbn } = req.params;
      const userEmail = req.user!.email;

      const result = await borrowBook(userEmail, isbn);

      const response = {
        borrow: {
          id: result.borrow.id,
          bookIsbn: result.borrow.book.isbn,
          bookTitle: result.borrow.book.title,
          borrowedAt: result.borrow.borrowedAt.toISOString(),
          dueAt: result.borrow.dueAt.toISOString(),
          status: result.borrow.status,
          priceCents: result.borrow.book.borrowPriceCents,
          priceFormatted: formatMoney(result.borrow.book.borrowPriceCents),
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
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isbn } = req.params;
      const userEmail = req.user!.email;

      const result = await returnBook(userEmail, isbn);

      const response = {
        borrow: {
          id: result.borrow.id,
          bookIsbn: result.borrow.book.isbn,
          bookTitle: result.borrow.book.title,
          borrowedAt: result.borrow.borrowedAt.toISOString(),
          dueAt: result.borrow.dueAt.toISOString(),
          returnedAt: result.borrow.returnedAt?.toISOString() || null,
          status: result.borrow.status,
          priceCents: result.borrow.book.borrowPriceCents,
          priceFormatted: formatMoney(result.borrow.book.borrowPriceCents),
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
