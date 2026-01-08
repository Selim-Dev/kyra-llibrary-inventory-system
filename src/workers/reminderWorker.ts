/**
 * Reminder Worker - Processes borrow due date reminders using BullMQ
 *
 * Key features:
 * - Check if borrow still active
 * - Skip if already returned
 * - Create simulated email with dedupeKey
 * - Create event with dedupeKey
 * - Exactly-once semantics via unique constraints
 */

import { Worker, Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import redisConfig from '../config/redis';
import { ReminderJobData } from '../queues';

/**
 * Process a reminder job
 */
async function processReminderJob(job: Job<ReminderJobData>): Promise<void> {
  const { borrowId, userEmail, bookTitle } = job.data;

  console.log(`Processing reminder job ${job.id} for borrow ${borrowId}`);

  // Execute reminder in a transaction
  await prisma.$transaction(
    async (tx) => {
      // 1. Get the borrow to check if still active
      const borrow = await tx.borrow.findUnique({
        where: { id: borrowId },
        include: { book: true },
      });

      if (!borrow) {
        console.log(
          `Reminder job ${job.id}: Borrow ${borrowId} not found, skipping`
        );
        return;
      }

      // 2. Check if borrow is still active (activeKey not null)
      if (!borrow.activeKey) {
        console.log(
          `Reminder job ${job.id}: Borrow ${borrowId} already returned, skipping`
        );
        return;
      }

      // 3. Create simulated email with dedupeKey for exactly-once
      const emailDedupeKey = `REMINDER:${borrowId}`;

      // Check if email already exists (idempotency)
      const existingEmail = await tx.simulatedEmail.findUnique({
        where: { dedupeKey: emailDedupeKey },
      });

      if (existingEmail) {
        console.log(
          `Reminder job ${job.id}: Email already sent for borrow ${borrowId}, skipping`
        );
        return;
      }

      // Create the reminder email
      await tx.simulatedEmail.create({
        data: {
          recipient: userEmail,
          subject: `Reminder: "${borrow.book.title}" is due`,
          body: `Dear reader,\n\nThis is a reminder that your borrowed book "${borrow.book.title}" (ISBN: ${borrow.book.isbn}) is now due.\n\nPlease return it at your earliest convenience.\n\nThank you,\nThe Library`,
          type: 'REMINDER',
          dedupeKey: emailDedupeKey,
        },
      });

      // 4. Create reminder sent event with dedupeKey
      await tx.event.create({
        data: {
          type: 'REMINDER_SENT',
          userId: borrow.userId,
          bookId: borrow.bookId,
          borrowId: borrow.id,
          metadata: {
            userEmail,
            bookTitle: borrow.book.title,
            dueAt: borrow.dueAt.toISOString(),
            jobId: job.id,
          },
          dedupeKey: `REMINDER_SENT:${borrowId}`,
        },
      });

      console.log(
        `Reminder job ${job.id}: Sent reminder for "${borrow.book.title}" to ${userEmail}`
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );
}

/**
 * Create and start the reminder worker
 */
export function createReminderWorker(): Worker<ReminderJobData> {
  const worker = new Worker<ReminderJobData>(
    'reminders',
    async (job) => {
      await processReminderJob(job);
    },
    {
      connection: redisConfig,
      concurrency: 5, // Process up to 5 jobs concurrently
    }
  );

  // Event listeners
  worker.on('completed', (job) => {
    console.log(`Reminder job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Reminder job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('Reminder worker error:', err);
  });

  console.log('Reminder worker started');

  return worker;
}

export default createReminderWorker;
