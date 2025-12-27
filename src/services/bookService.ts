/**
 * Book Service - Handles book search and retrieval operations
 *
 * Key features:
 * - searchBooks() - Search books with filters and pagination
 *
 * Requirements: 7.1-7.5
 */

import { Book, Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { formatMoney } from '../utils/money';
import {
  parsePaginationParams,
  calculateSkip,
  createPaginatedResponse,
} from '../utils/pagination';
import { PaginatedResponse } from '../types';

/**
 * Filters for searching books
 */
export interface BookSearchFilters {
  title?: string;
  author?: string;
  genre?: string;
  page?: string;
  pageSize?: string;
}

/**
 * Book response with formatted prices
 */
export interface BookResponse {
  id: string;
  isbn: string;
  title: string;
  authors: string[];
  genres: string[];
  sellPriceCents: number;
  sellPriceFormatted: string;
  borrowPriceCents: number;
  borrowPriceFormatted: string;
  stockPriceCents: number;
  stockPriceFormatted: string;
  availableCopies: number;
  seededCopies: number;
  year: number | null;
  pages: number | null;
  publisher: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Format a book for API response with formatted prices
 */
function formatBookResponse(book: Book): BookResponse {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    authors: book.authors,
    genres: book.genres,
    sellPriceCents: book.sellPriceCents,
    sellPriceFormatted: formatMoney(book.sellPriceCents),
    borrowPriceCents: book.borrowPriceCents,
    borrowPriceFormatted: formatMoney(book.borrowPriceCents),
    stockPriceCents: book.stockPriceCents,
    stockPriceFormatted: formatMoney(book.stockPriceCents),
    availableCopies: book.availableCopies,
    seededCopies: book.seededCopies,
    year: book.year,
    pages: book.pages,
    publisher: book.publisher,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

/**
 * Search books with optional filters and pagination.
 * 
 * Supports:
 * - title: partial match, case-insensitive (ILIKE)
 * - author: partial match, case-insensitive (raw SQL unnest + ILIKE)
 * - genre: exact match
 *
 * Requirements: 7.1-7.5
 *
 * @param filters - Optional filters for title, author, genre, and pagination
 * @returns Paginated list of books with formatted prices
 */
export async function searchBooks(
  filters: BookSearchFilters = {}
): Promise<PaginatedResponse<BookResponse>> {
  const { page, pageSize } = parsePaginationParams({
    page: filters.page,
    pageSize: filters.pageSize,
  });

  // Build where clause for Prisma
  const where: Prisma.BookWhereInput = {};

  // Filter by title (partial match, case-insensitive)
  if (filters.title) {
    where.title = {
      contains: filters.title,
      mode: 'insensitive',
    };
  }

  // Filter by genre (exact match in array)
  if (filters.genre) {
    where.genres = {
      has: filters.genre,
    };
  }

  // For author search, we need to use raw SQL with unnest + ILIKE
  // because Prisma doesn't support case-insensitive array element search
  if (filters.author) {
    // Use raw query to find book IDs matching author filter
    const authorPattern = `%${filters.author}%`;
    const matchingBookIds = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT b.id
      FROM "Book" b, unnest(b.authors) AS author
      WHERE author ILIKE ${authorPattern}
    `;

    if (matchingBookIds.length === 0) {
      // No books match the author filter
      return createPaginatedResponse([], 0, page, pageSize);
    }

    where.id = {
      in: matchingBookIds.map((b) => b.id),
    };
  }

  // Get total count
  const total = await prisma.book.count({ where });

  // Get books with pagination
  const books = await prisma.book.findMany({
    where,
    orderBy: { title: 'asc' },
    skip: calculateSkip(page, pageSize),
    take: pageSize,
  });

  // Format books for response
  const formattedBooks = books.map(formatBookResponse);

  return createPaginatedResponse(formattedBooks, total, page, pageSize);
}

/**
 * Get a single book by ISBN
 *
 * @param isbn - Book ISBN
 * @returns Book or null if not found
 */
export async function getBookByIsbn(isbn: string): Promise<BookResponse | null> {
  const book = await prisma.book.findUnique({
    where: { isbn },
  });

  if (!book) {
    return null;
  }

  return formatBookResponse(book);
}

export default {
  searchBooks,
  getBookByIsbn,
};
