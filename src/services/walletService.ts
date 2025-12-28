/**
 * Wallet Service - Handles library wallet operations
 *
 * Key features:
 * - getBalance() - Calculate balance from SUM of all movements
 * - addMovement() - Add a wallet movement with dedupeKey for idempotency
 * - getMovements() - Get movements with filters and pagination
 */

import { MovementType, WalletMovement, Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { formatMoney } from '../utils/money';
import {
  parsePaginationParams,
  calculateSkip,
  createPaginatedResponse,
} from '../utils/pagination';
import { PaginatedResponse } from '../types';

// Constants
const WALLET_ID = 'library-wallet';

/**
 * Wallet balance response format
 */
export interface WalletBalance {
  balanceCents: number;
  balanceFormatted: string;
}

/**
 * Movement data for creating a new movement
 */
export interface MovementData {
  amountCents: number;
  type: MovementType;
  reason: string;
  relatedEntity?: string;
  dedupeKey?: string;
}

/**
 * Filters for querying movements
 */
export interface MovementFilters {
  type?: 'credit' | 'debit';
  movementType?: MovementType;
  startDate?: Date;
  endDate?: Date;
  page?: string;
  pageSize?: string;
}

/**
 * Movement response with formatted amount
 */
export interface MovementResponse {
  id: string;
  amountCents: number;
  amountFormatted: string;
  type: MovementType;
  reason: string;
  relatedEntity: string | null;
  createdAt: Date;
}

/**
 * Get the current wallet balance by summing all movements.
 * The balance is always derivable from the sum of all movements.
 *
 * @returns WalletBalance with cents and formatted string
 */
export async function getBalance(): Promise<WalletBalance> {
  const result = await prisma.walletMovement.aggregate({
    where: { walletId: WALLET_ID },
    _sum: { amountCents: true },
  });

  const balanceCents = result._sum.amountCents || 0;

  return {
    balanceCents,
    balanceFormatted: formatMoney(balanceCents),
  };
}

/**
 * Add a wallet movement with optional dedupeKey for idempotency.
 * If a dedupeKey is provided and already exists, the operation is skipped
 * (returns the existing movement).
 *
 * @param data - Movement data including amount, type, reason, and optional dedupeKey
 * @returns The created or existing WalletMovement
 */
export async function addMovement(data: MovementData): Promise<WalletMovement> {
  // If dedupeKey is provided, check for existing movement first
  if (data.dedupeKey) {
    const existing = await prisma.walletMovement.findUnique({
      where: { dedupeKey: data.dedupeKey },
    });

    if (existing) {
      return existing;
    }
  }

  // Create the movement, handling concurrent duplicate requests
  try {
    return await prisma.walletMovement.create({
      data: {
        walletId: WALLET_ID,
        amountCents: data.amountCents,
        type: data.type,
        reason: data.reason,
        relatedEntity: data.relatedEntity,
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
      const existing = await prisma.walletMovement.findUnique({
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
 * Add a wallet movement within a transaction context.
 * Used when the movement needs to be part of a larger transaction.
 *
 * @param tx - Prisma transaction client
 * @param data - Movement data
 * @returns The created WalletMovement
 */
export async function addMovementInTransaction(
  tx: Prisma.TransactionClient,
  data: MovementData
): Promise<WalletMovement> {
  // If dedupeKey is provided, check for existing movement first
  if (data.dedupeKey) {
    const existing = await tx.walletMovement.findUnique({
      where: { dedupeKey: data.dedupeKey },
    });

    if (existing) {
      return existing;
    }
  }

  // Create the movement, handling concurrent duplicate requests
  try {
    return await tx.walletMovement.create({
      data: {
        walletId: WALLET_ID,
        amountCents: data.amountCents,
        type: data.type,
        reason: data.reason,
        relatedEntity: data.relatedEntity,
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
      const existing = await tx.walletMovement.findUnique({
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
 * Get wallet movements with optional filters and pagination.
 *
 * @param filters - Optional filters for type, date range, and pagination
 * @returns Paginated list of movements with formatted amounts
 */
export async function getMovements(
  filters: MovementFilters = {}
): Promise<PaginatedResponse<MovementResponse>> {
  const { page, pageSize } = parsePaginationParams({
    page: filters.page,
    pageSize: filters.pageSize,
  });

  // Build where clause
  const where: Prisma.WalletMovementWhereInput = {
    walletId: WALLET_ID,
  };

  // Filter by credit/debit (based on sign of amountCents)
  if (filters.type === 'credit') {
    where.amountCents = { gt: 0 };
  } else if (filters.type === 'debit') {
    where.amountCents = { lt: 0 };
  }

  // Filter by specific movement type
  if (filters.movementType) {
    where.type = filters.movementType;
  }

  // Filter by date range
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt.gte = filters.startDate;
    }
    if (filters.endDate) {
      where.createdAt.lte = filters.endDate;
    }
  }

  // Get total count
  const total = await prisma.walletMovement.count({ where });

  // Get movements with pagination
  const movements = await prisma.walletMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: calculateSkip(page, pageSize),
    take: pageSize,
  });

  // Format movements for response
  const formattedMovements: MovementResponse[] = movements.map((m) => ({
    id: m.id,
    amountCents: m.amountCents,
    amountFormatted: formatMoney(m.amountCents),
    type: m.type,
    reason: m.reason,
    relatedEntity: m.relatedEntity,
    createdAt: m.createdAt,
  }));

  return createPaginatedResponse(formattedMovements, total, page, pageSize);
}

/**
 * Get the wallet balance within a transaction context.
 * Used when balance check needs to be part of a larger transaction.
 *
 * @param tx - Prisma transaction client
 * @returns WalletBalance with cents and formatted string
 */
export async function getBalanceInTransaction(
  tx: Prisma.TransactionClient
): Promise<WalletBalance> {
  const result = await tx.walletMovement.aggregate({
    where: { walletId: WALLET_ID },
    _sum: { amountCents: true },
  });

  const balanceCents = result._sum.amountCents || 0;

  return {
    balanceCents,
    balanceFormatted: formatMoney(balanceCents),
  };
}

export default {
  getBalance,
  addMovement,
  addMovementInTransaction,
  getMovements,
  getBalanceInTransaction,
};
