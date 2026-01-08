/**
 * Worker Manager - Manages all BullMQ workers
 */

import { Worker } from 'bullmq';
import { createReminderWorker } from './reminderWorker';
import { createRestockWorker } from './restockWorker';

let reminderWorker: Worker | null = null;
let restockWorker: Worker | null = null;

/**
 * Start all workers
 */
export function startWorkers(): void {
  if (reminderWorker || restockWorker) {
    console.log('Workers already started');
    return;
  }

  reminderWorker = createReminderWorker();
  restockWorker = createRestockWorker();

  console.log('All workers started successfully');
}

/**
 * Stop all workers gracefully
 */
export async function stopWorkers(): Promise<void> {
  const workers = [reminderWorker, restockWorker].filter(
    (w): w is Worker => w !== null
  );

  if (workers.length === 0) {
    console.log('No workers to stop');
    return;
  }

  await Promise.all(workers.map((worker) => worker.close()));

  reminderWorker = null;
  restockWorker = null;

  console.log('All workers stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  reminderWorker: boolean;
  restockWorker: boolean;
} {
  return {
    reminderWorker: reminderWorker !== null && !reminderWorker.closing,
    restockWorker: restockWorker !== null && !restockWorker.closing,
  };
}

export default {
  startWorkers,
  stopWorkers,
  getWorkerStatus,
};
