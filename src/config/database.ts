import mongoose from 'mongoose';
import logger from '@/utils/logger';
import dns from 'node:dns';

async function runMigrations() {
  try {
    // Drop old unique indexes that lacked profileId — they prevent assigning the same content to different profiles.
    // Safe to re-run: dropIndex is a no-op if the index no longer exists.
    await mongoose.connection.collection("short-assignments")
      .dropIndex("assignedToId_1_shortVideoId_1_assignedByRole_1").catch(() => {});
    await mongoose.connection.collection("course-assignments")
      .dropIndex("assignedToId_1_courseId_1_assignedByRole_1").catch(() => {});
  } catch {}
}

// Override the default DNS resolver for this process to use public Google/Cloudflare DNS.
// This fixes the "querySrv ECONNREFUSED" error on ISPs or routers that block SRV queries.
dns.setServers(['8.8.8.8', '1.1.1.1']);

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
    await runMigrations();
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
