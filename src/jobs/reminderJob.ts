/**
 * Reminder Job Handler - Handles borrow due date reminders
 *
 * Key features:
 * - Check if borrow still active (activeKey not null)
 * - Skip if already returned
 * - Create simulated email with dedupeKey
 * - Create event with dedupeKey
 * - Exactly-once semantics via unique constraints
 *
 * Requirements: 13.1-13.8
 */

import { Job, Prisma } from '@prisma/client';
import prisma from '../prisma/client';

/**
 * Reminder job payload type
 */
interface ReminderPayload {
  borrowId: string;
  userEmail: string;
}

/**
 * Handle a reminder job
 *
 * @param job - The reminder job to process
 */
export async function handleReminderJob(job: Job): Promise<void> {
  const payload = job.payload as unknown as ReminderPayload;
  const { borrowId, userEmail } = payload;

  // Execute reminder in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Get the borrow to check if still active
    const borrow = await tx.borrow.findUnique({
      where: { id: borrowId },
      include: { book: true },
    });

    if (!borrow) {
      console.log(`Reminder job ${job.id}: Borrow ${borrowId} not found, skipping`);
      return;
    }

    // 2. Check if borrow is still active (activeKey not null)
    if (!borrow.activeKey) {
      console.log(`Reminder job ${job.id}: Borrow ${borrowId} already returned, skipping`);
      return;
    }

    // 3. Create simulated email with dedupeKey for exactly-once
    const emailDedupeKey = `REMINDER:${borrowId}`;
    
    // Check if email already exists (idempotency)
    const existingEmail = await tx.simulatedEmail.findUnique({
      where: { dedupeKey: emailDedupeKey },
    });

    if (existingEmail) {
      console.log(`Reminder job ${job.id}: Email already sent for borrow ${borrowId}, skipping`);
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
        jobId: job.id,
        metadata: {
          userEmail,
          bookTitle: borrow.book.title,
          dueAt: borrow.dueAt.toISOString(),
        },
        dedupeKey: `REMINDER_SENT:${borrowId}`,
      },
    });

    console.log(`Reminder job ${job.id}: Sent reminder for "${borrow.book.title}" to ${userEmail}`);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30000,
  });
}

export default handleReminderJob;
