import { PrismaClient, MovementType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface BookSeedData {
  title: string;
  authors: string[];
  prices: {
    sell: number;
    stock: number;
    borrow: number;
  };
  year?: number;
  pages?: number;
  publisher?: string;
  isbn: string;
  genres: string[];
  copies: number;
}

const INITIAL_BALANCE_CENTS = 10000; // $100.00
const WALLET_ID = 'library-wallet';

async function seedBooks(): Promise<number> {
  // Read books.json from project root
  const booksPath = path.join(process.cwd(), 'books.json');
  const booksData: BookSeedData[] = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));

  let seededCount = 0;

  for (const book of booksData) {
    // Upsert book by ISBN - idempotent operation
    await prisma.book.upsert({
      where: { isbn: book.isbn },
      update: {
        // Update existing book data (except copies to preserve current inventory)
        title: book.title,
        authors: book.authors,
        genres: book.genres,
        sellPriceCents: book.prices.sell * 100, // Convert dollars to cents
        borrowPriceCents: book.prices.borrow * 100,
        stockPriceCents: book.prices.stock * 100,
        year: book.year,
        pages: book.pages,
        publisher: book.publisher,
      },
      create: {
        isbn: book.isbn,
        title: book.title,
        authors: book.authors,
        genres: book.genres,
        sellPriceCents: book.prices.sell * 100, // Convert dollars to cents
        borrowPriceCents: book.prices.borrow * 100,
        stockPriceCents: book.prices.stock * 100,
        availableCopies: book.copies,
        seededCopies: book.copies, // Store original count for restock reference
        year: book.year,
        pages: book.pages,
        publisher: book.publisher,
      },
    });
    seededCount++;
  }

  return seededCount;
}


async function seedWallet(): Promise<void> {
  // Use a transaction to ensure atomicity and idempotency
  await prisma.$transaction(async (tx) => {
    // Create wallet if it doesn't exist
    await tx.libraryWallet.upsert({
      where: { id: WALLET_ID },
      update: {}, // Don't update if exists
      create: {
        id: WALLET_ID,
        milestoneReached: false,
      },
    });

    // Check if initial balance movement already exists (idempotency)
    const existingMovement = await tx.walletMovement.findUnique({
      where: { dedupeKey: 'INITIAL_BALANCE' },
    });

    if (!existingMovement) {
      // Create initial balance movement
      await tx.walletMovement.create({
        data: {
          walletId: WALLET_ID,
          amountCents: INITIAL_BALANCE_CENTS,
          type: MovementType.INITIAL_BALANCE,
          reason: 'Initial library wallet balance',
          dedupeKey: 'INITIAL_BALANCE',
        },
      });
    }
  });
}

async function main(): Promise<void> {
  console.log('Starting database seeding...');

  try {
    // Seed wallet first (with initial balance)
    await seedWallet();
    console.log(`Library wallet initialized with ${INITIAL_BALANCE_CENTS} cents ($${(INITIAL_BALANCE_CENTS / 100).toFixed(2)})`);

    // Seed books
    const bookCount = await seedBooks();
    console.log(`Seeded ${bookCount} books`);

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error during seeding:', error);
    throw error;
  }
}

// Export for testing
export { seedBooks, seedWallet, INITIAL_BALANCE_CENTS, WALLET_ID };

// Run if executed directly
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
