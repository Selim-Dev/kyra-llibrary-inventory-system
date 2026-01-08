/**
 * Book Controller - Handles book-related HTTP requests
 */

import { Request, Response, NextFunction } from 'express';
import { searchBooks } from '../services/bookService';

export class BookController {
  /**
   * Search books with filters and pagination
   */
  async searchBooks(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { title, author, genre, page, pageSize } = req.query;

      const result = await searchBooks({
        title: title as string | undefined,
        author: author as string | undefined,
        genre: genre as string | undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const bookController = new BookController();
