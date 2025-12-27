# Library Inventory System

A REST API for managing a library/book store inventory system built with Node.js, TypeScript, Express.js, and PostgreSQL (via Prisma ORM).

## Features

- **Book Management**: Search books by title, author, or genre with pagination
- **Borrowing System**: Borrow and return books with automatic due date tracking
- **Purchase System**: Buy books with cancellation support (within 5 minutes)
- **Wallet Management**: Track all financial transactions with full audit trail
- **Background Jobs**: Automatic restocking and overdue reminders
- **Admin Dashboard**: View events, wallet movements, emails, and user history

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 15+
- **ORM**: Prisma
- **Testing**: Jest + Supertest

## Quick Start

### Using Docker (Recommended)

#### Production Mode

```bash
# Clone the repository
git clone <repository-url>
cd library-inventory-system

# Start the application with Docker Compose (production)
docker-compose up --build

# The API will be available at http://localhost:3000
```

#### Development Mode (with hot reload)

```bash
# Start the application in development mode
docker-compose -f docker-compose.dev.yml up --build

# The API will be available at http://localhost:3000
# Source code changes will automatically reload the server
```

#### Docker Commands Reference

```bash
# Production
docker-compose up --build          # Start in foreground
docker-compose up -d --build       # Start in background
docker-compose down                # Stop containers
docker-compose down -v             # Stop and remove volumes

# Development
docker-compose -f docker-compose.dev.yml up --build
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml down -v
```

### Local Development

#### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- npm or yarn

#### Setup

```bash
# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npx prisma migrate deploy

# Seed the database with books
npm run prisma:seed

# Start the development server
npm run dev
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## API Endpoints

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check endpoint |

### Books

| Method | Endpoint | Description | Headers |
|--------|----------|-------------|---------|
| GET | `/api/books` | Search books with filters | - |
| POST | `/api/books/:isbn/borrow` | Borrow a book | `X-User-Email` |
| POST | `/api/books/:isbn/return` | Return a borrowed book | `X-User-Email` |
| POST | `/api/books/:isbn/buy` | Buy a book | `X-User-Email`, `X-Idempotency-Key` |

### Purchases

| Method | Endpoint | Description | Headers |
|--------|----------|-------------|---------|
| POST | `/api/purchases/:id/cancel` | Cancel a purchase (within 5 min) | `X-User-Email` |

### Admin Endpoints

All admin endpoints require `X-User-Email: admin@dummy-library.com`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/events` | View all system events |
| GET | `/api/admin/wallet` | View wallet balance |
| GET | `/api/admin/wallet/movements` | View wallet movements |
| GET | `/api/admin/emails` | View simulated emails |
| GET | `/api/admin/users/:email/history` | View user history |

### Query Parameters

#### Book Search (`GET /api/books`)
- `title` - Filter by title (partial match, case-insensitive)
- `author` - Filter by author (partial match, case-insensitive)
- `genre` - Filter by genre (exact match)
- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 10, max: 100)

#### Events (`GET /api/admin/events`)
- `userEmail` - Filter by user email
- `bookIsbn` - Filter by book ISBN
- `type` - Filter by event type (BORROW, RETURN, BUY, CANCEL_BUY, etc.)
- `startDate` - Filter by start date (ISO string)
- `endDate` - Filter by end date (ISO string)
- `page`, `pageSize` - Pagination

#### Wallet Movements (`GET /api/admin/wallet/movements`)
- `type` - Filter by credit/debit
- `startDate`, `endDate` - Date range filter
- `page`, `pageSize` - Pagination

