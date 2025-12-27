/**
 * Event Service - Handles event logging and retrieval
 *
 * Key features:
 * - getEvents() - Get events with filters and pagination
 * - createEvent() - Create a new event with dedupeKey for idempotency
 *
 * Requirements: 8.1-8.7
 */

import { Event, EventType, Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import {
  parsePaginationParams,
  calculateSkip,
  createPaginatedResponse,
} from '../utils/pagination';
import { PaginatedResponse } from '../types';

/**
 * Filters for querying events
 */
export interface EventFilters {
  userEmail?: string;
  bookIsbn?: string;
  type?: EventType;
  startDate?: string;
  endDate?: string;
  page?: string;
  pageSize?: string;
}

/**
 * Event response with related entity info
 */
export interface EventResponse {
  id: string;
  type: EventType;
  userId: string | null;
  userEmail: string | null;
  bookId: string | null;
  bookIsbn: string | null;
  bookTitle: string | null;
  borrowId: string | null;
  purchaseId: string | null;
  jobId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

/**
 * Get events with optional filters and pagination.
 *
 * Supports:
 * - userEmail: filter by user email
 * - bookIsbn: filter by book ISBN
 * - type: filter by event type
 * - startDate/endDate: filter by date range
 *
 * Requirements: 8.1-8.7
 *
 * @param filters - Optional filters for user, book, type, date range, and pagination
 * @returns Paginated list of events
 */
export async function getEvents(
  filters: EventFilters = {}
): Promise<PaginatedResponse<EventResponse>> {
  const { page, pageSize } = parsePaginationParams({
    page: filters.page,
    pageSize: filters.pageSize,
  });

  // Build where clause
  const where: Prisma.EventWhereInput = {};

  // Filter by user email
  if (filters.userEmail) {
    const user = await prisma.user.findUnique({
      where: { email: filters.userEmail },
    });
    if (user) {
      where.userId = user.id;
    } else {
      // No user found, return empty result
      return createPaginatedResponse([], 0, page, pageSize);
    }
  }

  // Filter by book ISBN
  if (filters.bookIsbn) {
    const book = await prisma.book.findUnique({
      where: { isbn: filters.bookIsbn },
    });
    if (book) {
      where.bookId = book.id;
    } else {
      // No book found, return empty result
      return createPaginatedResponse([], 0, page, pageSize);
    }
  }

  // Filter by event type
  if (filters.type) {
    where.type = filters.type;
  }

  // Filter by date range
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.createdAt.lte = new Date(filters.endDate);
    }
  }

  // Get total count
  const total = await prisma.event.count({ where });

  // Get events with pagination and related entities
  const events = await prisma.event.findMany({
    where,
    include: {
      user: true,
      book: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: calculateSkip(page, pageSize),
    take: pageSize,
  });

  // Format events for response
  const formattedEvents: EventResponse[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    userId: event.userId,
    userEmail: event.user?.email || null,
    bookId: event.bookId,
    bookIsbn: event.book?.isbn || null,
    bookTitle: event.book?.title || null,
    borrowId: event.borrowId,
    purchaseId: event.purchaseId,
    jobId: event.jobId,
    metadata: event.metadata,
    createdAt: event.createdAt,
  }));

  return createPaginatedResponse(formattedEvents, total, page, pageSize);
}

/**
 * Create an event with optional dedupeKey for idempotency.
 *
 * @param data - Event data
 * @returns The created event
 */
export async function createEvent(data: {
  type: EventType;
  userId?: string;
  bookId?: string;
  borrowId?: string;
  purchaseId?: string;
  jobId?: string;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
}): Promise<Event> {
  // If dedupeKey is provided, check for existing event first
  if (data.dedupeKey) {
    const existing = await prisma.event.findUnique({
      where: { dedupeKey: data.dedupeKey },
    });

    if (existing) {
      return existing;
    }
  }

  try {
    return await prisma.event.create({
      data: {
        type: data.type,
        userId: data.userId,
        bookId: data.bookId,
        borrowId: data.borrowId,
        purchaseId: data.purchaseId,
        jobId: data.jobId,
        metadata: data.metadata,
        dedupeKey: data.dedupeKey,
      },
    });
  } catch (error) {
    // Handle unique constraint violation for concurrent requests with same dedupeKey
    if (
      data.dedupeKey &&
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      const existing = await prisma.event.findUnique({
        where: { dedupeKey: data.dedupeKey },
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Create an event within a transaction context.
 *
 * @param tx - Prisma transaction client
 * @param data - Event data
 * @returns The created event
 */
export async function createEventInTransaction(
  tx: Prisma.TransactionClient,
  data: {
    type: EventType;
    userId?: string;
    bookId?: string;
    borrowId?: string;
    purchaseId?: string;
    jobId?: string;
    metadata?: Prisma.InputJsonValue;
    dedupeKey?: string;
  }
): Promise<Event> {
  // If dedupeKey is provided, check for existing event first
  if (data.dedupeKey) {
    const existing = await tx.event.findUnique({
      where: { dedupeKey: data.dedupeKey },
    });

    if (existing) {
      return existing;
    }
  }

  try {
    return await tx.event.create({
      data: {
        type: data.type,
        userId: data.userId,
        bookId: data.bookId,
        borrowId: data.borrowId,
        purchaseId: data.purchaseId,
        jobId: data.jobId,
        metadata: data.metadata,
        dedupeKey: data.dedupeKey,
      },
    });
  } catch (error) {
    // Handle unique constraint violation for concurrent requests with same dedupeKey
    if (
      data.dedupeKey &&
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      const existing = await tx.event.findUnique({
        where: { dedupeKey: data.dedupeKey },
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

export default {
  getEvents,
  createEvent,
  createEventInTransaction,
};
