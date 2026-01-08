/**
 * Borrow Controller - Handles book borrowing and returning HTTP requests
 */

import { Request, Response, NextFunction } from 'express';
import { borrowBook, returnBook } from '../services/borrowService';
import { formatMoney } from '../utils/money';

export class BorrowController {
  /**
   * Borrow a book by ISBN
   */
  async borrowBook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
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

  /**
   * Return a borrowed book by ISBN
   */
  async returnBook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
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
}

export const borrowController = new BorrowController();
