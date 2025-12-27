import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import healthRouter from './routes/health';
import borrowRouter from './routes/borrow';
import { errorHandler } from './middleware';

// Import types to extend Express Request
import './types';

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRouter);
app.use('/api/books', borrowRouter);

// 404 handler (must be before error handler)
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    },
  });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;
