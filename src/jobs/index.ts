/**
 * Jobs module - Background job processing
 *
 * Exports:
 * - JobRunner class and utilities
 * - Job handlers for RESTOCK and REMINDER
 * - initializeJobRunner to set up handlers and start the runner
 */

export { JobRunner, getJobRunner, createJobRunner, calculateBackoff } from './jobRunner';
export { handleRestockJob, InsufficientFundsError } from './restockJob';
export { handleReminderJob } from './reminderJob';

import { getJobRunner } from './jobRunner';
import { handleRestockJob } from './restockJob';
import { handleReminderJob } from './reminderJob';

/**
 * Initialize the job runner with all handlers and start it
 */
export function initializeJobRunner(): void {
  const runner = getJobRunner();
  
  // Register handlers
  runner.registerHandler('RESTOCK', handleRestockJob);
  runner.registerHandler('REMINDER', handleReminderJob);
  
  // Start the runner
  runner.start();
}

/**
 * Stop the job runner
 */
export async function stopJobRunner(): Promise<void> {
  const runner = getJobRunner();
  await runner.stop();
}
