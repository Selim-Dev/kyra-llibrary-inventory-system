/**
 * Borrow Service - Handles book borrowing and returning operations
 *
 * Key features:
 * - Single transaction with advisory lock per user for concurrency control
 * - Idempotent borrow (returns existing active borrow if exists)
 * - Enforces 3-borrow limit per user
 * - Atomic inventory decrement
 * - Creates wallet movements, events, and schedules reminder jobs
 * - Checks for low stock and wallet milestone
 */

import { Prisma, Borrow, Book } from '@prisma/client';
import prisma from '../prisma/client';
import { NotFoundError, ConflictError } from '../utils/errors';
import { reminderQueue, restockQueue } from '../queues';

// Constants
const MAX_ACTIVE_BORROWS = 3;
const BORROW_DURATION_DAYS = 3;
const LOW_STOCK_THRESHOLD = 1;
const WALLET_MILESTONE_CENTS = 200000; // $2000

export interface BorrowResult {
  borrow: Borrow & { book: Book };
  isExisting: boolean;
}

export interface ReturnResult {
  borrow: Borrow & { book: Book };
  isExisting: boolean; // True if returning already-returned borrow (idempotent)
}

/**
 * Hash a string to a 32-bit integer for use as advisory lock key
 */
function hashTextToInt(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Borrow a book for a user
 *
 * @param userEmail - The email of the user borrowing the book
 * @param bookIsbn - The ISBN of the book to borrow
 * @returns BorrowResult with the borrow record and whether it was existing
 */
export async function borrowBook(userEmail: string, bookIsbn: string): Promise<BorrowResult> {
  let shouldScheduleRestock = false;
  let restockBookData: { bookId: string; isbn: string; bookTitle: string } | null = null;

  // Single transaction with advisory lock inside
  const result = await prisma.$transaction(
    async (tx) => {
      // 0. Acquire advisory lock for this user (serializes concurrent requests)
      const lockKey = hashTextToInt(userEmail);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      // Get or create user
      const user = await tx.user.upsert({
        where: { email: userEmail },
        create: { email: userEmail },
        update: {},
      });

      // 1. Get book first to check if it exists
      const book = await tx.book.findUnique({
        where: { isbn: bookIsbn },
      });

      if (!book) {
        throw new NotFoundError('BOOK_NOT_FOUND', 'Book not found');
      }

      // 2. Check for existing active borrow (idempotency)
      const existingBorrow = await tx.borrow.findFirst({
        where: {
          userId: user.id,
          bookId: book.id,
          activeKey: { not: null },
        },
        include: { book: true },
      });

      if (existingBorrow) {
        return { borrow: existingBorrow, isExisting: true };
      }

      // 3. Check user's active borrow count
      const activeBorrows = await tx.borrow.count({
        where: { userId: user.id, activeKey: { not: null } },
      });

      if (activeBorrows >= MAX_ACTIVE_BORROWS) {
        throw new ConflictError('BORROW_LIMIT_EXCEEDED', 'Maximum 3 active borrows allowed');
      }

      // 4. Atomic decrement (prevents negative inventory)
      const updated = await tx.$executeRaw`
        UPDATE "Book" 
        SET "availableCopies" = "availableCopies" - 1,
            "updatedAt" = NOW()
        WHERE "isbn" = ${bookIsbn} AND "availableCopies" >= 1
      `;

      if (updated === 0) {
        throw new ConflictError('NO_COPIES_AVAILABLE', 'No copies available');
      }

      // 5. Create borrow record with activeKey for uniqueness
      const dueAt = new Date(Date.now() + BORROW_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const activeKey = `${user.id}:${book.id}`;

      const borrow = await tx.borrow.create({
        data: {
          userId: user.id,
          bookId: book.id,
          dueAt,
          activeKey,
          status: 'ACTIVE',
        },
        include: { book: true },
      });

      // 6. Credit wallet with dedupeKey
      await tx.walletMovement.create({
        data: {
          walletId: 'library-wallet',
          amountCents: book.borrowPriceCents,
          type: 'BORROW_INCOME',
          reason: `Borrow: ${book.title}`,
          relatedEntity: `borrow:${borrow.id}`,
          dedupeKey: `BORROW:${borrow.id}`,
        },
      });

      // 7. Record event with dedupeKey
      await tx.event.create({
        data: {
          type: 'BORROW',
          userId: user.id,
          bookId: book.id,
          borrowId: borrow.id,
          dedupeKey: `BORROW:${borrow.id}`,
        },
      });

      // 8. Check for low stock notification (at exactly 1 copy remaining)
      const updatedBook = await tx.book.findUnique({ where: { isbn: bookIsbn } });
      if (updatedBook && updatedBook.availableCopies === LOW_STOCK_THRESHOLD) {
        // Create low stock email
        const emailDedupeKey = `LOW_STOCK:${book.isbn}:${Date.now()}`;
        await tx.simulatedEmail.create({
          data: {
            recipient: 'supply@library.com',
            subject: `Low Stock Alert: ${book.title}`,
            body: `Book "${book.title}" (ISBN: ${book.isbn}) has only 1 copy remaining. A restock has been scheduled.`,
            type: 'LOW_STOCK',
            dedupeKey: emailDedupeKey,
          },
        });

        // Record low stock email event
        await tx.event.create({
          data: {
            type: 'LOW_STOCK_EMAIL',
            bookId: book.id,
            dedupeKey: `LOW_STOCK_EMAIL:${book.isbn}:${Date.now()}`,
          },
        });

        // Record restock scheduled event
        await tx.event.create({
          data: {
            type: 'RESTOCK_SCHEDULED',
            bookId: book.id,
            dedupeKey: `RESTOCK_SCHEDULED:${book.id}:${Date.now()}`,
          },
        });

        // Mark that we need to schedule restock after transaction
        shouldScheduleRestock = true;
        restockBookData = {
          bookId: book.id,
          isbn: book.isbn,
          bookTitle: book.title,
        };
      }

      // 9. Check wallet milestone
      await checkWalletMilestone(tx);

      return { borrow, isExisting: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );

  // Schedule jobs with BullMQ (after transaction commits)
  if (!result.isExisting) {
    // Schedule reminder job
    const delay = result.borrow.dueAt.getTime() - Date.now();
    await reminderQueue.add(
      'send-reminder',
      {
        borrowId: result.borrow.id,
        userEmail,
        bookTitle: result.borrow.book.title,
        dueAt: result.borrow.dueAt.toISOString(),
      },
      {
        delay: Math.max(0, delay),
        jobId: `reminder:${result.borrow.id}`, // Idempotency
      }
    );

    // Schedule restock job if needed
    if (shouldScheduleRestock && restockBookData) {
      const bookData = restockBookData as { bookId: string; isbn: string; bookTitle: string };
      await restockQueue.add(
        'restock-book',
        {
          bookId: bookData.bookId,
          isbn: bookData.isbn,
          bookTitle: bookData.bookTitle,
        },
        {
          delay: 60 * 60 * 1000, // 1 hour
          jobId: `restock:${bookData.bookId}:${Date.now()}`,
        }
      );
    }
  }

  return result;
}

/**
 * Check if wallet has reached the $2000 milestone and send notification
 */
async function checkWalletMilestone(tx: Prisma.TransactionClient): Promise<void> {
  // Get wallet
  const wallet = await tx.libraryWallet.findUnique({
    where: { id: 'library-wallet' },
  });

  if (!wallet || wallet.milestoneReached) {
    return; // Wallet doesn't exist or milestone already reached
  }

  // Calculate current balance
  const result = await tx.walletMovement.aggregate({
    where: { walletId: 'library-wallet' },
    _sum: { amountCents: true },
  });

  const balanceCents = result._sum.amountCents || 0;

  if (balanceCents > WALLET_MILESTONE_CENTS) {
    // Mark milestone as reached
    await tx.libraryWallet.update({
      where: { id: 'library-wallet' },
      data: { milestoneReached: true },
    });

    // Create milestone email
    const formattedBalance = (balanceCents / 100).toFixed(2);
    await tx.simulatedEmail.create({
      data: {
        recipient: 'management@dummy-library.com',
        subject: 'Wallet Milestone Reached: $2000!',
        body: `Congratulations! The library wallet has exceeded $2000. Current balance: $${formattedBalance}`,
        type: 'MILESTONE',
        dedupeKey: 'MILESTONE:2000',
      },
    });

    // Record milestone event
    await tx.event.create({
      data: {
        type: 'MILESTONE_EMAIL',
        metadata: { balanceCents },
        dedupeKey: 'MILESTONE_EMAIL:2000',
      },
    });
  }
}

/**
 * Return a borrowed book
 *
 * @param userEmail - The email of the user returning the book
 * @param bookIsbn - The ISBN of the book to return
 * @returns ReturnResult with the borrow record and whether it was already returned
 */
export async function returnBook(userEmail: string, bookIsbn: string): Promise<ReturnResult> {
  // Single transaction with advisory lock inside
  const result = await prisma.$transaction(
    async (tx) => {
      // 0. Acquire advisory lock for this user (serializes concurrent requests)
      const lockKey = hashTextToInt(userEmail);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      // Get user
      const user = await tx.user.findUnique({
        where: { email: userEmail },
      });

      if (!user) {
        throw new NotFoundError('BORROW_NOT_FOUND', 'Active borrow not found');
      }

      // Get book
      const book = await tx.book.findUnique({
        where: { isbn: bookIsbn },
      });

      if (!book) {
        throw new NotFoundError('BOOK_NOT_FOUND', 'Book not found');
      }

      // 1. Check for existing active borrow
      const activeBorrow = await tx.borrow.findFirst({
        where: {
          userId: user.id,
          bookId: book.id,
          activeKey: { not: null },
        },
        include: { book: true },
      });

      // 2. If no active borrow, check if there's a returned borrow (idempotency)
      if (!activeBorrow) {
        // Look for the most recent returned borrow for this user/book
        const returnedBorrow = await tx.borrow.findFirst({
          where: {
            userId: user.id,
            bookId: book.id,
            status: 'RETURNED',
          },
          orderBy: { returnedAt: 'desc' },
          include: { book: true },
        });

        if (returnedBorrow) {
          // Already returned - return idempotent response
          return { borrow: returnedBorrow, isExisting: true };
        }

        // No borrow found at all
        throw new NotFoundError('BORROW_NOT_FOUND', 'Active borrow not found');
      }

      // 3. Update borrow record: set activeKey = null, returnedAt, status = RETURNED
      const returnedAt = new Date();
      const updatedBorrow = await tx.borrow.update({
        where: { id: activeBorrow.id },
        data: {
          activeKey: null,
          returnedAt,
          status: 'RETURNED',
        },
        include: { book: true },
      });

      // 4. Increment inventory
      await tx.$executeRaw`
        UPDATE "Book" 
        SET "availableCopies" = "availableCopies" + 1,
            "updatedAt" = NOW()
        WHERE "isbn" = ${bookIsbn}
      `;

      // 5. Record event with dedupeKey
      await tx.event.create({
        data: {
          type: 'RETURN',
          userId: user.id,
          bookId: book.id,
          borrowId: activeBorrow.id,
          dedupeKey: `RETURN:${activeBorrow.id}`,
        },
      });

      return { borrow: updatedBorrow, isExisting: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );

  // Remove reminder job from BullMQ (after transaction commits)
  if (!result.isExisting) {
    try {
      const job = await reminderQueue.getJob(`reminder:${result.borrow.id}`);
      if (job) {
        await job.remove();
        console.log(`Removed reminder job for borrow ${result.borrow.id}`);
      }
    } catch (error) {
      // Job might not exist or already processed - that's okay
      console.log(`Could not remove reminder job for borrow ${result.borrow.id}:`, error);
    }
  }

  return result;
}

export default {
  borrowBook,
  returnBook,
};
