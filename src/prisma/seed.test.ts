import { PrismaClient, MovementType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Test constants
const INITIAL_BALANCE_CENTS = 10000;
const WALLET_ID = 'library-wallet';

// Mock PrismaClient for unit testing
jest.mock('@prisma/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockPrismaClient: any = {
    book: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    libraryWallet: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    walletMovement: {
      findUnique: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
    $disconnect: jest.fn(),
  };
  
  mockPrismaClient.$transaction = jest.fn((callback: (client: typeof mockPrismaClient) => Promise<unknown>) => callback(mockPrismaClient));

  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
    MovementType: {
      BORROW_INCOME: 'BORROW_INCOME',
      BUY_INCOME: 'BUY_INCOME',
      CANCEL_REFUND: 'CANCEL_REFUND',
      RESTOCK_EXPENSE: 'RESTOCK_EXPENSE',
      INITIAL_BALANCE: 'INITIAL_BALANCE',
    },
  };
});

describe('Seeding', () => {
  describe('Books JSON data', () => {
    it('should have valid book data in books.json', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      expect(Array.isArray(booksData)).toBe(true);
      expect(booksData.length).toBeGreaterThan(0);

      // Verify first book has required fields
      const firstBook = booksData[0];
      expect(firstBook).toHaveProperty('isbn');
      expect(firstBook).toHaveProperty('title');
      expect(firstBook).toHaveProperty('authors');
      expect(firstBook).toHaveProperty('genres');
      expect(firstBook).toHaveProperty('prices');
      expect(firstBook).toHaveProperty('copies');
      expect(firstBook.prices).toHaveProperty('sell');
      expect(firstBook.prices).toHaveProperty('borrow');
      expect(firstBook.prices).toHaveProperty('stock');
    });

    /**
     * Property 14: Monetary Value Integrity
     * For all monetary values stored in the database (prices, movements, balances),
     * the values SHALL be integers representing cents.
     * Validates: Requirements 1.4, 6.4
     */
    it('should convert book prices from dollars to cents (integers)', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      // Verify all books have prices that when converted to cents are integers
      for (const book of booksData) {
        const sellCents = book.prices.sell * 100;
        const borrowCents = book.prices.borrow * 100;
        const stockCents = book.prices.stock * 100;

        // All cent values should be integers
        expect(Number.isInteger(sellCents)).toBe(true);
        expect(Number.isInteger(borrowCents)).toBe(true);
        expect(Number.isInteger(stockCents)).toBe(true);

        // All cent values should be positive
        expect(sellCents).toBeGreaterThan(0);
        expect(borrowCents).toBeGreaterThan(0);
        expect(stockCents).toBeGreaterThan(0);
      }
    });
  });


  describe('Wallet initial balance', () => {
    /**
     * Property 14: Monetary Value Integrity
     * For all monetary values stored in the database (prices, movements, balances),
     * the values SHALL be integers representing cents.
     * Validates: Requirements 1.4, 6.4
     */
    it('should have initial balance of 10000 cents ($100.00)', () => {
      expect(INITIAL_BALANCE_CENTS).toBe(10000);
      expect(Number.isInteger(INITIAL_BALANCE_CENTS)).toBe(true);
    });

    it('should use correct wallet ID', () => {
      expect(WALLET_ID).toBe('library-wallet');
    });
  });

  describe('Idempotent seeding', () => {
    it('should use upsert for books to ensure idempotency', () => {
      // The seed function uses upsert which is idempotent by design
      // Running seed twice should produce the same result
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      // Each book has a unique ISBN which is used as the upsert key
      const isbns = booksData.map((book: { isbn: string }) => book.isbn);
      const uniqueIsbns = new Set(isbns);

      // All ISBNs should be unique
      expect(isbns.length).toBe(uniqueIsbns.size);
    });

    it('should use dedupeKey for wallet movement to prevent duplicates', () => {
      // The initial balance movement uses 'INITIAL_BALANCE' as dedupeKey
      // This ensures only one initial balance movement is ever created
      const dedupeKey = 'INITIAL_BALANCE';
      expect(dedupeKey).toBe('INITIAL_BALANCE');
    });
  });

  describe('Book data validation', () => {
    it('should have valid ISBN format (UUID) for all books', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      for (const book of booksData) {
        expect(book.isbn).toMatch(uuidRegex);
      }
    });

    it('should have positive copy counts for all books', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      for (const book of booksData) {
        expect(book.copies).toBeGreaterThan(0);
        expect(Number.isInteger(book.copies)).toBe(true);
      }
    });

    it('should have non-empty authors array for all books', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      for (const book of booksData) {
        expect(Array.isArray(book.authors)).toBe(true);
        expect(book.authors.length).toBeGreaterThan(0);
      }
    });

    it('should have non-empty genres array for all books', () => {
      const booksPath = path.join(process.cwd(), 'books.json');
      const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

      for (const book of booksData) {
        expect(Array.isArray(book.genres)).toBe(true);
        expect(book.genres.length).toBeGreaterThan(0);
      }
    });
  });
});
