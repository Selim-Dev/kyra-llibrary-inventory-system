/**
 * User Service - Handles user-related operations
 *
 * Key features:
 * - getUserHistory() - Get user's borrowing and buying history with summary stats
 */

import { BorrowStatus, PurchaseStatus } from '@prisma/client';
import prisma from '../prisma/client';
import { formatMoney } from '../utils/money';
import { NotFoundError } from '../utils/errors';

/**
 * Borrow history item
 */
export interface BorrowHistoryItem {
  id: string;
  bookIsbn: string;
  bookTitle: string;
  borrowedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  status: BorrowStatus;
  priceCents: number;
  priceFormatted: string;
}

/**
 * Purchase history item
 */
export interface PurchaseHistoryItem {
  id: string;
  bookIsbn: string;
  bookTitle: string;
  purchasedAt: Date;
  canceledAt: Date | null;
  status: PurchaseStatus;
  priceCents: number;
  priceFormatted: string;
}

/**
 * User history summary statistics
 */
export interface UserHistorySummary {
  totalBorrows: number;
  activeBorrows: number;
  returnedBorrows: number;
  totalPurchases: number;
  activePurchases: number;
  canceledPurchases: number;
}

/**
 * Complete user history response
 */
export interface UserHistoryResponse {
  user: {
    id: string;
    email: string;
    createdAt: Date;
  };
  borrows: BorrowHistoryItem[];
  purchases: PurchaseHistoryItem[];
  summary: UserHistorySummary;
}

/**
 * Get a user's complete borrowing and buying history with summary statistics.
 *
 * @param email - User's email address
 * @returns User history with borrows, purchases, and summary stats
 * @throws NotFoundError if user not found
 */
export async function getUserHistory(email: string): Promise<UserHistoryResponse> {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      borrows: {
        include: {
          book: true,
        },
        orderBy: { borrowedAt: 'desc' },
      },
      purchases: {
        include: {
          book: true,
        },
        orderBy: { purchasedAt: 'desc' },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('USER_NOT_FOUND', `User with email ${email} not found`);
  }

  // Format borrows
  const borrows: BorrowHistoryItem[] = user.borrows.map((borrow) => ({
    id: borrow.id,
    bookIsbn: borrow.book.isbn,
    bookTitle: borrow.book.title,
    borrowedAt: borrow.borrowedAt,
    dueAt: borrow.dueAt,
    returnedAt: borrow.returnedAt,
    status: borrow.status,
    priceCents: borrow.book.borrowPriceCents,
    priceFormatted: formatMoney(borrow.book.borrowPriceCents),
  }));

  // Format purchases
  const purchases: PurchaseHistoryItem[] = user.purchases.map((purchase) => ({
    id: purchase.id,
    bookIsbn: purchase.book.isbn,
    bookTitle: purchase.book.title,
    purchasedAt: purchase.purchasedAt,
    canceledAt: purchase.canceledAt,
    status: purchase.status,
    priceCents: purchase.priceCents,
    priceFormatted: formatMoney(purchase.priceCents),
  }));

  // Calculate summary statistics
  const activeBorrows = borrows.filter((b) => b.status === 'ACTIVE').length;
  const returnedBorrows = borrows.filter((b) => b.status === 'RETURNED').length;
  const activePurchases = purchases.filter((p) => p.status === 'ACTIVE').length;
  const canceledPurchases = purchases.filter((p) => p.status === 'CANCELED').length;

  const summary: UserHistorySummary = {
    totalBorrows: borrows.length,
    activeBorrows,
    returnedBorrows,
    totalPurchases: purchases.length,
    activePurchases,
    canceledPurchases,
  };

  return {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
    borrows,
    purchases,
    summary,
  };
}

export default {
  getUserHistory,
};
