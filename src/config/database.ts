import mongoose from 'mongoose';
import logger from '@/utils/logger';

mongoose.connection.on('connected', () => {
  logger.info('MongoDB connected successfully');
});

mongoose.connection.on('error', err => {
  logger.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection lost');
});

export const connectDB = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
      throw new Error('Database connection string is missing');
    }
    await mongoose.connect(MONGO_URI);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown database error';
      logger.error('Failed to connect to MongoDB', { error: message });

    if (process.env.NODE_ENV === 'production') {
      logger.warn('Retrying database connection in 5 seconds...');
      setTimeout(connectDB, 5000);
    } else {
      process.exit(1);
    }
  }
};

const shutdown = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully');
    process.exit(0);
  } catch (err) {
    logger.error('Failed to close MongoDB connection', { error: err });
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
