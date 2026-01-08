/**
 * Buy Controller - Handles book purchasing and cancellation HTTP requests
 */

import { Request, Response, NextFunction } from 'express';
import { buyBook, cancelPurchase } from '../services/buyService';
import { formatMoney } from '../utils/money';

export class BuyController {
  /**
   * Buy a book by ISBN
   */
  async buyBook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
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

  /**
   * Cancel a purchase by ID
   */
  async cancelPurchase(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
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
}

export const buyController = new BuyController();
