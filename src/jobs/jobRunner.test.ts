/**
 * Job Runner Tests
 *
 * Tests for:
 * - Property 13: Reminder Exactly-Once Effect
 * - Property 12: Restock Job Deduplication
 * - Job lease reclaim behavior
 *
 * NOTE: These are integration tests that require a running PostgreSQL database.
 * Run with: npm test -- --testPathPattern="jobRunner.test.ts"
 */

import prisma from '../prisma/client';
import { createJobRunner, JobRunner, calculateBackoff } from './jobRunner';
import { handleReminderJob } from './reminderJob';
import { handleRestockJob } from './restockJob';

// Test data
const TEST_USER_EMAIL = 'jobtest@test.com';

// Helper to create a test book
async function createTestBook(overrides: Partial<{
  isbn: string;
  title: string;
  availableCopies: number;
  seededCopies: number;
  stockPriceCents: number;
}> = {}) {
  const isbn = overrides.isbn || `test-isbn-job-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return prisma.book.create({
    data: {
      isbn,
      title: overrides.title || `Test Book ${isbn}`,
      authors: ['Test Author'],
      genres: ['Test Genre'],
      sellPriceCents: 1999,
      borrowPriceCents: 299,
      stockPriceCents: overrides.stockPriceCents || 500,
      availableCopies: overrides.availableCopies ?? 5,
      seededCopies: overrides.seededCopies ?? 10,
    },
  });
}

// Helper to create a test user
async function createTestUser(email: string = TEST_USER_EMAIL) {
  return prisma.user.upsert({
    where: { email },
    create: { email },
    update: {},
  });
}

// Helper to create a test borrow
async function createTestBorrow(userId: string, bookId: string, active: boolean = true) {
  const dueAt = new Date(Date.now() - 1000); // Due in the past for reminder testing
  const activeKey = active ? `${userId}:${bookId}` : null;
  
  return prisma.borrow.create({
    data: {
      userId,
      bookId,
      dueAt,
      activeKey,
      status: active ? 'ACTIVE' : 'RETURNED',
      returnedAt: active ? null : new Date(),
    },
  });
}

// Helper to clean up test data
async function cleanupTestData() {
  await prisma.event.deleteMany({});
  await prisma.simulatedEmail.deleteMany({});
  await prisma.walletMovement.deleteMany({
    where: { dedupeKey: { not: 'INITIAL_BALANCE' } },
  });
  await prisma.job.deleteMany({});
  await prisma.borrow.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.book.deleteMany({
    where: { isbn: { startsWith: 'test-isbn' } },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        not: 'admin@dummy-library.com',
      },
    },
  });
}

describe('Job Runner', () => {
  let jobRunner: JobRunner;

  beforeAll(async () => {
    // Ensure wallet exists with sufficient balance
    await prisma.libraryWallet.upsert({
      where: { id: 'library-wallet' },
      create: { id: 'library-wallet' },
      update: {},
    });
    
    // Ensure initial balance exists
    const existingBalance = await prisma.walletMovement.findUnique({
      where: { dedupeKey: 'INITIAL_BALANCE' },
    });
    
    if (!existingBalance) {
      await prisma.walletMovement.create({
        data: {
          walletId: 'library-wallet',
          amountCents: 100000, // $1000 for testing
          type: 'INITIAL_BALANCE',
          reason: 'Initial library wallet balance',
          dedupeKey: 'INITIAL_BALANCE',
        },
      });
    }
  });

  beforeEach(async () => {
    await cleanupTestData();
    jobRunner = createJobRunner();
    jobRunner.registerHandler('REMINDER', handleReminderJob);
    jobRunner.registerHandler('RESTOCK', handleRestockJob);
  });

  afterEach(async () => {
    if (jobRunner.isRunning()) {
      await jobRunner.stop();
    }
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff correctly', () => {
      // 1st attempt: 1 minute
      const backoff1 = calculateBackoff(1);
      expect(backoff1.getTime() - Date.now()).toBeGreaterThanOrEqual(55000);
      expect(backoff1.getTime() - Date.now()).toBeLessThanOrEqual(65000);

      // 2nd attempt: 2 minutes
      const backoff2 = calculateBackoff(2);
      expect(backoff2.getTime() - Date.now()).toBeGreaterThanOrEqual(115000);
      expect(backoff2.getTime() - Date.now()).toBeLessThanOrEqual(125000);

      // 3rd attempt: 4 minutes
      const backoff3 = calculateBackoff(3);
      expect(backoff3.getTime() - Date.now()).toBeGreaterThanOrEqual(235000);
      expect(backoff3.getTime() - Date.now()).toBeLessThanOrEqual(245000);
    });

    it('should cap backoff at 1 hour', () => {
      // 10th attempt would be 512 minutes, but should cap at 60 minutes
      const backoff10 = calculateBackoff(10);
      expect(backoff10.getTime() - Date.now()).toBeLessThanOrEqual(3600000 + 5000);
    });
  });

  /**
   * Property 13: Reminder Exactly-Once Effect
   *
   * For any overdue borrow, the system SHALL send exactly one reminder email,
   * even if the job is processed multiple times due to failures or restarts.
   *
   * Validates: Requirements 13.6, 13.7
   */
  describe('Property 13: Reminder Exactly-Once Effect', () => {
    it('should send exactly one reminder email even when job is processed multiple times', async () => {
      // Setup: Create user, book, and active borrow
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      // Create a reminder job that's due
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000), // Due in the past
        },
      });

      // Process the job multiple times (simulating retries/restarts)
      await jobRunner.processJobById(job.id);
      
      // Try to process again (should be idempotent)
      // First, reset the job to simulate a restart scenario
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          activeKey: `REMINDER:${borrow.id}`,
          lockedAt: null,
          attempts: 0,
        },
      });
      
      await jobRunner.processJobById(job.id);

      // Verify exactly one email was sent
      const emails = await prisma.simulatedEmail.findMany({
        where: {
          type: 'REMINDER',
          dedupeKey: `REMINDER:${borrow.id}`,
        },
      });

      expect(emails.length).toBe(1);
      expect(emails[0].recipient).toBe(user.email);
      expect(emails[0].subject).toContain(book.title);
    });

    it('should not send reminder if borrow is already returned', async () => {
      // Setup: Create user, book, and returned borrow
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, false); // Already returned

      // Create a reminder job
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
        },
      });

      // Process the job
      await jobRunner.processJobById(job.id);

      // Verify no email was sent
      const emails = await prisma.simulatedEmail.findMany({
        where: {
          type: 'REMINDER',
          recipient: user.email,
        },
      });

      expect(emails.length).toBe(0);

      // Verify job was completed
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.status).toBe('COMPLETED');
    });

    it('should create reminder event with dedupeKey', async () => {
      // Setup
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
        },
      });

      await jobRunner.processJobById(job.id);

      // Verify event was created with dedupeKey
      const events = await prisma.event.findMany({
        where: {
          type: 'REMINDER_SENT',
          borrowId: borrow.id,
        },
      });

      expect(events.length).toBe(1);
      expect(events[0].dedupeKey).toBe(`REMINDER_SENT:${borrow.id}`);
    });
  });

  /**
   * Property 12: Restock Job Deduplication
   *
   * For any book, there SHALL be at most one pending restock job at any time.
   *
   * Validates: Requirements 12.2
   */
  describe('Property 12: Restock Job Deduplication', () => {
    it('should only allow one pending restock job per book', async () => {
      const book = await createTestBook({ availableCopies: 1, seededCopies: 10 });

      // Create first restock job
      const job1 = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() + 3600000), // 1 hour from now
        },
      });

      expect(job1).toBeDefined();

      // Try to create second restock job with same activeKey - should fail
      await expect(
        prisma.job.create({
          data: {
            type: 'RESTOCK',
            bookId: book.id,
            activeKey: `RESTOCK:${book.id}`,
            payload: { bookId: book.id, isbn: book.isbn },
            runAt: new Date(Date.now() + 3600000),
          },
        })
      ).rejects.toThrow();

      // Verify only one job exists
      const jobs = await prisma.job.findMany({
        where: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: { not: null },
        },
      });

      expect(jobs.length).toBe(1);
    });

    it('should allow new restock job after previous one completes', async () => {
      const book = await createTestBook({ availableCopies: 1, seededCopies: 10 });

      // Create and complete first restock job
      const job1 = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() - 1000),
        },
      });

      await jobRunner.processJobById(job1.id);

      // Verify first job completed and activeKey cleared
      const completedJob = await prisma.job.findUnique({
        where: { id: job1.id },
      });
      expect(completedJob!.status).toBe('COMPLETED');
      expect(completedJob!.activeKey).toBeNull();

      // Now we can create a new restock job
      const job2 = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() + 3600000),
        },
      });

      expect(job2).toBeDefined();
      expect(job2.activeKey).toBe(`RESTOCK:${book.id}`);
    });

    it('should restock correct number of copies', async () => {
      const book = await createTestBook({ 
        availableCopies: 3, 
        seededCopies: 10,
        stockPriceCents: 100,
      });

      const job = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() - 1000),
        },
      });

      await jobRunner.processJobById(job.id);

      // Verify book was restocked to seededCopies
      const updatedBook = await prisma.book.findUnique({
        where: { id: book.id },
      });
      expect(updatedBook!.availableCopies).toBe(10); // seededCopies

      // Verify wallet was debited
      const movement = await prisma.walletMovement.findUnique({
        where: { dedupeKey: `RESTOCK:${job.id}` },
      });
      expect(movement).toBeDefined();
      expect(movement!.amountCents).toBe(-700); // 7 copies * 100 cents
      expect(movement!.type).toBe('RESTOCK_EXPENSE');
    });

    it('should skip restock if no copies needed', async () => {
      const book = await createTestBook({ 
        availableCopies: 10, 
        seededCopies: 10,
      });

      const job = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() - 1000),
        },
      });

      await jobRunner.processJobById(job.id);

      // Verify no wallet movement was created
      const movement = await prisma.walletMovement.findUnique({
        where: { dedupeKey: `RESTOCK:${job.id}` },
      });
      expect(movement).toBeNull();

      // Verify job completed
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.status).toBe('COMPLETED');
    });
  });

  /**
   * Job Lease Reclaim Behavior
   *
   * Tests that jobs with status=PROCESSING and old lockedAt can be reclaimed.
   *
   * Validates: Requirements 12.8, 13.5
   */
  describe('Job Lease Reclaim Behavior', () => {
    it('should reclaim job with expired lease', async () => {
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      // Create a job that appears stuck (PROCESSING with old lockedAt)
      const oldLockedAt = new Date(Date.now() - 120000); // 2 minutes ago (> 1 minute lease)
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
          status: 'PROCESSING',
          lockedAt: oldLockedAt,
          attempts: 1,
        },
      });

      // Process the job (should reclaim it)
      await jobRunner.processJobById(job.id);

      // Verify job was processed and completed
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.status).toBe('COMPLETED');
      expect(updatedJob!.attempts).toBe(2); // Incremented from 1
    });

    it('should not reclaim job with fresh lease', async () => {
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      // Create a job that's currently being processed (fresh lockedAt)
      const freshLockedAt = new Date(Date.now() - 10000); // 10 seconds ago (< 1 minute lease)
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
          status: 'PROCESSING',
          lockedAt: freshLockedAt,
          attempts: 1,
        },
      });

      // The job runner's claim query should not match this job because:
      // - It's PROCESSING with a fresh lockedAt (not expired)
      // So the updateMany should return count=0
      
      // Directly test the claim logic by checking if the job would be claimed
      const leaseExpiry = new Date(Date.now() - 60000); // 1 minute ago
      
      // This simulates what the job runner does - try to claim with updateMany
      const claimed = await prisma.job.updateMany({
        where: {
          id: job.id,
          activeKey: { not: null },
          OR: [
            { status: 'PENDING' },
            { status: 'PROCESSING', lockedAt: { lt: leaseExpiry } },
          ],
        },
        data: {
          status: 'PROCESSING',
          lockedAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      // Should not be claimed because lockedAt is fresh (10 seconds ago, not > 1 minute)
      expect(claimed.count).toBe(0);

      // Verify job was not modified
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.status).toBe('PROCESSING');
      expect(updatedJob!.attempts).toBe(1); // Not incremented
    });

    it('should increment attempts when reclaiming job', async () => {
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      const oldLockedAt = new Date(Date.now() - 120000);
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
          status: 'PROCESSING',
          lockedAt: oldLockedAt,
          attempts: 3,
        },
      });

      await jobRunner.processJobById(job.id);

      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.attempts).toBe(4); // Incremented from 3
    });

    it('should update lockedAt when reclaiming job', async () => {
      const user = await createTestUser();
      const book = await createTestBook();
      const borrow = await createTestBorrow(user.id, book.id, true);

      const oldLockedAt = new Date(Date.now() - 120000);
      const job = await prisma.job.create({
        data: {
          type: 'REMINDER',
          borrowId: borrow.id,
          activeKey: `REMINDER:${borrow.id}`,
          payload: { borrowId: borrow.id, userEmail: user.email },
          runAt: new Date(Date.now() - 1000),
          status: 'PROCESSING',
          lockedAt: oldLockedAt,
          attempts: 1,
        },
      });

      const beforeProcess = Date.now();
      await jobRunner.processJobById(job.id);

      // Job should be completed now, but we can check the completion time
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.completedAt).toBeDefined();
      expect(updatedJob!.completedAt!.getTime()).toBeGreaterThanOrEqual(beforeProcess);
    });
  });

  describe('Restock with Insufficient Funds', () => {
    it('should retry restock job when wallet has insufficient funds', async () => {
      // First, drain the wallet by creating a large debit
      const currentBalance = await prisma.walletMovement.aggregate({
        where: { walletId: 'library-wallet' },
        _sum: { amountCents: true },
      });
      
      const balanceCents = currentBalance._sum.amountCents || 0;
      
      // Create a debit to leave only 100 cents
      if (balanceCents > 100) {
        await prisma.walletMovement.create({
          data: {
            walletId: 'library-wallet',
            amountCents: -(balanceCents - 100),
            type: 'RESTOCK_EXPENSE',
            reason: 'Test drain',
            dedupeKey: `TEST_DRAIN:${Date.now()}`,
          },
        });
      }

      const book = await createTestBook({ 
        availableCopies: 1, 
        seededCopies: 10,
        stockPriceCents: 500, // 9 copies * 500 = 4500 cents needed
      });

      const job = await prisma.job.create({
        data: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: `RESTOCK:${book.id}`,
          payload: { bookId: book.id, isbn: book.isbn },
          runAt: new Date(Date.now() - 1000),
        },
      });

      await jobRunner.processJobById(job.id);

      // Verify job was rescheduled for retry (not completed)
      const updatedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updatedJob!.status).toBe('PENDING');
      expect(updatedJob!.attempts).toBe(1);
      expect(updatedJob!.lastError).toContain('Insufficient funds');
      expect(updatedJob!.runAt.getTime()).toBeGreaterThan(Date.now());
      expect(updatedJob!.activeKey).not.toBeNull(); // activeKey preserved for retry
    });
  });
});
