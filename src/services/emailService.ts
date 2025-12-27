/**
 * Email Service - Handles simulated email operations
 *
 * Key features:
 * - getEmails() - Get simulated emails with filters and pagination
 * - createEmail() - Create a simulated email with dedupeKey for idempotency
 *
 * Requirements: 15.1-15.4
 */

import { SimulatedEmail, EmailType, Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import {
  parsePaginationParams,
  calculateSkip,
  createPaginatedResponse,
} from '../utils/pagination';
import { PaginatedResponse } from '../types';

/**
 * Filters for querying emails
 */
export interface EmailFilters {
  recipient?: string;
  type?: EmailType;
  page?: string;
  pageSize?: string;
}

/**
 * Email response
 */
export interface EmailResponse {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  type: EmailType;
  createdAt: Date;
}

/**
 * Get simulated emails with optional filters and pagination.
 *
 * Supports:
 * - recipient: filter by recipient email
 * - type: filter by email type
 *
 * Requirements: 15.1-15.4
 *
 * @param filters - Optional filters for recipient, type, and pagination
 * @returns Paginated list of emails
 */
export async function getEmails(
  filters: EmailFilters = {}
): Promise<PaginatedResponse<EmailResponse>> {
  const { page, pageSize } = parsePaginationParams({
    page: filters.page,
    pageSize: filters.pageSize,
  });

  // Build where clause
  const where: Prisma.SimulatedEmailWhereInput = {};

  // Filter by recipient
  if (filters.recipient) {
    where.recipient = filters.recipient;
  }

  // Filter by email type
  if (filters.type) {
    where.type = filters.type;
  }

  // Get total count
  const total = await prisma.simulatedEmail.count({ where });

  // Get emails with pagination
  const emails = await prisma.simulatedEmail.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: calculateSkip(page, pageSize),
    take: pageSize,
  });

  // Format emails for response
  const formattedEmails: EmailResponse[] = emails.map((email) => ({
    id: email.id,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    type: email.type,
    createdAt: email.createdAt,
  }));

  return createPaginatedResponse(formattedEmails, total, page, pageSize);
}

/**
 * Create a simulated email with dedupeKey for idempotency.
 *
 * @param data - Email data
 * @returns The created email
 */
export async function createEmail(data: {
  recipient: string;
  subject: string;
  body: string;
  type: EmailType;
  dedupeKey: string;
}): Promise<SimulatedEmail> {
  // Check for existing email first
  const existing = await prisma.simulatedEmail.findUnique({
    where: { dedupeKey: data.dedupeKey },
  });

  if (existing) {
    return existing;
  }

  try {
    return await prisma.simulatedEmail.create({
      data: {
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        type: data.type,
        dedupeKey: data.dedupeKey,
      },
    });
  } catch (error) {
    // Handle unique constraint violation for concurrent requests with same dedupeKey
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      const existing = await prisma.simulatedEmail.findUnique({
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
 * Create a simulated email within a transaction context.
 *
 * @param tx - Prisma transaction client
 * @param data - Email data
 * @returns The created email
 */
export async function createEmailInTransaction(
  tx: Prisma.TransactionClient,
  data: {
    recipient: string;
    subject: string;
    body: string;
    type: EmailType;
    dedupeKey: string;
  }
): Promise<SimulatedEmail> {
  // Check for existing email first
  const existing = await tx.simulatedEmail.findUnique({
    where: { dedupeKey: data.dedupeKey },
  });

  if (existing) {
    return existing;
  }

  try {
    return await tx.simulatedEmail.create({
      data: {
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        type: data.type,
        dedupeKey: data.dedupeKey,
      },
    });
  } catch (error) {
    // Handle unique constraint violation for concurrent requests with same dedupeKey
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      const existing = await tx.simulatedEmail.findUnique({
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
  getEmails,
  createEmail,
  createEmailInTransaction,
};
