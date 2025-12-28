/**
 * Job Runner - Background job execution engine with lease-based claiming
 *
 * Key features:
 * - Polling-based job discovery
 * - Lease-based claiming with timeout (1 minute)
 * - Exponential backoff for retries
 * - Handles stuck PROCESSING jobs (lease expired)
 * - Clear activeKey ONLY on terminal states (COMPLETED/CANCELED)
 */

import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import prisma from '../prisma/client';

// Constants
const POLL_INTERVAL_MS = 5000; // 5 seconds
const LEASE_TIMEOUT_MS = 60000; // 1 minute
const MAX_BACKOFF_MS = 3600000; // 1 hour
const BASE_BACKOFF_MS = 60000; // 1 minute

/**
 * Job handler function type
 */
export type JobHandler = (job: Job) => Promise<void>;

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * Formula: min(BASE * 2^(attempts-1), MAX)
 * Results: 1min, 2min, 4min, 8min, 16min, 32min, 64min (capped at 1hr)
 */
export function calculateBackoff(attempts: number): Date {
  const delayMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS);
  return new Date(Date.now() + delayMs);
}

/**
 * JobRunner class - manages background job execution
 */
export class JobRunner {
  private running = false;
  private pollInterval = POLL_INTERVAL_MS;
  private leaseTimeout = LEASE_TIMEOUT_MS;
  private handlers: Map<JobType, JobHandler> = new Map();
  private pollPromise: Promise<void> | null = null;

  /**
   * Register a handler for a specific job type
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Start the job runner
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.pollPromise = this.poll();
    console.log('JobRunner started');
  }

  /**
   * Stop the job runner
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollPromise) {
      await this.pollPromise;
    }
    console.log('JobRunner stopped');
  }

  /**
   * Check if the runner is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.processJobs();
      } catch (error) {
        console.error('Job polling error:', error);
      }

      if (this.running) {
        await sleep(this.pollInterval);
      }
    }
  }

  /**
   * Find and process claimable jobs
   */
  private async processJobs(): Promise<void> {
    const now = new Date();
    const leaseExpiry = new Date(now.getTime() - this.leaseTimeout);

    // Find claimable jobs: PENDING and due, OR stuck PROCESSING jobs
    // Note: We filter by maxAttempts in application code since we can't compare columns directly
    const jobs = await prisma.job.findMany({
      where: {
        activeKey: { not: null }, // Only active jobs
        OR: [
          // Normal pending jobs that are due
          {
            status: 'PENDING',
            runAt: { lte: now },
          },
          // Stuck processing jobs (lease expired)
          {
            status: 'PROCESSING',
            lockedAt: { lt: leaseExpiry },
          },
        ],
      },
      orderBy: { runAt: 'asc' },
      take: 10,
    });

    // Filter out jobs that have exceeded max attempts
    const claimableJobs = jobs.filter((job) => job.attempts < job.maxAttempts);

    for (const job of claimableJobs) {
      if (!this.running) break;
      await this.processJob(job);
    }
  }

  /**
   * Process a single job with lease-based claiming
   */
  private async processJob(job: Job): Promise<void> {
    const leaseExpiry = new Date(Date.now() - this.leaseTimeout);

    // Claim job with lease (atomic update)
    // Include activeKey check to prevent re-claiming completed jobs
    const claimed = await prisma.job.updateMany({
      where: {
        id: job.id,
        activeKey: { not: null }, // Only claim active jobs
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', lockedAt: { lt: leaseExpiry } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      // Another worker claimed it or job already completed
      return;
    }

    // Get the updated job
    const claimedJob = await prisma.job.findUnique({
      where: { id: job.id },
    });

    if (!claimedJob) {
      return;
    }

    // Get the handler for this job type
    const handler = this.handlers.get(claimedJob.type);
    if (!handler) {
      console.error(`No handler registered for job type: ${claimedJob.type}`);
      await this.markJobFailed(claimedJob.id, `No handler for job type: ${claimedJob.type}`);
      return;
    }

    try {
      // Execute the job handler
      await handler(claimedJob);

      // Mark job as completed - clear activeKey
      await prisma.job.update({
        where: { id: claimedJob.id },
        data: {
          status: 'COMPLETED',
          activeKey: null, // Clear activeKey to allow future jobs
          completedAt: new Date(),
          lastError: null,
        },
      });

      console.log(`Job ${claimedJob.id} (${claimedJob.type}) completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Job ${claimedJob.id} (${claimedJob.type}) failed:`, errorMessage);

      // Check if we've exceeded max attempts
      if (claimedJob.attempts >= claimedJob.maxAttempts) {
        await this.markJobFailed(claimedJob.id, errorMessage);
      } else {
        // Schedule retry with exponential backoff
        // Keep activeKey, update runAt and set status back to PENDING
        const nextRunAt = calculateBackoff(claimedJob.attempts);
        await prisma.job.update({
          where: { id: claimedJob.id },
          data: {
            status: 'PENDING',
            lastError: errorMessage,
            runAt: nextRunAt,
            lockedAt: null, // Release the lease
          },
        });
        console.log(`Job ${claimedJob.id} scheduled for retry at ${nextRunAt.toISOString()}`);
      }
    }
  }

  /**
   * Mark a job as permanently failed
   */
  private async markJobFailed(jobId: string, error: string): Promise<void> {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        activeKey: null, // Clear activeKey on terminal state
        lastError: error,
        completedAt: new Date(),
      },
    });
    console.log(`Job ${jobId} marked as FAILED after max attempts`);
  }

  /**
   * Process a single job immediately (for testing)
   * Returns true if job was processed, false if not claimable
   */
  async processJobById(jobId: string): Promise<boolean> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job || !job.activeKey) {
      return false;
    }

    await this.processJob(job);
    return true;
  }
}

// Singleton instance
let jobRunnerInstance: JobRunner | null = null;

/**
 * Get or create the JobRunner singleton
 */
export function getJobRunner(): JobRunner {
  if (!jobRunnerInstance) {
    jobRunnerInstance = new JobRunner();
  }
  return jobRunnerInstance;
}

/**
 * Create a new JobRunner instance (for testing)
 */
export function createJobRunner(): JobRunner {
  return new JobRunner();
}

export default {
  JobRunner,
  getJobRunner,
  createJobRunner,
  calculateBackoff,
};
