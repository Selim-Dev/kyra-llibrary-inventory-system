import app from './app';
import config from './config';
import { startWorkers } from './workers';

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  
  // Start BullMQ workers
  startWorkers();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  const { stopWorkers } = await import('./workers');
  await stopWorkers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  const { stopWorkers } = await import('./workers');
  await stopWorkers();
  process.exit(0);
});
