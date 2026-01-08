/**
 * Redis Configuration for BullMQ
 */

import { ConnectionOptions } from 'bullmq';

const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // Required for BullMQ
};

export default redisConfig;
