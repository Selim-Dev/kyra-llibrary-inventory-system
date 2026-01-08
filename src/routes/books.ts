/**
 * Books Routes - Handles book search endpoints
 *
 * GET /api/books - Search books with filters and pagination
 */

import { Router, Request, Response, NextFunction } from 'express';
import { searchBooks } from '../services/bookService';
import { validate } from '../middleware';
import { searchBooksSchema } from '../schemas';

const router = Router();

/**
 * GET /api/books
 *
 * Search books with optional filters and pagination.
 *
 * Query Parameters:
 * - title: Filter by title (partial match, case-insensitive)
 * - author: Filter by author (partial match, case-insensitive)
 * - genre: Filter by genre (exact match)
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 10, max: 100)
 *
 * Response:
 * - 200: Paginated list of books
 */
router.get(
  '/',
  validate(searchBooksSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
);

export default router;
