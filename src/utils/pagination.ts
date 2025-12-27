import { PaginationParams, PaginationMeta, PaginatedResponse } from '../types';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/**
 * Parse pagination parameters from query string.
 * Provides defaults and validates bounds.
 *
 * Requirements: 19.4
 */
export function parsePaginationParams(query: {
  page?: string;
  pageSize?: string;
}): PaginationParams {
  let page = parseInt(query.page || '', 10);
  let pageSize = parseInt(query.pageSize || '', 10);

  // Apply defaults and bounds
  if (isNaN(page) || page < 1) {
    page = DEFAULT_PAGE;
  }

  if (isNaN(pageSize) || pageSize < 1) {
    pageSize = DEFAULT_PAGE_SIZE;
  }

  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE;
  }

  return { page, pageSize };
}

/**
 * Calculate pagination metadata.
 *
 * Requirements: 19.4
 */
export function calculatePaginationMeta(
  total: number,
  page: number,
  pageSize: number
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);

  return {
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Calculate skip value for database queries.
 */
export function calculateSkip(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Create a paginated response object.
 *
 * Requirements: 19.4
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  return {
    data,
    pagination: calculatePaginationMeta(total, page, pageSize),
  };
}
