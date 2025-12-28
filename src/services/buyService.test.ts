/**
 * Buy Service Tests
 *
 * Tests for:
 * - Property 5: Buy Limit Enforcement Under Concurrency
 * - Property 6: Buy Idempotency via Key
 * - Property 7: Cancel Idempotency
 * - Property 8: Canceled Purchases Excluded from Limits
 *
 * NOTE: These are integration tests that require a running PostgreSQL database.
 * Run with: npm test -- --testPathPattern="buyService.test.ts"
 * Ensure DATABASE_URL is set in .env and the database is running.
 */

import request from 'supertest';
import app from '../app';
import prisma from '../prisma/client';

// Test data
const TEST_USER_EMAIL = 'buytest@test.com';
const TEST_ADMIN_EMAIL = 'admin@dummy-library.com';

// Helper to create a test book
async function createTestBook(overrides: Partial<{
  isbn: string;
  title: string;
  availableCopies: number;
  sellPriceCents: number;
}> = {}) {
  const isbn = overrides.isbn || `buy-test-isbn-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return prisma.book.create({
    data: {
      isbn,
      title: overrides.title || `Test Book ${isbn}`,
      authors: ['Test Author'],
      genres: ['Test Genre'],
      sellPriceCents: overrides.sellPriceCents || 1999,
      borrowPriceCents: 299,
      stockPriceCents: 999,
      availableCopies: overrides.availableCopies ?? 10,
      seededCopies: overrides.availableCopies ?? 10,
    },
  });
}

// Helper to generate unique idempotency key
function generateIdempotencyKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

// Helper to clean up test data
async function cleanupTestData() {
  // Delete in order of dependencies
  await prisma.idempotencyKey.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.simulatedEmail.deleteMany({});
  await prisma.walletMovement.deleteMany({
    where: { dedupeKey: { not: 'INITIAL_BALANCE' } },
  });
  await prisma.job.deleteMany({});
  await prisma.borrow.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.book.deleteMany({
    where: { isbn: { startsWith: 'buy-test-isbn' } },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        not: TEST_ADMIN_EMAIL,
      },
    },
  });
}


describe('Buy Service', () => {
  beforeAll(async () => {
    // Ensure wallet exists
    await prisma.libraryWallet.upsert({
      where: { id: 'library-wallet' },
      create: { id: 'library-wallet' },
      update: {},
    });
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Basic Buy Functionality', () => {
    it('should successfully buy a book', async () => {
      const book = await createTestBook();
      const idempotencyKey = generateIdempotencyKey();

      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', idempotencyKey);

      expect(response.status).toBe(200);
      expect(response.body.purchase).toBeDefined();
      expect(response.body.purchase.bookIsbn).toBe(book.isbn);
      expect(response.body.purchase.status).toBe('ACTIVE');
      expect(response.body.isExisting).toBe(false);
    });

    it('should return 404 for non-existent book', async () => {
      const idempotencyKey = generateIdempotencyKey();

      const response = await request(app)
        .post('/api/books/non-existent-isbn/buy')
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', idempotencyKey);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('BOOK_NOT_FOUND');
    });

    it('should return 400 when X-User-Email header is missing', async () => {
      const book = await createTestBook();
      const idempotencyKey = generateIdempotencyKey();

      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-Idempotency-Key', idempotencyKey);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('USER_EMAIL_REQUIRED');
    });

    it('should return 400 when X-Idempotency-Key header is missing', async () => {
      const book = await createTestBook();

      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  /**
   * Property 5: Buy Limit Enforcement Under Concurrency
   *
   * For any user and for any number of concurrent buy requests,
   * the user SHALL never own more than 2 non-canceled copies of any single book
   * AND never more than 10 total non-canceled copies across all books.
   *
   * Validates: Requirements 4.1, 4.2, 4.15, 16.4
   */
  describe('Property 5: Buy Limit Enforcement Under Concurrency', () => {
    it('should enforce per-book limit (2) under concurrent requests', async () => {
      const book = await createTestBook({ availableCopies: 10 });

      // Execute 5 concurrent buys for the same book from same user
      const promises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(`/api/books/${book.isbn}/buy`)
          .set('X-User-Email', TEST_USER_EMAIL)
          .set('X-Idempotency-Key', generateIdempotencyKey())
      );

      const results = await Promise.all(promises);

      // Count successes and failures
      const successes = results.filter((r) => r.status === 200);
      const limitExceeded = results.filter(
        (r) => r.status === 409 && r.body.error.code === 'BOOK_BUY_LIMIT_EXCEEDED'
      );
      const serializationFailures = results.filter((r) => r.status === 500);

      // At most 2 should succeed (per-book limit)
      expect(successes.length).toBeLessThanOrEqual(2);
      // Total failures should account for the rest
      expect(limitExceeded.length + serializationFailures.length).toBe(5 - successes.length);

      // Verify user has at most 2 active purchases for this book
      const user = await prisma.user.findUnique({
        where: { email: TEST_USER_EMAIL },
      });
      if (user) {
        const activePurchases = await prisma.purchase.count({
          where: { userId: user.id, bookId: book.id, status: 'ACTIVE' },
        });
        expect(activePurchases).toBeLessThanOrEqual(2);
      }
    });

    it('should enforce total limit (10) under concurrent requests', async () => {
      // Create 12 different books
      const books = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          createTestBook({ isbn: `buy-test-isbn-total-${i}-${Date.now()}` })
        )
      );

      // Execute 12 concurrent buys for different books from same user
      const promises = books.map((book) =>
        request(app)
          .post(`/api/books/${book.isbn}/buy`)
          .set('X-User-Email', TEST_USER_EMAIL)
          .set('X-Idempotency-Key', generateIdempotencyKey())
      );

      const results = await Promise.all(promises);

      // Count successes
      const successes = results.filter((r) => r.status === 200);
      const totalLimitExceeded = results.filter(
        (r) => r.status === 409 && r.body.error.code === 'TOTAL_BUY_LIMIT_EXCEEDED'
      );
      const serializationFailures = results.filter((r) => r.status === 500);

      // At most 10 should succeed (total limit)
      expect(successes.length).toBeLessThanOrEqual(10);
      // Total failures should account for the rest
      expect(totalLimitExceeded.length + serializationFailures.length).toBe(12 - successes.length);

      // Verify user has at most 10 active purchases total
      const user = await prisma.user.findUnique({
        where: { email: TEST_USER_EMAIL },
      });
      if (user) {
        const activePurchases = await prisma.purchase.count({
          where: { userId: user.id, status: 'ACTIVE' },
        });
        expect(activePurchases).toBeLessThanOrEqual(10);
      }
    });

    it('should reject buy when user already has 2 copies of the book', async () => {
      const book = await createTestBook({ availableCopies: 10 });

      // Buy first 2 copies sequentially
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post(`/api/books/${book.isbn}/buy`)
          .set('X-User-Email', TEST_USER_EMAIL)
          .set('X-Idempotency-Key', generateIdempotencyKey());
        expect(response.status).toBe(200);
      }

      // Try to buy 3rd copy
      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('BOOK_BUY_LIMIT_EXCEEDED');
    });

    it('should reject buy when user already has 10 total purchases', async () => {
      // Create 11 different books
      const books = await Promise.all(
        Array.from({ length: 11 }, (_, i) =>
          createTestBook({ isbn: `buy-test-isbn-seq-${i}-${Date.now()}` })
        )
      );

      // Buy first 10 books sequentially
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post(`/api/books/${books[i].isbn}/buy`)
          .set('X-User-Email', TEST_USER_EMAIL)
          .set('X-Idempotency-Key', generateIdempotencyKey());
        expect(response.status).toBe(200);
      }

      // Try to buy 11th book
      const response = await request(app)
        .post(`/api/books/${books[10].isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('TOTAL_BUY_LIMIT_EXCEEDED');
    });
  });


  /**
   * Property 6: Buy Idempotency via Key
   *
   * For any buy request with an idempotency key that was previously used
   * by the same user, the system SHALL return the original response
   * without creating a new purchase or decrementing inventory.
   *
   * Validates: Requirements 4.13, 17.3, 17.4
   */
  describe('Property 6: Buy Idempotency via Key', () => {
    it('should return same response when using same idempotency key', async () => {
      const book = await createTestBook({ availableCopies: 5 });
      const idempotencyKey = generateIdempotencyKey();

      // First buy
      const response1 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', idempotencyKey);

      expect(response1.status).toBe(200);
      const firstPurchaseId = response1.body.purchase.id;

      // Second buy with same idempotency key
      const response2 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', idempotencyKey);

      expect(response2.status).toBe(200);
      expect(response2.body.purchase.id).toBe(firstPurchaseId);

      // Verify inventory was only decremented once
      const updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(4); // 5 - 1 = 4

      // Verify only one purchase was created
      const user = await prisma.user.findUnique({
        where: { email: TEST_USER_EMAIL },
      });
      const purchases = await prisma.purchase.findMany({
        where: { userId: user!.id, bookId: book.id },
      });
      expect(purchases.length).toBe(1);

      // Verify only one wallet movement was created
      const movements = await prisma.walletMovement.findMany({
        where: { relatedEntity: `purchase:${firstPurchaseId}` },
      });
      expect(movements.length).toBe(1);
    });

    it('should allow different idempotency keys for same book', async () => {
      const book = await createTestBook({ availableCopies: 5 });

      // First buy with key1
      const response1 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response1.status).toBe(200);
      const firstPurchaseId = response1.body.purchase.id;

      // Second buy with key2 (different key)
      const response2 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response2.status).toBe(200);
      const secondPurchaseId = response2.body.purchase.id;

      // Should be different purchases
      expect(secondPurchaseId).not.toBe(firstPurchaseId);

      // Verify inventory was decremented twice
      const updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(3); // 5 - 2 = 3
    });

    it('should scope idempotency keys per user', async () => {
      const book = await createTestBook({ availableCopies: 5 });
      const sharedIdempotencyKey = generateIdempotencyKey();

      // User 1 buys with key
      const response1 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', 'user1@test.com')
        .set('X-Idempotency-Key', sharedIdempotencyKey);

      expect(response1.status).toBe(200);
      const user1PurchaseId = response1.body.purchase.id;

      // User 2 buys with same key (should create new purchase)
      const response2 = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', 'user2@test.com')
        .set('X-Idempotency-Key', sharedIdempotencyKey);

      expect(response2.status).toBe(200);
      const user2PurchaseId = response2.body.purchase.id;

      // Should be different purchases
      expect(user2PurchaseId).not.toBe(user1PurchaseId);

      // Verify inventory was decremented twice
      const updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(3); // 5 - 2 = 3
    });
  });


  /**
   * Property 7: Cancel Idempotency
   *
   * For any purchase that has already been canceled, subsequent cancel requests
   * SHALL return success (HTTP 200) without incrementing inventory or creating
   * additional refund movements.
   *
   * Validates: Requirements 5.7, 17.5
   */
  describe('Property 7: Cancel Idempotency', () => {
    it('should return 200 when canceling already-canceled purchase without double refund', async () => {
      const book = await createTestBook({ availableCopies: 5 });

      // First buy the book
      const buyResponse = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(buyResponse.status).toBe(200);
      const purchaseId = buyResponse.body.purchase.id;

      // Verify inventory decreased
      let updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(4);

      // First cancel
      const cancelResponse1 = await request(app)
        .post(`/api/purchases/${purchaseId}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(cancelResponse1.status).toBe(200);
      expect(cancelResponse1.body.purchase.id).toBe(purchaseId);
      expect(cancelResponse1.body.purchase.status).toBe('CANCELED');
      expect(cancelResponse1.body.isExisting).toBe(false);

      // Verify inventory increased back to 5
      updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(5);

      // Second cancel (idempotent)
      const cancelResponse2 = await request(app)
        .post(`/api/purchases/${purchaseId}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(cancelResponse2.status).toBe(200);
      expect(cancelResponse2.body.purchase.id).toBe(purchaseId);
      expect(cancelResponse2.body.purchase.status).toBe('CANCELED');
      expect(cancelResponse2.body.isExisting).toBe(true);

      // Verify inventory is still 5 (no double increment)
      updatedBook = await prisma.book.findUnique({
        where: { isbn: book.isbn },
      });
      expect(updatedBook!.availableCopies).toBe(5);

      // Verify only one CANCEL_REFUND movement was created
      const refundMovements = await prisma.walletMovement.findMany({
        where: {
          type: 'CANCEL_REFUND',
          relatedEntity: `purchase:${purchaseId}`,
        },
      });
      expect(refundMovements.length).toBe(1);

      // Verify only one CANCEL_BUY event was created
      const cancelEvents = await prisma.event.findMany({
        where: {
          type: 'CANCEL_BUY',
          purchaseId,
        },
      });
      expect(cancelEvents.length).toBe(1);
    });

    it('should return 404 when purchase not found', async () => {
      const response = await request(app)
        .post('/api/purchases/non-existent-id/cancel')
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PURCHASE_NOT_FOUND');
    });

    it('should return 400 when cancellation window expired', async () => {
      const book = await createTestBook({ availableCopies: 5 });

      // Buy the book
      const buyResponse = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(buyResponse.status).toBe(200);
      const purchaseId = buyResponse.body.purchase.id;

      // Manually update purchasedAt to be more than 5 minutes ago
      await prisma.purchase.update({
        where: { id: purchaseId },
        data: { purchasedAt: new Date(Date.now() - 6 * 60 * 1000) }, // 6 minutes ago
      });

      // Try to cancel
      const cancelResponse = await request(app)
        .post(`/api/purchases/${purchaseId}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(cancelResponse.status).toBe(400);
      expect(cancelResponse.body.error.code).toBe('CANCELLATION_WINDOW_EXPIRED');
    });
  });


  /**
   * Property 8: Canceled Purchases Excluded from Limits
   *
   * For any user's buy limit calculation, canceled purchases SHALL NOT
   * be counted toward the per-book limit (2) or total limit (10).
   *
   * Validates: Requirements 5.8
   */
  describe('Property 8: Canceled Purchases Excluded from Limits', () => {
    it('should not count canceled purchases toward per-book limit', async () => {
      const book = await createTestBook({ availableCopies: 10 });

      // Buy 2 copies (reaching per-book limit)
      const purchase1Response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(purchase1Response.status).toBe(200);
      const purchase1Id = purchase1Response.body.purchase.id;

      const purchase2Response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(purchase2Response.status).toBe(200);

      // Verify limit is reached
      const limitReachedResponse = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(limitReachedResponse.status).toBe(409);
      expect(limitReachedResponse.body.error.code).toBe('BOOK_BUY_LIMIT_EXCEEDED');

      // Cancel first purchase
      const cancelResponse = await request(app)
        .post(`/api/purchases/${purchase1Id}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);
      expect(cancelResponse.status).toBe(200);

      // Now should be able to buy again (canceled purchase doesn't count)
      const newPurchaseResponse = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(newPurchaseResponse.status).toBe(200);
    });

    it('should not count canceled purchases toward total limit', async () => {
      // Create 11 different books
      const books = await Promise.all(
        Array.from({ length: 11 }, (_, i) =>
          createTestBook({ isbn: `buy-test-isbn-cancel-${i}-${Date.now()}` })
        )
      );

      // Buy 10 books (reaching total limit)
      const purchaseIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post(`/api/books/${books[i].isbn}/buy`)
          .set('X-User-Email', TEST_USER_EMAIL)
          .set('X-Idempotency-Key', generateIdempotencyKey());
        expect(response.status).toBe(200);
        purchaseIds.push(response.body.purchase.id);
      }

      // Verify limit is reached
      const limitReachedResponse = await request(app)
        .post(`/api/books/${books[10].isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(limitReachedResponse.status).toBe(409);
      expect(limitReachedResponse.body.error.code).toBe('TOTAL_BUY_LIMIT_EXCEEDED');

      // Cancel first purchase
      const cancelResponse = await request(app)
        .post(`/api/purchases/${purchaseIds[0]}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);
      expect(cancelResponse.status).toBe(200);

      // Now should be able to buy again (canceled purchase doesn't count)
      const newPurchaseResponse = await request(app)
        .post(`/api/books/${books[10].isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());
      expect(newPurchaseResponse.status).toBe(200);
    });
  });

  describe('Wallet Movement', () => {
    it('should credit wallet with sell price on buy', async () => {
      const sellPrice = 2499;
      const book = await createTestBook({ sellPriceCents: sellPrice });

      // Get initial balance
      const initialBalance = await prisma.walletMovement.aggregate({
        where: { walletId: 'library-wallet' },
        _sum: { amountCents: true },
      });

      // Buy book
      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response.status).toBe(200);

      // Get new balance
      const newBalance = await prisma.walletMovement.aggregate({
        where: { walletId: 'library-wallet' },
        _sum: { amountCents: true },
      });

      // Verify balance increased by sell price
      const initialSum = initialBalance._sum.amountCents || 0;
      const newSum = newBalance._sum.amountCents || 0;
      expect(newSum - initialSum).toBe(sellPrice);
    });

    it('should debit wallet with sell price on cancel', async () => {
      const sellPrice = 2499;
      const book = await createTestBook({ sellPriceCents: sellPrice });

      // Buy book
      const buyResponse = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(buyResponse.status).toBe(200);
      const purchaseId = buyResponse.body.purchase.id;

      // Get balance after buy
      const balanceAfterBuy = await prisma.walletMovement.aggregate({
        where: { walletId: 'library-wallet' },
        _sum: { amountCents: true },
      });

      // Cancel purchase
      const cancelResponse = await request(app)
        .post(`/api/purchases/${purchaseId}/cancel`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(cancelResponse.status).toBe(200);

      // Get balance after cancel
      const balanceAfterCancel = await prisma.walletMovement.aggregate({
        where: { walletId: 'library-wallet' },
        _sum: { amountCents: true },
      });

      // Verify balance decreased by sell price (refund)
      const buySum = balanceAfterBuy._sum.amountCents || 0;
      const cancelSum = balanceAfterCancel._sum.amountCents || 0;
      expect(buySum - cancelSum).toBe(sellPrice);
    });
  });

  describe('Low Stock Notification', () => {
    it('should create low stock notification when reaching 1 copy after buy', async () => {
      // Create book with 2 copies
      const book = await createTestBook({ availableCopies: 2 });

      // Buy first copy (leaves 1)
      const response = await request(app)
        .post(`/api/books/${book.isbn}/buy`)
        .set('X-User-Email', TEST_USER_EMAIL)
        .set('X-Idempotency-Key', generateIdempotencyKey());

      expect(response.status).toBe(200);

      // Verify low stock email was created
      const emails = await prisma.simulatedEmail.findMany({
        where: {
          type: 'LOW_STOCK',
          recipient: 'supply@library.com',
        },
      });

      const lowStockEmail = emails.find((e) => e.subject.includes(book.title));
      expect(lowStockEmail).toBeDefined();

      // Verify restock job was scheduled
      const restockJob = await prisma.job.findFirst({
        where: {
          type: 'RESTOCK',
          bookId: book.id,
          activeKey: { not: null },
        },
      });
      expect(restockJob).toBeDefined();
    });
  });
});
