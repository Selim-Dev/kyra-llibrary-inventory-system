/**
 * Books Routes - Handles book search endpoints
 *
 * GET /api/books - Search books with filters and pagination
 */

import { Router } from 'express';
import { validate } from '../middleware';
import { searchBooksSchema } from '../schemas';
import { bookController } from '../controllers';

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
  bookController.searchBooks.bind(bookController)
);

export default router;
