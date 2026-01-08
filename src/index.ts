import app from './app';
import config from './config';
import { initializeJobRunner } from './jobs';

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  
  // Start background job processing
  initializeJobRunner();
  console.log('Job runner initialized');
});
