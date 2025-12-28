/**
 * Admin Endpoints Integration Tests
 *
 * Tests for:
 * - Book search with pagination
 * - Event filtering
 * - Wallet balance calculation
 * - Email listing
 * - User history
 */

import request from 'supertest';
import app from '../app';
import prisma from '../prisma/client';

const ADMIN_EMAIL = 'admin@dummy-library.com';
const TEST_USER_EMAIL = 'testuser@test.com';

// Helper to create a test book
async function createTestBook(overrides: Partial<{
  isbn: string;
  title: string;
  authors: string[];
  genres: string[];
  availableCopies: number;
}> = {}) {
  const isbn = overrides.isbn || `test-isbn-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return prisma.book.create({
    data: {
      isbn,
      title: overrides.title || `Test Book ${isbn}`,
      authors: overrides.authors || ['Test Author'],
      genres: overrides.genres || ['Fiction'],
      sellPriceCents: 1999,
      borrowPriceCents: 299,
      stockPriceCents: 999,
      availableCopies: overrides.availableCopies ?? 10,
      seededCopies: overrides.availableCopies ?? 10,
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
    where: { email: { not: ADMIN_EMAIL } },
  });
}

describe('Admin Endpoints', () => {
  beforeAll(async () => {
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

  describe('GET /api/books - Book Search', () => {
    it('should return paginated list of books', async () => {
      // Create test books
      await Promise.all([
        createTestBook({ title: 'Alpha Book', isbn: 'test-isbn-alpha' }),
        createTestBook({ title: 'Beta Book', isbn: 'test-isbn-beta' }),
        createTestBook({ title: 'Gamma Book', isbn: 'test-isbn-gamma' }),
      ]);

      // Search for our test books specifically
      const response = await request(app)
        .get('/api/books')
        .query({ title: 'Alpha Book' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.page).toBe(1);
    });

    it('should filter books by title (case-insensitive)', async () => {
      await Promise.all([
        createTestBook({ title: 'JavaScript Guide', isbn: 'test-isbn-js' }),
        createTestBook({ title: 'Python Basics', isbn: 'test-isbn-py' }),
        createTestBook({ title: 'Advanced JavaScript', isbn: 'test-isbn-adv-js' }),
      ]);

      const response = await request(app)
        .get('/api/books')
        .query({ title: 'javascript' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((b: { title: string }) => 
        b.title.toLowerCase().includes('javascript')
      )).toBe(true);
    });

    it('should filter books by author (case-insensitive)', async () => {
      await Promise.all([
        createTestBook({ 
          title: 'Book by John', 
          isbn: 'test-isbn-john',
          authors: ['John Smith', 'Jane Doe'] 
        }),
        createTestBook({ 
          title: 'Book by Jane', 
          isbn: 'test-isbn-jane',
          authors: ['Jane Doe'] 
        }),
        createTestBook({ 
          title: 'Book by Bob', 
          isbn: 'test-isbn-bob',
          authors: ['Bob Wilson'] 
        }),
      ]);

      const response = await request(app)
        .get('/api/books')
        .query({ author: 'jane' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should filter books by genre (exact match)', async () => {
      await Promise.all([
        createTestBook({ 
          title: 'Fiction Book', 
          isbn: 'test-isbn-fiction',
          genres: ['Fiction', 'Drama'] 
        }),
        createTestBook({ 
          title: 'Science Book', 
          isbn: 'test-isbn-science',
          genres: ['Science', 'Education'] 
        }),
      ]);

      const response = await request(app)
        .get('/api/books')
        .query({ genre: 'Fiction' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Fiction Book');
    });
  });

  describe('GET /api/admin/events - Events Endpoint', () => {
    it('should require admin access', async () => {
      const response = await request(app)
        .get('/api/admin/events')
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return paginated events for admin', async () => {
      // Create a book and borrow it to generate events
      const book = await createTestBook();
      
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/events')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should filter events by type', async () => {
      const book = await createTestBook();
      
      // Borrow and return to create multiple event types
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);
      
      await request(app)
        .post(`/api/books/${book.isbn}/return`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/events')
        .set('X-User-Email', ADMIN_EMAIL)
        .query({ type: 'BORROW' });

      expect(response.status).toBe(200);
      expect(response.body.data.every((e: { type: string }) => e.type === 'BORROW')).toBe(true);
    });

    it('should filter events by user email', async () => {
      const book = await createTestBook();
      const user1Email = 'user1@test.com';
      const user2Email = 'user2@test.com';
      
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', user1Email);

      // Create another book for user2 to avoid conflict
      const book2 = await createTestBook();
      await request(app)
        .post(`/api/books/${book2.isbn}/borrow`)
        .set('X-User-Email', user2Email);

      const response = await request(app)
        .get('/api/admin/events')
        .set('X-User-Email', ADMIN_EMAIL)
        .query({ userEmail: user1Email });

      expect(response.status).toBe(200);
      expect(response.body.data.every((e: { userEmail: string }) => 
        e.userEmail === user1Email
      )).toBe(true);
    });
  });

  describe('GET /api/admin/wallet - Wallet Balance', () => {
    it('should require admin access', async () => {
      const response = await request(app)
        .get('/api/admin/wallet')
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(403);
    });

    it('should return wallet balance in cents and formatted', async () => {
      const response = await request(app)
        .get('/api/admin/wallet')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('balanceCents');
      expect(response.body).toHaveProperty('balanceFormatted');
      expect(typeof response.body.balanceCents).toBe('number');
      expect(typeof response.body.balanceFormatted).toBe('string');
    });

    it('should reflect balance changes after borrow', async () => {
      // Get initial balance
      const initialResponse = await request(app)
        .get('/api/admin/wallet')
        .set('X-User-Email', ADMIN_EMAIL);
      
      const initialBalance = initialResponse.body.balanceCents;

      // Borrow a book
      const book = await createTestBook({ availableCopies: 5 });
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      // Get new balance
      const newResponse = await request(app)
        .get('/api/admin/wallet')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(newResponse.body.balanceCents).toBe(initialBalance + 299); // borrowPriceCents
    });
  });

  describe('GET /api/admin/wallet/movements - Wallet Movements', () => {
    it('should return paginated wallet movements', async () => {
      // Create some movements by borrowing
      const book = await createTestBook();
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/wallet/movements')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should filter movements by credit type', async () => {
      const book = await createTestBook();
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/wallet/movements')
        .set('X-User-Email', ADMIN_EMAIL)
        .query({ type: 'credit' });

      expect(response.status).toBe(200);
      expect(response.body.data.every((m: { amountCents: number }) => 
        m.amountCents > 0
      )).toBe(true);
    });
  });

  describe('GET /api/admin/emails - Simulated Emails', () => {
    it('should require admin access', async () => {
      const response = await request(app)
        .get('/api/admin/emails')
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(403);
    });

    it('should return paginated emails', async () => {
      // Create a low stock situation to generate an email
      const book = await createTestBook({ availableCopies: 2 });
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/emails')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(200);
      expect(response.body.pagination).toBeDefined();
    });

    it('should filter emails by recipient', async () => {
      // Create a low stock email
      const book = await createTestBook({ availableCopies: 2 });
      await request(app)
        .post(`/api/books/${book.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get('/api/admin/emails')
        .set('X-User-Email', ADMIN_EMAIL)
        .query({ recipient: 'supply@library.com' });

      expect(response.status).toBe(200);
      expect(response.body.data.every((e: { recipient: string }) => 
        e.recipient === 'supply@library.com'
      )).toBe(true);
    });
  });

  describe('GET /api/admin/users/:email/history - User History', () => {
    it('should require admin access', async () => {
      const response = await request(app)
        .get(`/api/admin/users/${TEST_USER_EMAIL}/history`)
        .set('X-User-Email', TEST_USER_EMAIL);

      expect(response.status).toBe(403);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/admin/users/nonexistent@test.com/history')
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should return user history with borrows and summary', async () => {
      // Create user activity
      const book1 = await createTestBook({ isbn: 'test-isbn-hist-1' });
      const book2 = await createTestBook({ isbn: 'test-isbn-hist-2' });

      await request(app)
        .post(`/api/books/${book1.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      await request(app)
        .post(`/api/books/${book2.isbn}/borrow`)
        .set('X-User-Email', TEST_USER_EMAIL);

      await request(app)
        .post(`/api/books/${book1.isbn}/return`)
        .set('X-User-Email', TEST_USER_EMAIL);

      const response = await request(app)
        .get(`/api/admin/users/${TEST_USER_EMAIL}/history`)
        .set('X-User-Email', ADMIN_EMAIL);

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(TEST_USER_EMAIL);
      expect(response.body.borrows).toHaveLength(2);
      expect(response.body.summary).toEqual({
        totalBorrows: 2,
        activeBorrows: 1,
        returnedBorrows: 1,
        totalPurchases: 0,
        activePurchases: 0,
        canceledPurchases: 0,
      });
    });
  });
});
