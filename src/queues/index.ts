/**
 * BullMQ Queue Setup
 *
 * Defines queues for different job types:
 * - reminderQueue: Handles borrow due date reminders
 * - restockQueue: Handles automatic book restocking
 */

import { Queue } from 'bullmq';
import redisConfig from '../config/redis';

/**
 * Job payload types
 */
export interface ReminderJobData {
  borrowId: string;
  userEmail: string;
  bookTitle: string;
  dueAt: string;
}

export interface RestockJobData {
  bookId: string;
  isbn: string;
  bookTitle: string;
}

/**
 * Reminder Queue - Handles borrow due date reminders
 */
export const reminderQueue = new Queue<ReminderJobData>('reminders', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
    },
  },
});

/**
 * Restock Queue - Handles automatic book restocking
 */
export const restockQueue = new Queue<RestockJobData>('restock', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 10, // More attempts for restock (waiting for funds)
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute, max 1 hour
    },
    removeOnComplete: {
      age: 86400,
      count: 1000,
    },
    removeOnFail: {
      age: 604800,
    },
  },
});

/**
 * Graceful shutdown for all queues
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    reminderQueue.close(),
    restockQueue.close(),
  ]);
  console.log('All queues closed');
}

export default {
  reminderQueue,
  restockQueue,
  closeQueues,
};
