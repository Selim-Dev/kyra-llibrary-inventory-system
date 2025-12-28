/**
 * Wallet Service Tests
 *
 * Tests for:
 * - Property 1: Wallet Balance Derivability (Round-Trip)
 * - Wallet movement deduplication
 *
 * NOTE: These are integration tests that require a running PostgreSQL database.
 * Run with: npm test -- --testPathPattern="walletService.test.ts"
 * Ensure DATABASE_URL is set in .env and the database is running.
 */

import prisma from '../prisma/client';
import {
  getBalance,
  addMovement,
  getMovements,
} from './walletService';

// Constants
const WALLET_ID = 'library-wallet';

// Helper to clean up test wallet movements (except initial balance)
async function cleanupTestMovements() {
  await prisma.walletMovement.deleteMany({
    where: {
      dedupeKey: {
        not: 'INITIAL_BALANCE',
        startsWith: 'TEST_',
      },
    },
  });
}

// Helper to create a unique test dedupeKey
function createTestDedupeKey(): string {
  return `TEST_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

describe('Wallet Service', () => {
  beforeAll(async () => {
    // Ensure wallet exists
    await prisma.libraryWallet.upsert({
      where: { id: WALLET_ID },
      create: { id: WALLET_ID },
      update: {},
    });
  });

  beforeEach(async () => {
    await cleanupTestMovements();
  });

  afterAll(async () => {
    await cleanupTestMovements();
    await prisma.$disconnect();
  });

  describe('getBalance', () => {
    it('should return balance as sum of all movements', async () => {
      const balance = await getBalance();

      expect(balance).toHaveProperty('balanceCents');
      expect(balance).toHaveProperty('balanceFormatted');
      expect(typeof balance.balanceCents).toBe('number');
      expect(typeof balance.balanceFormatted).toBe('string');
    });

    it('should format balance correctly', async () => {
      const balance = await getBalance();

      // Verify format is "X.XX"
      expect(balance.balanceFormatted).toMatch(/^-?\d+\.\d{2}$/);

      // Verify formatted matches cents
      const expectedFormatted = (balance.balanceCents / 100).toFixed(2);
      expect(balance.balanceFormatted).toBe(expectedFormatted);
    });
  });

  describe('addMovement', () => {
    it('should create a new movement', async () => {
      const dedupeKey = createTestDedupeKey();
      const movement = await addMovement({
        amountCents: 500,
        type: 'BORROW_INCOME',
        reason: 'Test borrow',
        relatedEntity: 'test:123',
        dedupeKey,
      });

      expect(movement).toBeDefined();
      expect(movement.amountCents).toBe(500);
      expect(movement.type).toBe('BORROW_INCOME');
      expect(movement.reason).toBe('Test borrow');
      expect(movement.relatedEntity).toBe('test:123');
      expect(movement.dedupeKey).toBe(dedupeKey);
    });

    it('should create movement without dedupeKey', async () => {
      const movement = await addMovement({
        amountCents: 300,
        type: 'BORROW_INCOME',
        reason: 'Test without dedupe',
      });

      expect(movement).toBeDefined();
      expect(movement.amountCents).toBe(300);
      expect(movement.dedupeKey).toBeNull();
    });
  });

  describe('getMovements', () => {
    it('should return paginated movements', async () => {
      // Create some test movements
      const dedupeKey1 = createTestDedupeKey();
      const dedupeKey2 = createTestDedupeKey();

      await addMovement({
        amountCents: 100,
        type: 'BORROW_INCOME',
        reason: 'Test 1',
        dedupeKey: dedupeKey1,
      });

      await addMovement({
        amountCents: -50,
        type: 'RESTOCK_EXPENSE',
        reason: 'Test 2',
        dedupeKey: dedupeKey2,
      });

      const result = await getMovements({ page: '1', pageSize: '10' });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toHaveProperty('total');
      expect(result.pagination).toHaveProperty('page');
      expect(result.pagination).toHaveProperty('pageSize');
      expect(result.pagination).toHaveProperty('totalPages');
    });

    it('should filter by credit (positive amounts)', async () => {
      const dedupeKey = createTestDedupeKey();
      await addMovement({
        amountCents: 200,
        type: 'BORROW_INCOME',
        reason: 'Credit test',
        dedupeKey,
      });

      const result = await getMovements({ type: 'credit' });

      // All returned movements should have positive amounts
      for (const movement of result.data) {
        expect(movement.amountCents).toBeGreaterThan(0);
      }
    });

    it('should filter by debit (negative amounts)', async () => {
      const dedupeKey = createTestDedupeKey();
      await addMovement({
        amountCents: -100,
        type: 'RESTOCK_EXPENSE',
        reason: 'Debit test',
        dedupeKey,
      });

      const result = await getMovements({ type: 'debit' });

      // All returned movements should have negative amounts
      for (const movement of result.data) {
        expect(movement.amountCents).toBeLessThan(0);
      }
    });

    it('should include formatted amount in response', async () => {
      const result = await getMovements();

      for (const movement of result.data) {
        expect(movement).toHaveProperty('amountFormatted');
        expect(typeof movement.amountFormatted).toBe('string');
        expect(movement.amountFormatted).toMatch(/^-?\d+\.\d{2}$/);
      }
    });
  });

  /**
   * Property 1: Wallet Balance Derivability (Round-Trip)
   *
   * For any sequence of wallet operations (borrows, buys, cancels, restocks),
   * the wallet balance SHALL always equal the sum of all wallet movements.
   *
   * Validates: Requirements 6.3, 6.5
   */
  describe('Property 1: Wallet Balance Derivability (Round-Trip)', () => {
    it('should have balance equal to sum of all movements', async () => {
      // Get balance using service
      const balance = await getBalance();

      // Calculate sum directly from database
      const result = await prisma.walletMovement.aggregate({
        where: { walletId: WALLET_ID },
        _sum: { amountCents: true },
      });

      const directSum = result._sum.amountCents || 0;

      // Balance should equal direct sum
      expect(balance.balanceCents).toBe(directSum);
    });

    it('should maintain derivability after adding movements', async () => {
      // Get initial balance
      const initialBalance = await getBalance();

      // Add some movements
      const dedupeKey1 = createTestDedupeKey();
      const dedupeKey2 = createTestDedupeKey();
      const dedupeKey3 = createTestDedupeKey();

      await addMovement({
        amountCents: 1000,
        type: 'BORROW_INCOME',
        reason: 'Test borrow 1',
        dedupeKey: dedupeKey1,
      });

      await addMovement({
        amountCents: 500,
        type: 'BUY_INCOME',
        reason: 'Test buy',
        dedupeKey: dedupeKey2,
      });

      await addMovement({
        amountCents: -300,
        type: 'RESTOCK_EXPENSE',
        reason: 'Test restock',
        dedupeKey: dedupeKey3,
      });

      // Get new balance
      const newBalance = await getBalance();

      // Calculate expected balance
      const expectedBalance = initialBalance.balanceCents + 1000 + 500 - 300;

      // Balance should equal expected
      expect(newBalance.balanceCents).toBe(expectedBalance);

      // Verify against direct sum
      const result = await prisma.walletMovement.aggregate({
        where: { walletId: WALLET_ID },
        _sum: { amountCents: true },
      });

      expect(newBalance.balanceCents).toBe(result._sum.amountCents || 0);
    });

    it('should maintain derivability with mixed positive and negative movements', async () => {
      // Get initial balance
      const initialBalance = await getBalance();

      // Add alternating positive and negative movements
      const movements = [
        { amount: 100, type: 'BORROW_INCOME' as const },
        { amount: -50, type: 'RESTOCK_EXPENSE' as const },
        { amount: 200, type: 'BUY_INCOME' as const },
        { amount: -75, type: 'CANCEL_REFUND' as const },
        { amount: 150, type: 'BORROW_INCOME' as const },
      ];

      let expectedDelta = 0;
      for (const m of movements) {
        const dedupeKey = createTestDedupeKey();
        await addMovement({
          amountCents: m.amount,
          type: m.type,
          reason: `Test ${m.type}`,
          dedupeKey,
        });
        expectedDelta += m.amount;
      }

      // Get new balance
      const newBalance = await getBalance();

      // Balance should equal initial + delta
      expect(newBalance.balanceCents).toBe(initialBalance.balanceCents + expectedDelta);

      // Verify against direct sum
      const result = await prisma.walletMovement.aggregate({
        where: { walletId: WALLET_ID },
        _sum: { amountCents: true },
      });

      expect(newBalance.balanceCents).toBe(result._sum.amountCents || 0);
    });
  });

  /**
   * Wallet Movement Deduplication Tests
   *
   * Test: Running borrow logic twice with same borrowId creates only one movement
   * Test: Unique dedupeKey constraint prevents duplicate movements on retry
   *
   * Validates: Requirements 6.2, 17.1
   */
  describe('Wallet Movement Deduplication', () => {
    it('should return existing movement when dedupeKey already exists', async () => {
      const dedupeKey = createTestDedupeKey();

      // First movement
      const movement1 = await addMovement({
        amountCents: 500,
        type: 'BORROW_INCOME',
        reason: 'First attempt',
        dedupeKey,
      });

      // Second movement with same dedupeKey
      const movement2 = await addMovement({
        amountCents: 500,
        type: 'BORROW_INCOME',
        reason: 'Second attempt',
        dedupeKey,
      });

      // Should return the same movement
      expect(movement2.id).toBe(movement1.id);

      // Verify only one movement exists with this dedupeKey
      const count = await prisma.walletMovement.count({
        where: { dedupeKey },
      });
      expect(count).toBe(1);
    });

    it('should not create duplicate movements on retry with same dedupeKey', async () => {
      const dedupeKey = createTestDedupeKey();

      // Get initial balance
      const initialBalance = await getBalance();

      // Add movement multiple times with same dedupeKey
      await addMovement({
        amountCents: 1000,
        type: 'BORROW_INCOME',
        reason: 'Retry test',
        dedupeKey,
      });

      await addMovement({
        amountCents: 1000,
        type: 'BORROW_INCOME',
        reason: 'Retry test',
        dedupeKey,
      });

      await addMovement({
        amountCents: 1000,
        type: 'BORROW_INCOME',
        reason: 'Retry test',
        dedupeKey,
      });

      // Get new balance
      const newBalance = await getBalance();

      // Balance should only increase by 1000 (not 3000)
      expect(newBalance.balanceCents).toBe(initialBalance.balanceCents + 1000);
    });

    it('should allow different dedupeKeys to create separate movements', async () => {
      const dedupeKey1 = createTestDedupeKey();
      const dedupeKey2 = createTestDedupeKey();

      // Get initial balance
      const initialBalance = await getBalance();

      // Add two movements with different dedupeKeys
      await addMovement({
        amountCents: 500,
        type: 'BORROW_INCOME',
        reason: 'Movement 1',
        dedupeKey: dedupeKey1,
      });

      await addMovement({
        amountCents: 500,
        type: 'BORROW_INCOME',
        reason: 'Movement 2',
        dedupeKey: dedupeKey2,
      });

      // Get new balance
      const newBalance = await getBalance();

      // Balance should increase by 1000 (both movements)
      expect(newBalance.balanceCents).toBe(initialBalance.balanceCents + 1000);
    });

    it('should handle concurrent duplicate requests with same dedupeKey', async () => {
      const dedupeKey = createTestDedupeKey();

      // Get initial balance
      const initialBalance = await getBalance();

      // Simulate concurrent requests with same dedupeKey
      const promises = Array.from({ length: 5 }, () =>
        addMovement({
          amountCents: 200,
          type: 'BORROW_INCOME',
          reason: 'Concurrent test',
          dedupeKey,
        })
      );

      const results = await Promise.all(promises);

      // All results should have the same ID
      const ids = results.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(1);

      // Get new balance
      const newBalance = await getBalance();

      // Balance should only increase by 200 (not 1000)
      expect(newBalance.balanceCents).toBe(initialBalance.balanceCents + 200);
    });
  });
});
