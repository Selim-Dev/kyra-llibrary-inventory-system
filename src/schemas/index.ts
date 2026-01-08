/**
 * Validation Schemas - Zod schemas for request validation
 */

import { z } from 'zod';
import { EventType, EmailType } from '@prisma/client';

// Common schemas
const uuidSchema = z.string().uuid('Must be a valid UUID');
const emailSchema = z.string().email('Must be a valid email address');
const pageSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1));
const pageSizeSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100));

// Book routes schemas
export const borrowBookSchema = z.object({
  params: z.object({
    isbn: uuidSchema,
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const returnBookSchema = z.object({
  params: z.object({
    isbn: uuidSchema,
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const buyBookSchema = z.object({
  params: z.object({
    isbn: uuidSchema,
  }),
  headers: z.object({
    'x-user-email': emailSchema,
    'x-idempotency-key': z.string().min(1).max(255),
  }),
});

export const cancelPurchaseSchema = z.object({
  params: z.object({
    id: uuidSchema,
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const searchBooksSchema = z.object({
  query: z.object({
    title: z.string().max(255).optional(),
    author: z.string().max(255).optional(),
    genre: z.string().max(100).optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  }),
});

// Admin routes schemas
export const getEventsSchema = z.object({
  query: z.object({
    userEmail: emailSchema.optional(),
    bookIsbn: uuidSchema.optional(),
    type: z.nativeEnum(EventType).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const getWalletMovementsSchema = z.object({
  query: z.object({
    type: z.enum(['credit', 'debit']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const getEmailsSchema = z.object({
  query: z.object({
    recipient: emailSchema.optional(),
    type: z.nativeEnum(EmailType).optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});

export const getUserHistorySchema = z.object({
  params: z.object({
    email: emailSchema,
  }),
  headers: z.object({
    'x-user-email': emailSchema,
  }),
});