#### Emails (`GET /api/admin/emails`)
- `recipient` - Filter by recipient email
- `type` - Filter by email type (LOW_STOCK, REMINDER, MILESTONE)
- `page`, `pageSize` - Pagination

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BOOK_NOT_FOUND` | 404 | Book with given ISBN not found |
| `BORROW_NOT_FOUND` | 404 | No active borrow found |
| `PURCHASE_NOT_FOUND` | 404 | Purchase not found |
| `NO_COPIES_AVAILABLE` | 409 | No copies available for borrow/buy |
| `BORROW_LIMIT_EXCEEDED` | 409 | User has 3 active borrows |
| `BOOK_BUY_LIMIT_EXCEEDED` | 409 | User owns 2 copies of this book |
| `TOTAL_BUY_LIMIT_EXCEEDED` | 409 | User owns 10 total books |
| `CANCELLATION_WINDOW_EXPIRED` | 400 | Purchase older than 5 minutes |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Missing X-Idempotency-Key header |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |



## Design Choices & Assumptions

### Concurrency Control

1. **Per-User Advisory Locks**: Both borrow and buy operations use PostgreSQL advisory locks (`pg_advisory_xact_lock`) to serialize requests from the same user, preventing limit bypass under concurrent requests.

2. **Atomic Inventory Updates**: Inventory decrements use conditional updates (`UPDATE ... WHERE available >= 1`) to prevent negative stock without explicit row locks.

3. **Last-Copy Safety**: When multiple users try to borrow/buy the last copy simultaneously, exactly one succeeds while others receive HTTP 409.

### Idempotency

1. **Natural Idempotency**: Borrow and return operations are naturally idempotent - borrowing an already-borrowed book returns the existing borrow; returning an already-returned book returns success.

2. **Explicit Idempotency Keys**: Buy operations require an `X-Idempotency-Key` header. The same key returns the original response without re-executing.

3. **Cancel Idempotency**: Canceling an already-canceled purchase returns success without double refund.

### Wallet Design

1. **Derivable Balance**: The wallet balance is always calculated from the sum of all movements (no stored balance field). This ensures the balance is always consistent and auditable.

2. **Integer Cents**: All monetary values are stored as integers (cents) to avoid floating-point precision issues.

3. **Movement Deduplication**: Each movement has a unique `dedupeKey` to prevent duplicate entries on retries.

### Background Jobs

1. **Database Persistence**: All scheduled jobs (restock, reminders) are stored in the database and survive process restarts.

2. **Lease-Based Claiming**: Jobs use a lease mechanism (`lockedAt` timestamp) to prevent duplicate processing across multiple workers.

3. **Exponential Backoff**: Failed jobs retry with exponential backoff (1min, 2min, 4min... max 1 hour).

4. **Exactly-Once Semantics**: Job handlers use deduplication keys to ensure side effects (emails, movements) happen exactly once.

### activeKey Pattern

The system uses a nullable unique key pattern for deduplication:
- Active records have a non-null `activeKey` (e.g., `userId:bookId` for borrows)
- Completed/canceled records have `activeKey = null`
- PostgreSQL unique constraints ignore NULL values, allowing unlimited history while preventing duplicates

### Assumptions

1. **ISBN Uniqueness**: Each book in the seed JSON has a unique ISBN (UUID format)
2. **User Auto-Creation**: Users are created automatically on first interaction (no registration)
3. **Time Zone**: All timestamps are stored in UTC
4. **Currency**: All prices are in USD cents
5. **Email Simulation**: Emails are stored in the database, not actually sent
6. **Restock Timing**: "~1 hour" is interpreted as exactly 1 hour
7. **Due Date**: "3 days" means exactly 72 hours from borrow time
8. **Initial Balance**: Library wallet starts with $100.00 (10000 cents)

## Project Structure

```
src/
├── index.ts                 # Application entry point
├── app.ts                   # Express app configuration
├── config/                  # Environment configuration
├── middleware/              # Express middleware
│   ├── userIdentification.ts
│   ├── adminOnly.ts
│   ├── idempotency.ts
│   └── errorHandler.ts
├── routes/                  # API route handlers
│   ├── books.ts
│   ├── borrow.ts
│   ├── buy.ts
│   ├── admin.ts
│   └── health.ts
├── services/                # Business logic
│   ├── bookService.ts
│   ├── borrowService.ts
│   ├── buyService.ts
│   ├── walletService.ts
│   ├── eventService.ts
│   ├── emailService.ts
│   └── userService.ts
├── jobs/                    # Background job handlers
│   ├── jobRunner.ts
│   ├── restockJob.ts
│   └── reminderJob.ts
├── prisma/                  # Database
│   ├── schema.prisma
│   └── seed.ts
├── utils/                   # Utilities
│   ├── money.ts
│   ├── errors.ts
│   └── pagination.ts
└── types/                   # TypeScript types
```

## License

ISC
